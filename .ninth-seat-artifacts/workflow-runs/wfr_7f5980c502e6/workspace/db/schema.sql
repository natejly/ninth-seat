-- Optional persistence schema (SQLite/PostgreSQL compatible with minor tweaks)

-- Sessions are anonymous; created client-side and sent as UUID.
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
