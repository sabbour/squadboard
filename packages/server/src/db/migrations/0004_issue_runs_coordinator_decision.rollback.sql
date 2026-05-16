-- W29 MC-10: Rollback — remove coordinator_decision column from issue_runs

ALTER TABLE issue_runs DROP COLUMN IF EXISTS coordinator_decision;
