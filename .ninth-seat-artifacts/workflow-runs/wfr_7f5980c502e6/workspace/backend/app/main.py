from __future__ import annotations

import os
import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Literal, Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field


# -----------------
# Pydantic models (match api/openapi.json)
# -----------------

Operator = Literal["+", "-", "*", "/"]


class EvaluateRequest(BaseModel):
    operandA: str
    operator: Operator
    operandB: str


class EvaluateResponse(BaseModel):
    result: str
    error: Optional[str] = None


class ErrorResponse(BaseModel):
    error: str


class HistoryEventCreate(BaseModel):
    sessionId: str = Field(..., description="UUID")
    expression: str
    result: str
    error: Optional[str] = None


class HistoryEvent(HistoryEventCreate):
    id: str
    createdAt: str


# -----------------
# App
# -----------------

app = FastAPI(title="Simple Calculator API", version="1.0.0")

cors_origins = os.getenv("CORS_ORIGINS", "*")
origins = [o.strip() for o in cors_origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins if origins else ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# -----------------
# Optional SQLite persistence
# -----------------

DB_URL = os.getenv("DATABASE_URL", "sqlite:///./calculator.db")


def _sqlite_path_from_url(url: str) -> Optional[str]:
    if url.startswith("sqlite:///"):
        return url.replace("sqlite:///", "", 1)
    if url.startswith("sqlite://"):
        # sqlite://relative/path.db
        return url.replace("sqlite://", "", 1)
    return None


def _get_conn() -> Optional[sqlite3.Connection]:
    path = _sqlite_path_from_url(DB_URL)
    if not path:
        return None
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    return conn


def _init_db() -> None:
    conn = _get_conn()
    if conn is None:
        return
    try:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS calc_session (
              id TEXT PRIMARY KEY,
              created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS calc_history_event (
              id TEXT PRIMARY KEY,
              session_id TEXT NOT NULL,
              expression TEXT NOT NULL,
              result TEXT NOT NULL,
              error TEXT,
              created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              CONSTRAINT fk_session FOREIGN KEY (session_id) REFERENCES calc_session(id)
            );

            CREATE INDEX IF NOT EXISTS idx_calc_history_event_session_created
              ON calc_history_event(session_id, created_at DESC);
            """
        )
        conn.commit()
    finally:
        conn.close()


@app.on_event("startup")
def on_startup() -> None:
    _init_db()


# -----------------
# Helpers
# -----------------


def _parse_decimal_str(s: str) -> float:
    # Accept strings like "2", "2.5", "-0.1"; reject NaN/inf
    try:
        v = float(s)
    except Exception:
        raise ValueError("Invalid number")
    if v != v or v in (float("inf"), float("-inf")):
        raise ValueError("Invalid number")
    return v


def _format_result(v: float) -> str:
    # Return a stable string; avoid trailing .0 when integer
    if abs(v - round(v)) < 1e-12:
        return str(int(round(v)))
    return ("{:.12g}".format(v)).rstrip("0").rstrip(".")


# -----------------
# Routes (match OpenAPI)
# -----------------


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/api/evaluate", response_model=EvaluateResponse, responses={400: {"model": ErrorResponse}})
def evaluate(req: EvaluateRequest):
    try:
        a = _parse_decimal_str(req.operandA)
        b = _parse_decimal_str(req.operandB)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid input")

    if req.operator == "+":
        res = a + b
    elif req.operator == "-":
        res = a - b
    elif req.operator == "*":
        res = a * b
    elif req.operator == "/":
        if b == 0:
            # Contract: 400 Invalid input
            raise HTTPException(status_code=400, detail="Invalid input")
        res = a / b
    else:
        raise HTTPException(status_code=400, detail="Invalid input")

    return EvaluateResponse(result=_format_result(res), error=None)


@app.post(
    "/api/history/events",
    status_code=201,
    response_model=HistoryEvent,
)
def create_history_event(payload: HistoryEventCreate):
    # If DB not configured (non-sqlite), still return a created object (in-memory behavior)
    event_id = str(uuid.uuid4())
    created_at = datetime.now(timezone.utc).isoformat()

    conn = _get_conn()
    if conn is not None:
        try:
            # ensure session exists
            conn.execute(
                "INSERT OR IGNORE INTO calc_session (id) VALUES (?)",
                (payload.sessionId,),
            )
            conn.execute(
                """
                INSERT INTO calc_history_event (id, session_id, expression, result, error)
                VALUES (?, ?, ?, ?, ?)
                """,
                (event_id, payload.sessionId, payload.expression, payload.result, payload.error),
            )
            conn.commit()
        finally:
            conn.close()

    return HistoryEvent(
        id=event_id,
        createdAt=created_at,
        sessionId=payload.sessionId,
        expression=payload.expression,
        result=payload.result,
        error=payload.error,
    )


@app.get("/api/history/events")
def list_history_events(limit: int = Query(50, ge=1, le=500)):
    conn = _get_conn()
    if conn is None:
        return {"items": []}

    try:
        rows = conn.execute(
            """
            SELECT id, session_id, expression, result, error, created_at
            FROM calc_history_event
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()

        items = []
        for r in rows:
            # created_at from sqlite is typically "YYYY-MM-DD HH:MM:SS"; convert to ISO-ish
            created = r["created_at"]
            if isinstance(created, str) and "T" not in created:
                created_iso = created.replace(" ", "T") + "Z"
            else:
                created_iso = str(created)

            items.append(
                {
                    "id": r["id"],
                    "createdAt": created_iso,
                    "sessionId": r["session_id"],
                    "expression": r["expression"],
                    "result": r["result"],
                    "error": r["error"],
                }
            )

        return {"items": items}
    finally:
        conn.close()
