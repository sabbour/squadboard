-- Rollback Parity 6 Ralph monitor state and audit log.

DROP TABLE IF EXISTS ralph_monitor_events;

ALTER TABLE projects
  DROP COLUMN IF EXISTS ralph_monitor_last_decision_at,
  DROP COLUMN IF EXISTS ralph_monitor_next_action,
  DROP COLUMN IF EXISTS ralph_monitor_last_action,
  DROP COLUMN IF EXISTS ralph_monitor_state,
  DROP COLUMN IF EXISTS ralph_auto_merge_enabled,
  DROP COLUMN IF EXISTS ralph_autonomy_enabled;
