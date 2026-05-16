-- W28 COST-3: Add cached_input_tokens column to cost-tracking tables
-- This enables billing for cached input tokens at reduced rates (10% of normal input for reads)

ALTER TABLE issue_runs
  ADD COLUMN cached_input_tokens INTEGER NOT NULL DEFAULT 0;

ALTER TABLE live_sessions
  ADD COLUMN cached_input_tokens INTEGER NOT NULL DEFAULT 0;

ALTER TABLE consult_sessions
  ADD COLUMN cached_input_tokens INTEGER NOT NULL DEFAULT 0;
