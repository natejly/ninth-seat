# Data Model (MVP)

## Persistence
**None for MVP.** All state is in-memory in the browser.

## In-memory state (authoritative)
See `CalcState` in ARCHITECTURE.md.

## Future (nice-to-have) — if adding history
If implementing calculation history later (still no backend), use `localStorage`:
- Key: `calc.history`
- Value: JSON array of entries:
  - `{ expression: "2+3", result: "5", ts: "2026-02-24T..." }`

No schema migrations required for MVP.
