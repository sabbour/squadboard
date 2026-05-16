-- W29 MC-5: Rollback — remove charter_content column from agents table

ALTER TABLE agents DROP COLUMN IF EXISTS charter_content;
