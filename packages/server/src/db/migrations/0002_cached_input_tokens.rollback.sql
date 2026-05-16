-- Rollback for 0002_cached_input_tokens: Remove cached_input_tokens columns from cost-tracking tables

ALTER TABLE issue_runs DROP COLUMN IF EXISTS cached_input_tokens;
ALTER TABLE live_sessions DROP COLUMN IF EXISTS cached_input_tokens;
ALTER TABLE consult_sessions DROP COLUMN IF EXISTS cached_input_tokens;
