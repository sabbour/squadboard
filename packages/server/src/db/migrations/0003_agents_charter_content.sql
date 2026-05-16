-- W29 MC-5: Add charter_content column to agents table
-- This column stores the full markdown content of each agent's charter for LLM access.
-- The backfill service populates this on first boot.

ALTER TABLE agents ADD COLUMN IF NOT EXISTS charter_content TEXT NOT NULL DEFAULT '';
