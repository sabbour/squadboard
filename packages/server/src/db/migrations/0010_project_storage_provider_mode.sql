ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS storage_provider_mode TEXT;
