-- 0009_squad_storage.sql
-- Kobayashi: PostgreSQL-backed Squad StorageProvider table.
-- Stores virtual file-system entries for the Squad SDK StorageProvider adapter.
-- Each row is a (scope, path) pair where scope = project-id (UUID) and path is
-- the normalized POSIX path relative to the project .squad/ root.

CREATE TABLE IF NOT EXISTS squad_storage (
  scope      TEXT NOT NULL,           -- project UUID (or 'global' for unscoped callers)
  path       TEXT NOT NULL,           -- normalized POSIX path, no leading slash
  content    TEXT NOT NULL DEFAULT '',
  size_bytes BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (scope, path)
);

CREATE INDEX IF NOT EXISTS idx_squad_storage_scope ON squad_storage (scope);
