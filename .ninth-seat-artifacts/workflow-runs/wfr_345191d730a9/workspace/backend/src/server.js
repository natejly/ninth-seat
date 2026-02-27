import express from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';

const app = express();
app.use(cors());
app.use(express.json({ limit: '100kb' }));

// Optional future persistence: in-memory history store for MVP
// Shape: { id: uuid, expression: string, result: string, created_at: ISO string }
const history = [];

app.get('/healthz', (req, res) => {
  res.json({ ok: true });
});

// GET /api/history (optional_future)
app.get('/api/history', (req, res) => {
  res.json({ items: history.slice().reverse() });
});

// POST /api/history (optional_future)
app.post('/api/history', (req, res) => {
  const { expression, result } = req.body ?? {};
  if (typeof expression !== 'string' || typeof result !== 'string') {
    return res.status(400).json({ error: 'Invalid body. Expected { expression: string, result: string }' });
  }
  const item = {
    id: uuidv4(),
    expression,
    result,
    created_at: new Date().toISOString()
  };
  history.push(item);
  res.status(201).json({ id: item.id });
});

const port = process.env.PORT ? Number(process.env.PORT) : 3001;
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Backend listening on http://localhost:${port}`);
});
