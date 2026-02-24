# Ninth Seat

Minimal React + FastAPI app with backend-validated password auth.

## Backend (FastAPI)

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload
```

Optional environment variables:

- `APP_PASSWORD` (defaults to `5573`)
- `SESSION_SECRET` (change for production)
- `FRONTEND_ORIGINS` (comma-separated, defaults to `http://localhost:5173`)

## Frontend (React + Vite)

```bash
cd frontend
npm install
npm run dev
```

Vite proxies `/api` requests to `http://localhost:8000` in development.

## Deploy To Vercel

This repo is configured so Vercel serves the React app from `frontend/dist` and
runs FastAPI as a Python serverless function from `api/index.py`.

### Required Vercel environment variables

- `SESSION_SECRET` (required in production)

### Optional Vercel environment variables

- `APP_PASSWORD` (defaults to `5573`)
- `COOKIE_SECURE` (defaults to auto; enabled on Vercel)
- `FRONTEND_ORIGINS` (only needed if you call the API from a different origin)

### Deploy

```bash
vercel
vercel --prod
```
