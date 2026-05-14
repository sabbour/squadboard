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
 * Returns the raw pg Pool (for raw-SQL transactions that Drizzle can't handle).
 * Throws if called before `initDb()`.
 */
export function getPool(): Pool {
  if (!_pool) {
    throw new Error('DB not initialised — call initDb() first');
  }
  return _pool;
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

    DO $$ BEGIN
      CREATE TYPE issue_run_kind AS ENUM ('agent_run', 'route', 'peer_review', 'split');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;

    ALTER TABLE issue_runs
      ADD COLUMN IF NOT EXISTS kind issue_run_kind NOT NULL DEFAULT 'agent_run';

    CREATE TABLE IF NOT EXISTS routing_rules (
      id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id  UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      priority    INTEGER     NOT NULL DEFAULT 0,
      pattern     TEXT        NOT NULL,
      match_type  TEXT        NOT NULL,
      agent_name  TEXT        NOT NULL,
      raw_rule    TEXT        NOT NULL,
      loaded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Demo 6: YAML workflow definitions (immutable versioned snapshots)
    CREATE TABLE IF NOT EXISTS workflows (
      id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id  UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name        TEXT        NOT NULL,
      slug        TEXT        NOT NULL,
      description TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT workflows_project_slug_unique UNIQUE (project_id, slug)
    );

    CREATE TABLE IF NOT EXISTS workflow_versions (
      id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      workflow_id             UUID        NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
      version                 INTEGER     NOT NULL,
      yaml_content            TEXT        NOT NULL,
      json_schema             TEXT,
      pinned_agent_revisions  TEXT,
      is_active               BOOLEAN     NOT NULL DEFAULT TRUE,
      created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT workflow_versions_workflow_version_unique UNIQUE (workflow_id, version)
    );

    CREATE TABLE IF NOT EXISTS issue_workflows (
      issue_id            UUID        PRIMARY KEY REFERENCES issues(id) ON DELETE CASCADE,
      workflow_version_id UUID        NOT NULL REFERENCES workflow_versions(id),
      attached_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Demo 6 additions to existing tables
    ALTER TABLE workflow_runs
      ADD COLUMN IF NOT EXISTS workflow_version_id UUID REFERENCES workflow_versions(id);

    ALTER TABLE step_runs
      ADD COLUMN IF NOT EXISTS pinned_agent_revisions TEXT;

    -- Demo 7: resilience + cost schema additions
    ALTER TABLE projects
      ADD COLUMN IF NOT EXISTS monthly_budget_usd NUMERIC(10, 2);

    ALTER TABLE issue_runs
      ADD COLUMN IF NOT EXISTS input_tokens  INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS output_tokens INTEGER DEFAULT 0;

    ALTER TABLE step_runs
      ADD COLUMN IF NOT EXISTS retry_count    INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS max_retries    INTEGER DEFAULT 3,
      ADD COLUMN IF NOT EXISTS retry_delay    INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS heartbeat_at    TIMESTAMPTZ;

    -- Demo 8: Routing Tiers 2+3 schema additions

    -- Add 'specifier_run' to the issue_run_kind enum (Invariant 1 / AC Demo8-Durability-1)
    DO $$ BEGIN
      ALTER TYPE issue_run_kind ADD VALUE IF NOT EXISTS 'specifier_run';
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;

    -- Routing audit columns on issue_runs
    ALTER TABLE issue_runs
      ADD COLUMN IF NOT EXISTS routing_tier      INTEGER,
      ADD COLUMN IF NOT EXISTS routing_score     NUMERIC(5, 4),
      ADD COLUMN IF NOT EXISTS routing_reasoning TEXT;

    -- Cached keyword sets per agent (populated on agent sync)
    CREATE TABLE IF NOT EXISTS agent_keywords (
      agent_id    UUID        PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
      keywords    TEXT        NOT NULL DEFAULT '[]',
      focus_areas TEXT        NOT NULL DEFAULT '[]',
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Immutable routing audit log (one row per routing decision)
    CREATE TABLE IF NOT EXISTS routing_log (
      id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id       UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      issue_id         UUID        REFERENCES issues(id) ON DELETE SET NULL,
      tier             INTEGER,
      resolved_agent   TEXT,
      matched_rule     TEXT,
      score            NUMERIC(5, 4),
      reasoning        TEXT,
      specifier_run_id UUID        REFERENCES issue_runs(id) ON DELETE SET NULL,
      decided_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Demo 9: Peer Review schema additions

    -- Columns on issue_runs to support peer_review kind
    ALTER TABLE issue_runs
      ADD COLUMN IF NOT EXISTS step_run_id   UUID REFERENCES step_runs(id),
      ADD COLUMN IF NOT EXISTS input_context TEXT;

    -- requestChangesPolicy on workflow_runs (default 'first' = GitHub PR semantics)
    ALTER TABLE workflow_runs
      ADD COLUMN IF NOT EXISTS request_changes_policy TEXT DEFAULT 'first';

    -- Peer review outcome columns on step_runs (approve steps only)
    ALTER TABLE step_runs
      ADD COLUMN IF NOT EXISTS review_decision    TEXT,
      ADD COLUMN IF NOT EXISTS review_comment     TEXT,
      ADD COLUMN IF NOT EXISTS review_suggestions JSONB;

    -- Audit trail: every review verb is recorded here (approve/request_changes/comment/dismiss)
    CREATE TABLE IF NOT EXISTS review_events (
      id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      workflow_run_id     UUID        NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
      step_run_id         UUID        NOT NULL REFERENCES step_runs(id) ON DELETE CASCADE,
      issue_run_id        UUID        REFERENCES issue_runs(id),
      reviewer_agent_id   UUID        REFERENCES agents(id),
      reviewer_name       TEXT,
      verb                TEXT        NOT NULL,
      body                TEXT,
      suggestions         JSONB,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Demo 10: Fan-Out + Handoff (Invariant 5)

    -- Extend run_status enum with fan_out lifecycle values
    DO $$ BEGIN
      ALTER TYPE run_status ADD VALUE IF NOT EXISTS 'splitting';
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;

    DO $$ BEGIN
      ALTER TYPE run_status ADD VALUE IF NOT EXISTS 'waiting_children';
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;

    -- Fan-out columns on workflow_runs (parent/child relationships)
    ALTER TABLE workflow_runs
      ADD COLUMN IF NOT EXISTS parent_workflow_run_id TEXT,
      ADD COLUMN IF NOT EXISTS child_workflow_run_ids JSONB DEFAULT '[]',
      ADD COLUMN IF NOT EXISTS pinned_agent_revisions TEXT,
      ADD COLUMN IF NOT EXISTS variables              JSONB DEFAULT '{}',
      ADD COLUMN IF NOT EXISTS inline_steps_json      TEXT;

    -- Fan-out columns on step_runs
    ALTER TABLE step_runs
      ADD COLUMN IF NOT EXISTS split_targets     JSONB,
      ADD COLUMN IF NOT EXISTS output            TEXT,
      ADD COLUMN IF NOT EXISTS step_config       JSONB,
      ADD COLUMN IF NOT EXISTS resolved_agent_id TEXT;

    -- issue_links: parent→child issue relationships (fan_out and handoff)
    CREATE TABLE IF NOT EXISTS issue_links (
      id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      parent_issue_id  UUID        NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
      child_issue_id   UUID        NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
      link_type        TEXT        NOT NULL DEFAULT 'fan_out',
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- handoff_context: variables and message propagated during fan_out / handoff
    CREATE TABLE IF NOT EXISTS handoff_context (
      id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      workflow_run_id  UUID        NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
      step_run_id      UUID        NOT NULL REFERENCES step_runs(id) ON DELETE CASCADE,
      target_issue_id  UUID        REFERENCES issues(id) ON DELETE SET NULL,
      context_json     JSONB       NOT NULL DEFAULT '{}',
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
