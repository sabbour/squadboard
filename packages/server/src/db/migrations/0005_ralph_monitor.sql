-- Parity 6: Ralph-style autonomous work monitor opt-in, state, and audit log.

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS ralph_autonomy_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS ralph_auto_merge_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS ralph_monitor_state TEXT NOT NULL DEFAULT 'stopped',
  ADD COLUMN IF NOT EXISTS ralph_monitor_last_action JSONB,
  ADD COLUMN IF NOT EXISTS ralph_monitor_next_action JSONB,
  ADD COLUMN IF NOT EXISTS ralph_monitor_last_decision_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS ralph_monitor_events (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  state         TEXT        NOT NULL,
  decision      TEXT        NOT NULL,
  action        TEXT        NOT NULL,
  reason        TEXT        NOT NULL,
  selected_kind TEXT,
  target_type   TEXT,
  target_id     TEXT,
  payload       JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ralph_monitor_events_project_created_idx
  ON ralph_monitor_events (project_id, created_at DESC);
