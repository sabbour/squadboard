-- Wave 28 — JIS-T1: issue_run_events
-- Append-only event log for in-flight issue runs.
-- event_type values: start | turn | token | tool_call | tool_result | metric | finish | error | steered

CREATE TABLE IF NOT EXISTS issue_run_events (
  id          BIGSERIAL   PRIMARY KEY,
  run_id      UUID        NOT NULL REFERENCES issue_runs(id) ON DELETE CASCADE,
  seq         INTEGER     NOT NULL,
  event_type  TEXT        NOT NULL,
  payload     JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT  issue_run_events_run_seq_uniq UNIQUE (run_id, seq)
);

-- Ordered fetch index (primary use: replay on reconnect, SSE polling)
CREATE INDEX IF NOT EXISTS issue_run_events_run_seq_idx
  ON issue_run_events (run_id, seq ASC);

-- Time-range index (secondary use: since_created queries, cleanup)
CREATE INDEX IF NOT EXISTS issue_run_events_run_created_idx
  ON issue_run_events (run_id, created_at);
