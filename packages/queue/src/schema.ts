/**
 * SQLite schema for the queue.
 *
 * Tables (all WITHOUT ROWID where the natural key is a string):
 *   - runs: top-level batch (one per `xs sync` invocation)
 *   - jobs: one per source per run, points at the active stage
 *   - attempts: append-only history of every stage attempt
 *   - dlq: jobs that exhausted retries on a single stage
 *   - cost_ledger: every LLM call with run/job/stage attribution
 *
 * Migrations bump the user_version pragma. v0 is the bootstrap schema
 * below; future migrations add columns or new tables only.
 */

export const SCHEMA_VERSION = 1;

export const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS runs (
  run_id      TEXT PRIMARY KEY,
  started_at  TEXT NOT NULL,
  finished_at TEXT,
  status      TEXT NOT NULL CHECK (status IN ('pending','running','done','failed','dead'))
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS jobs (
  job_id              TEXT PRIMARY KEY,
  run_id              TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
  source_id           TEXT NOT NULL,
  source_kind         TEXT NOT NULL,
  idempotency_key     TEXT NOT NULL,
  current_stage       TEXT NOT NULL,
  status              TEXT NOT NULL CHECK (status IN ('pending','running','done','failed','dead')),
  attempts            INTEGER NOT NULL DEFAULT 0,
  next_run_at         TEXT,
  last_error          TEXT,
  leased_at           TEXT,
  current_attempt_id  INTEGER,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  UNIQUE (run_id, source_id, idempotency_key)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS jobs_run_status_idx ON jobs (run_id, status);
CREATE INDEX IF NOT EXISTS jobs_status_next_run_idx ON jobs (status, next_run_at);

CREATE TABLE IF NOT EXISTS attempts (
  attempt_id  INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id      TEXT NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
  stage       TEXT NOT NULL,
  started_at  TEXT NOT NULL,
  finished_at TEXT,
  status      TEXT NOT NULL CHECK (status IN ('running','done','failed')),
  error_code  TEXT,
  error_msg   TEXT
);

CREATE INDEX IF NOT EXISTS attempts_job_idx ON attempts (job_id, attempt_id);

CREATE TABLE IF NOT EXISTS dlq (
  job_id     TEXT PRIMARY KEY REFERENCES jobs(job_id) ON DELETE CASCADE,
  stage      TEXT NOT NULL,
  error_code TEXT,
  error_msg  TEXT,
  added_at   TEXT NOT NULL
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS cost_ledger (
  ledger_id     TEXT PRIMARY KEY,
  recorded_at   TEXT NOT NULL,
  run_id        TEXT,
  job_id        TEXT,
  stage         TEXT,
  provider      TEXT NOT NULL,
  model         TEXT NOT NULL,
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens   INTEGER NOT NULL DEFAULT 0,
  cache_create_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd      REAL NOT NULL DEFAULT 0
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS ledger_recorded_idx ON cost_ledger (recorded_at);
CREATE INDEX IF NOT EXISTS ledger_run_idx ON cost_ledger (run_id);
`;
