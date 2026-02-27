# Simple Calculator App — Architecture

## Context / Scope
MVP: single-user calculator supporting digit/decimal input, + − × ÷, equals, clear/reset, graceful divide-by-zero error. Optional: backspace, keyboard input, chaining operations.

Platform not specified; defaulting to a **web app**.

## High-level Architecture (Minimal Fullstack)
Even though a calculator can be purely client-side, this workflow expects a fullstack design. We keep backend minimal and optional:

- **Frontend**: React (Vite) SPA
  - Renders calculator UI
  - Implements calculator state machine (immediate-execution model)
  - Optional: calls backend to evaluate operations and/or store session history

- **Backend**: FastAPI (Python)
  - Provides a small API for health + optional evaluation endpoint
  - Optional persistence for calculation history (PostgreSQL or SQLite)

- **Database** (optional for MVP): SQLite (dev) / PostgreSQL (prod)
  - Stores calculation events for a session (no auth)

### Data Flow (text diagram)
User → Frontend UI
- Button/keyboard events update local state
- On `=`: either
  - (default) compute locally and update display
  - (optional) POST `/api/evaluate` to compute server-side and return result
- (optional) POST `/api/history/events` to record event

## Component Boundaries
### Frontend
- `Calculator` component: orchestrates state
- `Display` component: shows current input/result/error
- `Keypad` component: buttons + keyboard bindings
- `calcEngine` module: pure functions/state reducer

### Backend
- `GET /api/health`: liveness
- `POST /api/evaluate`: evaluate a single binary operation (operandA op operandB)
- (optional) history endpoints

## Evaluation Model
**Immediate execution** (pocket-calculator style):
- Enter operandA → choose operator → enter operandB → `=` computes
- Chaining: `2 + 3 + 4 =` computes intermediate results when operator pressed

Rationale: matches acceptance criteria and avoids full expression parsing/precedence.

## Deployment
- Frontend: static hosting (Netlify/Vercel) or served by backend
- Backend: containerized (uvicorn)
- Env vars:
  - `DATABASE_URL` (optional)
  - `CORS_ORIGINS` (optional)

## Tradeoffs / Alternatives Considered
- **Client-only app** vs fullstack:
  - Chosen: minimal backend optional to satisfy workflow fullstack expectation.
  - Tradeoff: extra complexity; benefit: demonstrates API contracts/testing.
- **Expression parsing with precedence** vs immediate execution:
  - Chosen: immediate execution for predictability and simplicity.
  - Tradeoff: users expecting precedence may be surprised; can be added later.
- **PostgreSQL** vs **SQLite**:
  - Chosen: SQLite for dev simplicity; PostgreSQL for production if history needed.
  - Tradeoff: SQLite limited concurrency; acceptable for single-user MVP.
