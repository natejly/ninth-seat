# Backend (FastAPI)

## Run

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# optional: set CORS origins (comma-separated)
# export CORS_ORIGINS=http://localhost:5173

# optional: set sqlite db path
# export DATABASE_URL=sqlite:///./calculator.db

uvicorn app.main:app --reload --port 8000
```

## Endpoints
- `GET /api/health`
- `POST /api/evaluate`
- `POST /api/history/events` (optional persistence)
- `GET /api/history/events?limit=50` (optional persistence)
