-- Rollback for 0001_issue_run_events: Drop all indices and the issue_run_events table

DROP INDEX IF EXISTS issue_run_events_run_created_idx;
DROP INDEX IF EXISTS issue_run_events_run_seq_idx;
DROP TABLE IF EXISTS issue_run_events;
