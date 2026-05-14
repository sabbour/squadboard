import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.js';

export type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>;
type Db = DrizzleDb;

let _pool: Pool | null = null;
let _db: Db | null = null;

/**
 * Initialise the Drizzle DB connection. Must be called after
 * `startEmbeddedPostgres()` resolves. Also bootstraps the schema
 * so Demo 1 works without a separate `pnpm db:push` step.
 */
export async function initDb(connectionString: string): Promise<void> {
  _pool = new Pool({ connectionString });
  _db = drizzle(_pool, { schema });

  await bootstrapSchema();
}

/**
 * Returns the initialised Drizzle DB instance.
 * Throws if called before `initDb()`.
 */
export function getDb(): Db {
  if (!_db) {
    throw new Error('DB not initialised — call initDb() first');
  }
  return _db;
}

/**
 * Creates the core tables if they do not already exist.
 * This is the Demo 1 bootstrap; proper migrations via drizzle-kit
 * (`pnpm db:generate && pnpm db:push`) supersede this on subsequent runs.
 */
async function bootstrapSchema(): Promise<void> {
  if (!_pool) throw new Error('Pool not initialised');

  await _pool.query(`
    CREATE TABLE IF NOT EXISTS projects (
      id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      name        TEXT        NOT NULL,
      path        TEXT        NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS settings (
      id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      key         TEXT        NOT NULL,
      value       TEXT,
      project_id  UUID        REFERENCES projects(id),
      CONSTRAINT settings_key_unique UNIQUE (key)
    );

    DO $$ BEGIN
      CREATE TYPE column_status AS ENUM ('backlog', 'todo', 'in_progress', 'in_review', 'done');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;

    CREATE TABLE IF NOT EXISTS issues (
      id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id   UUID          NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title        TEXT          NOT NULL,
      body         TEXT          NOT NULL DEFAULT '',
      status       column_status NOT NULL DEFAULT 'backlog',
      assignee_id  UUID,
      position     INTEGER       NOT NULL DEFAULT 0,
      archived     INTEGER       NOT NULL DEFAULT 0,
      created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS comments (
      id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      issue_id    UUID        NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
      body        TEXT        NOT NULL,
      author_id   UUID,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS labels (
      id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id  UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name        TEXT        NOT NULL,
      color       TEXT        NOT NULL DEFAULT '#388bfd',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS issue_labels (
      issue_id    UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
      label_id    UUID NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
      PRIMARY KEY (issue_id, label_id)
    );

    DO $$ BEGIN
      CREATE TYPE agent_status AS ENUM ('active', 'disabled', 'retired');
    EXCEPTION WHEN duplicate_object THEN null;
    END $$;

    CREATE TABLE IF NOT EXISTS agents (
      id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id    UUID          NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name          TEXT          NOT NULL,
      role          TEXT          NOT NULL,
      model         TEXT,
      status        agent_status  NOT NULL DEFAULT 'active',
      charter_path  TEXT          NOT NULL,
      history_path  TEXT,
      charter_hash  TEXT,
      created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
      CONSTRAINT agents_project_name_unique UNIQUE (project_id, name)
    );

    DO $$ BEGIN
      CREATE TYPE run_status AS ENUM ('pending', 'running', 'completed', 'failed', 'cancelled');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;

    DO $$ BEGIN
      CREATE TYPE workspace_strategy AS ENUM ('scratch', 'dir', 'worktree');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;

    CREATE TABLE IF NOT EXISTS issue_runs (
      id                  UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
      issue_id            UUID              NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
      agent_id            UUID              NOT NULL REFERENCES agents(id),
      status              run_status        NOT NULL DEFAULT 'pending',
      workspace_strategy  workspace_strategy NOT NULL DEFAULT 'scratch',
      workspace_path      TEXT,
      lease_expires_at    TIMESTAMPTZ,
      heartbeat_at        TIMESTAMPTZ,
      started_at          TIMESTAMPTZ,
      completed_at        TIMESTAMPTZ,
      output              TEXT,
      error_message       TEXT,
      cost_tokens         INTEGER DEFAULT 0,
      cost_usd            TEXT DEFAULT '0',
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS workflow_runs (
      id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      issue_id            UUID        NOT NULL REFERENCES issues(id),
      status              run_status  NOT NULL DEFAULT 'pending',
      current_step_index  INTEGER     DEFAULT 0,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS step_runs (
      id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      workflow_run_id  UUID        NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
      issue_run_id     UUID        REFERENCES issue_runs(id),
      step_index       INTEGER     NOT NULL,
      step_type        TEXT        NOT NULL,
      status           run_status  NOT NULL DEFAULT 'pending',
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  console.log('[db] schema bootstrapped');
}

export async function closeDb(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
    _db = null;
    console.log('[db] pool closed');
  }
}

export { schema };
