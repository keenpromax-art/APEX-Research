PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS research_runs (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL UNIQUE,
  idempotency_key TEXT NOT NULL UNIQUE,
  company_id TEXT NOT NULL,
  ticker TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  data_cutoff TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  envelope_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS research_runs_run_id_idx ON research_runs(run_id);
CREATE UNIQUE INDEX IF NOT EXISTS research_runs_idempotency_key_idx ON research_runs(idempotency_key);
CREATE INDEX IF NOT EXISTS research_runs_company_occurred_idx ON research_runs(company_id, occurred_at DESC, run_id DESC);

CREATE TABLE IF NOT EXISTS research_run_events (
  run_id TEXT PRIMARY KEY,
  event_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (run_id) REFERENCES research_runs(run_id) ON DELETE RESTRICT
);
