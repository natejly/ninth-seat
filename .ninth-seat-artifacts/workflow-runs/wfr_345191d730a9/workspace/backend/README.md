# Calculator Backend (optional)

The calculator MVP is fully client-side and does **not** require a backend.

This service implements the **optional future** API contracts from the architecture node:

- `GET /api/history` -> `{ items: [...] }`
- `POST /api/history` body `{ expression: string, result: string }` -> `{ id: uuid }`

## Run

```bash
cd backend
npm install
npm run dev
# or
npm start
```

Health check:

```bash
curl http://localhost:3001/healthz
```
