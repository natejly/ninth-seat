import os
from pathlib import Path
from typing import Any

from fastapi import APIRouter, FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from starlette.middleware.sessions import SessionMiddleware

def _load_local_env() -> None:
    env_path = Path(__file__).resolve().parent / ".env"
    if not env_path.exists():
        return

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        if not key:
            continue

        value = value.strip()
        if (
            len(value) >= 2
            and value[0] == value[-1]
            and value[0] in {'"', "'"}
        ):
            value = value[1:-1]

        os.environ.setdefault(key, value)


_load_local_env()

try:
    from backend.workflow_planner import generate_workflow_plan
except ModuleNotFoundError as exc:
    if exc.name != "backend":
        raise
    from workflow_planner import generate_workflow_plan

try:
    from backend.tooling import ToolRunRequest, list_tools, run_tool
except ModuleNotFoundError as exc:
    if exc.name != "backend":
        raise
    from tooling import ToolRunRequest, list_tools, run_tool

try:
    from backend.workflow_runtime import (
        WorkflowRunCreateRequest,
        cancel_workflow_run,
        create_workflow_run,
        delete_workflow_run,
        get_workflow_run,
        list_workflow_runs,
    )
except ModuleNotFoundError as exc:
    if exc.name != "backend":
        raise
    from workflow_runtime import (
        WorkflowRunCreateRequest,
        cancel_workflow_run,
        create_workflow_run,
        delete_workflow_run,
        get_workflow_run,
        list_workflow_runs,
    )


def _parse_origins(raw: str) -> list[str]:
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


APP_PASSWORD = os.getenv("APP_PASSWORD", "5573")
SESSION_SECRET = os.getenv("SESSION_SECRET", "change-this-in-production")
FRONTEND_ORIGINS = _parse_origins(
    os.getenv("FRONTEND_ORIGINS", "http://localhost:5173")
)


class LoginRequest(BaseModel):
    password: str


class WorkflowPlanRequest(BaseModel):
    task: str


def _is_authenticated(request: Request) -> bool:
    return bool(request.session.get("authenticated"))


def _cookie_secure() -> bool:
    explicit = os.getenv("COOKIE_SECURE")
    if explicit is not None:
        return explicit.strip().lower() in {"1", "true", "yes", "on"}

    return bool(os.getenv("VERCEL")) or bool(os.getenv("VERCEL_ENV"))


router = APIRouter()


@router.get("/health")
def health() -> dict[str, bool]:
    return {"ok": True}


@router.get("/session")
def session_status(request: Request) -> dict[str, bool]:
    return {"authenticated": _is_authenticated(request)}


@router.post("/login")
def login(payload: LoginRequest, request: Request) -> dict[str, bool]:
    if payload.password != APP_PASSWORD:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid password",
        )

    request.session["authenticated"] = True
    return {"authenticated": True}


@router.post("/logout")
def logout(request: Request) -> dict[str, bool]:
    request.session.clear()
    return {"authenticated": False}


@router.get("/home")
def home(request: Request) -> dict[str, str]:
    if not _is_authenticated(request):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )

    return {"message": "Describe a task to generate an agent workflow DAG."}


@router.post("/workflow/plan")
def workflow_plan(payload: WorkflowPlanRequest, request: Request) -> dict[str, Any]:
    if not _is_authenticated(request):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )

    try:
        return generate_workflow_plan(payload.task)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate workflow: {exc}",
        ) from exc


@router.get("/tools")
def tools_catalog(request: Request) -> dict[str, Any]:
    if not _is_authenticated(request):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )

    return {"tools": list_tools()}


@router.post("/tools/run")
def tools_run(payload: ToolRunRequest, request: Request) -> dict[str, Any]:
    if not _is_authenticated(request):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )

    try:
        return run_tool(payload.tool, payload.args)
    except KeyError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc.args[0]) if exc.args else "Unknown tool",
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Tool execution failed: {exc}",
        ) from exc


@router.get("/workflow-runs")
def workflow_runs_list(request: Request, limit: int = 100) -> dict[str, Any]:
    if not _is_authenticated(request):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )

    return {"runs": list_workflow_runs(limit=limit)}


@router.post("/workflow-runs")
def workflow_runs_create(payload: WorkflowRunCreateRequest, request: Request) -> dict[str, Any]:
    if not _is_authenticated(request):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )

    try:
        return create_workflow_run(payload)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create workflow run: {exc}",
        ) from exc


@router.get("/workflow-runs/{run_id}")
def workflow_runs_get(run_id: str, request: Request) -> dict[str, Any]:
    if not _is_authenticated(request):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )

    run = get_workflow_run(run_id)
    if not run:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Workflow run not found",
        )
    return run


@router.post("/workflow-runs/{run_id}/cancel")
def workflow_runs_cancel(run_id: str, request: Request) -> dict[str, Any]:
    if not _is_authenticated(request):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )

    run = cancel_workflow_run(run_id)
    if not run:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Workflow run not found",
        )
    return run


@router.delete("/workflow-runs/{run_id}")
def workflow_runs_delete(run_id: str, request: Request) -> dict[str, Any]:
    if not _is_authenticated(request):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )

    try:
        run = delete_workflow_run(run_id)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        ) from exc

    if not run:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Workflow run not found",
        )
    return {"deleted": True, "run": run}


def create_app(*, api_prefixes: tuple[str, ...] = ("/api",)) -> FastAPI:
    app = FastAPI(title="Ninth Seat API")

    app.add_middleware(
        SessionMiddleware,
        secret_key=SESSION_SECRET,
        same_site="lax",
        https_only=_cookie_secure(),
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=FRONTEND_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    for prefix in api_prefixes:
        app.include_router(router, prefix=prefix)

    return app


app = create_app(api_prefixes=("/api",))
