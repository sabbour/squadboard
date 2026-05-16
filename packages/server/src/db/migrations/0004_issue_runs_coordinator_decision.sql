-- W29 MC-10: Add coordinator_decision JSONB column to issue_runs
-- Stores the full coordinator decision + call metadata for audit/debug purposes.

ALTER TABLE issue_runs ADD COLUMN IF NOT EXISTS coordinator_decision JSONB;
