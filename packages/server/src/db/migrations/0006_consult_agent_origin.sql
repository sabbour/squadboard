ALTER TABLE consult_sessions
  ADD COLUMN IF NOT EXISTS agent_origin TEXT NOT NULL DEFAULT 'project';

UPDATE consult_sessions
  SET agent_origin = 'model'
  WHERE mode = 'model' AND agent_origin = 'project';
