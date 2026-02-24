import os

from fastapi import APIRouter, FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from starlette.middleware.sessions import SessionMiddleware


def _parse_origins(raw: str) -> list[str]:
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


APP_PASSWORD = os.getenv("APP_PASSWORD", "5573")
SESSION_SECRET = os.getenv("SESSION_SECRET", "change-this-in-production")
FRONTEND_ORIGINS = _parse_origins(
    os.getenv("FRONTEND_ORIGINS", "http://localhost:5173")
)


class LoginRequest(BaseModel):
    password: str


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

    return {"message": "nothing here yet"}


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
