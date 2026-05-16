import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.js';
import {
  getPglite,
  PGLITE_SENTINEL,
  createPoolAdapter,
  type PoolLike,
} from './pglite.js';

// ─── Drizzle DB type ─────────────────────────────────────────────────────────
// Both drizzle-orm/pglite and drizzle-orm/node-postgres extend PgDatabase and
// expose an identical query API (select/insert/update/delete/etc.).
// We expose the PgliteDatabase type as the canonical type. When the pg pool is
// used (DATABASE_URL mode), the drizzle-orm/node-postgres instance is cast to
// this type — safe at runtime because the query builder interface is the same.
export type DrizzleDb = ReturnType<typeof drizzlePglite<typeof schema>>;
type Db = DrizzleDb;

// Always PoolLike so bootstrapSchema() and getPool() callers have a stable API.
let _pool: PoolLike | null = null;
let _db: Db | null = null;

/**
 * Initialise the Drizzle DB connection. Must be called after
 * `startPglite()` (or `startEmbeddedPostgres()`) resolves. Also bootstraps
 * the schema so Demo 1 works without a separate `pnpm db:push` step.
 *
 * @param connectionOrSentinel Either the PGLITE_SENTINEL (→ PGlite mode) or a
 *   real postgres:// connection string (→ external Postgres via pg.Pool).
 */
export async function initDb(connectionOrSentinel: string): Promise<void> {
  if (connectionOrSentinel === PGLITE_SENTINEL) {
    // ── PGlite mode ──────────────────────────────────────────────────────
    const pglite = getPglite();
    if (!pglite) throw new Error('[db] PGlite sentinel returned but no PGlite instance found');
    _db = drizzlePglite(pglite, { schema });
    _pool = createPoolAdapter(pglite);
  } else {
    // ── External Postgres mode (DATABASE_URL override) ───────────────────
    const pgPool = new Pool({ connectionString: connectionOrSentinel });
    // Cast is safe: NodePgDatabase and PgliteDatabase share the same
    // PgDatabase query-builder API; only the HKT generic differs internally.
    _db = drizzlePg(pgPool, { schema }) as unknown as Db;
    _pool = wrapPgPool(pgPool);
  }

  await bootstrapSchema();
}

/** Wrap a real pg.Pool in the PoolLike interface used by getPool() callers. */
function wrapPgPool(pool: Pool): PoolLike {
  // The PoolLike query generic (R extends Record<string,unknown>) is structurally
  // compatible with pg's Pool.query return type. We cast after wrapping.
  const runQuery = async (sql: string, params?: unknown[]) => {
    const r = await pool.query(sql, params as never[]);
    return { rows: r.rows as Record<string, unknown>[], rowCount: r.rowCount };
  };
  return {
    query: runQuery as PoolLike['query'],
    connect: async () => {
      const client = await pool.connect();
      return {
        query: (async (sql: string, params?: unknown[]) => {
          const r = await client.query(sql, params as never[]);
          return { rows: r.rows as Record<string, unknown>[], rowCount: r.rowCount };
        }) as PoolLike['query'],
        release: () => client.release(),
      };
    },
    end: async () => pool.end(),
  };
}

/**
 * Returns the pool-like handle for raw-SQL queries.
 * In PGlite mode this is a PoolLike adapter; in external-PG mode a wrapped pg.Pool.
 * Throws if called before `initDb()`.
 */
export function getPool(): PoolLike {
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

    -- Phase 15: parallel SDK fan-out spawn — opaque SDK session id is stamped
    -- onto the child's first step_run when spawned via spawnParallel().
    ALTER TABLE step_runs
      ADD COLUMN IF NOT EXISTS session_id        TEXT,
      ADD COLUMN IF NOT EXISTS started_at        TIMESTAMPTZ;

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

    -- Demo 12: Optimistic concurrency token on issues (OQ #6)
    ALTER TABLE issues
      ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

    -- Demo 15: GitHub Sync schema additions (OQ #8 resolution — opt-in per project)

    -- projects: sync configuration columns
    ALTER TABLE projects
      ADD COLUMN IF NOT EXISTS github_sync_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS github_token        TEXT,
      ADD COLUMN IF NOT EXISTS github_owner        TEXT,
      ADD COLUMN IF NOT EXISTS github_repo         TEXT,
      ADD COLUMN IF NOT EXISTS github_sync_last_at TIMESTAMPTZ;

    -- issues: GitHub link columns
    ALTER TABLE issues
      ADD COLUMN IF NOT EXISTS github_issue_number INTEGER,
      ADD COLUMN IF NOT EXISTS github_issue_url    TEXT,
      ADD COLUMN IF NOT EXISTS github_node_id      TEXT;

    -- comments: GitHub comment link
    ALTER TABLE comments
      ADD COLUMN IF NOT EXISTS github_comment_id TEXT;

    -- GitHub App auth fields on projects (null github_auth_type = PAT for backward compat)
    ALTER TABLE projects
      ADD COLUMN IF NOT EXISTS github_auth_type            TEXT,
      ADD COLUMN IF NOT EXISTS github_app_id               TEXT,
      ADD COLUMN IF NOT EXISTS github_app_installation_id  TEXT,
      ADD COLUMN IF NOT EXISTS github_app_private_key      TEXT;

    -- Project-level default model (used by auto-resolution chain when neither
    -- the session nor the agent specifies one). NULL = use built-in fallback.
    ALTER TABLE projects
      ADD COLUMN IF NOT EXISTS default_model TEXT;

    -- github_sync_log: audit trail for every sync operation
    CREATE TABLE IF NOT EXISTS github_sync_log (
      id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id   UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      direction    TEXT        NOT NULL,  -- 'push' | 'pull'
      entity_type  TEXT        NOT NULL,  -- 'issue' | 'comment' | 'batch'
      entity_id    TEXT        NOT NULL,  -- local UUID or GitHub number as string
      github_number INTEGER,
      status       TEXT        NOT NULL,  -- 'ok' | 'error'
      error_msg    TEXT,
      synced_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Squad-IRL run-first slice: live multi-agent sessions
    DO $$ BEGIN
      CREATE TYPE live_session_status AS ENUM ('active', 'idle', 'completed', 'failed', 'cancelled');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;

    CREATE TABLE IF NOT EXISTS live_sessions (
      id              UUID                PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id      UUID                NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      agent_id        UUID                REFERENCES agents(id) ON DELETE SET NULL,
      agent_name      TEXT,
      title           TEXT,
      status          live_session_status NOT NULL DEFAULT 'active',
      model           TEXT,
      sdk_session_id  TEXT,
      input_tokens    INTEGER             NOT NULL DEFAULT 0,
      output_tokens   INTEGER             NOT NULL DEFAULT 0,
      cost_usd        NUMERIC(12, 6)      NOT NULL DEFAULT 0,
      turn_count      INTEGER             NOT NULL DEFAULT 0,
      error_message   TEXT,
      created_at      TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
      completed_at    TIMESTAMPTZ
    );

    CREATE INDEX IF NOT EXISTS live_sessions_project_idx
      ON live_sessions (project_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS live_session_events (
      id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      session_id  UUID        NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
      type        TEXT        NOT NULL,
      payload     JSONB       NOT NULL DEFAULT '{}'::jsonb,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS live_session_events_session_idx
      ON live_session_events (session_id, created_at);

    -- Phase 8: Review policies — workflow approve-step primitives
    CREATE TABLE IF NOT EXISTS review_policy_presets (
      id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      scope        TEXT        NOT NULL,
      project_id   UUID        REFERENCES projects(id) ON DELETE CASCADE,
      slug         TEXT        NOT NULL,
      name         TEXT        NOT NULL,
      description  TEXT,
      payload      JSONB       NOT NULL,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT review_policy_presets_scope_chk
        CHECK (scope IN ('system', 'project')),
      CONSTRAINT review_policy_presets_scope_project_chk
        CHECK ((scope = 'system' AND project_id IS NULL)
            OR (scope = 'project' AND project_id IS NOT NULL))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS review_policy_presets_system_slug_uniq
      ON review_policy_presets (slug)
      WHERE scope = 'system';

    CREATE UNIQUE INDEX IF NOT EXISTS review_policy_presets_project_slug_uniq
      ON review_policy_presets (project_id, slug)
      WHERE scope = 'project';

    CREATE TABLE IF NOT EXISTS review_policy_defaults (
      id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      scope       TEXT        NOT NULL,
      scope_id    UUID        NOT NULL,
      payload     JSONB       NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT review_policy_defaults_scope_chk
        CHECK (scope IN ('project', 'board'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS review_policy_defaults_scope_uniq
      ON review_policy_defaults (scope, scope_id);

    -- Phase 9: Comment thread becomes a multi-actor timeline ----------------
    ALTER TABLE comments
      ADD COLUMN IF NOT EXISTS author_kind   TEXT        NOT NULL DEFAULT 'human',
      ADD COLUMN IF NOT EXISTS author_ref    TEXT,
      ADD COLUMN IF NOT EXISTS mentions      JSONB       NOT NULL DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS event_kind    TEXT,
      ADD COLUMN IF NOT EXISTS event_payload JSONB;

    DO $$ BEGIN
      ALTER TABLE comments
        ADD CONSTRAINT comments_author_kind_chk
        CHECK (author_kind IN ('human', 'agent', 'system'));
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;

    CREATE INDEX IF NOT EXISTS comments_issue_created_idx
      ON comments (issue_id, created_at);

    -- Phase 9: Deliverables — first-class artifact records ------------------
    CREATE TABLE IF NOT EXISTS deliverables (
      id                            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      issue_id                      UUID        NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
      run_id                        UUID        REFERENCES issue_runs(id) ON DELETE SET NULL,
      step_run_id                   UUID        REFERENCES step_runs(id) ON DELETE SET NULL,
      kind                          TEXT        NOT NULL,
      title                         TEXT        NOT NULL,
      summary                       TEXT,
      payload                       JSONB       NOT NULL,
      status                        TEXT        NOT NULL DEFAULT 'submitted',
      produced_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      superseded_by_deliverable_id  UUID        REFERENCES deliverables(id) ON DELETE SET NULL,
      created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT deliverables_kind_chk
        CHECK (kind IN ('text', 'files', 'links', 'structured')),
      CONSTRAINT deliverables_status_chk
        CHECK (status IN ('draft', 'submitted', 'approved', 'changes_requested', 'superseded'))
    );

    CREATE INDEX IF NOT EXISTS deliverables_issue_idx
      ON deliverables (issue_id, produced_at DESC);

    CREATE INDEX IF NOT EXISTS deliverables_run_idx
      ON deliverables (run_id);

    -- Phase 9: review_events extends to deliverable reviews -----------------
    -- Make stepRunId/workflowRunId nullable + add deliverable_id column with
    -- CHECK that exactly one of (step_run_id, deliverable_id) is set.
    ALTER TABLE review_events
      ALTER COLUMN step_run_id DROP NOT NULL,
      ALTER COLUMN workflow_run_id DROP NOT NULL,
      ADD COLUMN IF NOT EXISTS deliverable_id UUID REFERENCES deliverables(id) ON DELETE CASCADE;

    DO $$ BEGIN
      ALTER TABLE review_events
        ADD CONSTRAINT review_events_target_chk
        CHECK (
          (step_run_id IS NOT NULL AND deliverable_id IS NULL) OR
          (step_run_id IS NULL     AND deliverable_id IS NOT NULL)
        );
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;

    CREATE INDEX IF NOT EXISTS review_events_deliverable_idx
      ON review_events (deliverable_id, created_at)
      WHERE deliverable_id IS NOT NULL;

    -- Phase 14: Quick capture (AI-formulated inbox) -----------------------
    CREATE TABLE IF NOT EXISTS inbox_items (
      id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id               UUID,
      original_draft        TEXT        NOT NULL,
      formulated_title      TEXT,
      formulated_body       TEXT,
      suggested_labels      JSONB       NOT NULL DEFAULT '[]'::jsonb,
      suggested_project_id  UUID        REFERENCES projects(id) ON DELETE SET NULL,
      suggested_column      TEXT,
      confidence            TEXT,
      rationale             TEXT,
      status                TEXT        NOT NULL DEFAULT 'captured',
      published_issue_id    UUID        REFERENCES issues(id) ON DELETE SET NULL,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    DO $$ BEGIN
      ALTER TABLE inbox_items
        ADD CONSTRAINT inbox_items_status_chk
        CHECK (status IN ('captured', 'formulated', 'published', 'discarded'));
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;

    CREATE INDEX IF NOT EXISTS inbox_items_status_created_idx
      ON inbox_items (status, created_at DESC);

    CREATE INDEX IF NOT EXISTS inbox_items_user_idx
      ON inbox_items (user_id, created_at DESC);

    -- Phase 10: Ceremonies unification --------------------------------------
    -- Workflows become a triggerKind of "ceremony". DB columns added in-place
    -- (the table keeps its historical name); API + UI rename to "ceremony".
    --
    --   trigger_kind   : on_issue_entry | on_schedule | on_event | manual
    --   trigger_config : jsonb shape depends on trigger_kind
    --   kind           : workflow | ceremony | review_policy | narrative
    ALTER TABLE workflows
      ADD COLUMN IF NOT EXISTS trigger_kind   TEXT  NOT NULL DEFAULT 'on_issue_entry';
    ALTER TABLE workflows
      ADD COLUMN IF NOT EXISTS trigger_config JSONB NOT NULL DEFAULT '{}'::jsonb;
    ALTER TABLE workflows
      ADD COLUMN IF NOT EXISTS kind           TEXT  NOT NULL DEFAULT 'ceremony';

    -- Backfill existing rows so behaviour does not change: anything older
    -- than five minutes is an existing workflow → kind='workflow' (default
    -- 'ceremony' applies only to brand-new rows created post-Phase-10).
    UPDATE workflows
       SET kind = 'workflow'
     WHERE kind = 'ceremony'
       AND created_at < (now() - interval '5 minutes');

    -- Phase 11: Markdown ceremony auto-convert ------------------------------
    -- status:     lifecycle gate for trigger eligibility
    -- parent_narrative_id: self-FK back to the kind='narrative' source row
    -- last_translation_error / _attempt_at: translator failure surface
    ALTER TABLE workflows
      ADD COLUMN IF NOT EXISTS status                       TEXT        NOT NULL DEFAULT 'active';
    ALTER TABLE workflows
      ADD COLUMN IF NOT EXISTS parent_narrative_id          UUID        REFERENCES workflows(id) ON DELETE SET NULL;
    ALTER TABLE workflows
      ADD COLUMN IF NOT EXISTS last_translation_error       TEXT;
    ALTER TABLE workflows
      ADD COLUMN IF NOT EXISTS last_translation_attempt_at  TIMESTAMPTZ;

    -- New table: ceremony_schedules (heartbeat sweep target for on_schedule).
    CREATE TABLE IF NOT EXISTS ceremony_schedules (
      id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      workflow_id   UUID        NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
      cron_expr     TEXT        NOT NULL,
      timezone      TEXT        NOT NULL DEFAULT 'UTC',
      next_fire_at  TIMESTAMPTZ NOT NULL,
      last_fired_at TIMESTAMPTZ,
      enabled       BOOLEAN     NOT NULL DEFAULT TRUE,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_ceremony_schedules_next_fire
      ON ceremony_schedules (next_fire_at)
      WHERE enabled = TRUE;

    -- ---------------------------------------------------------------------
    -- Phase 13: Skills, Tools, MCP servers — capability registries
    -- ---------------------------------------------------------------------
    CREATE TABLE IF NOT EXISTS skills (
      id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id      UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      key             TEXT        NOT NULL,
      name            TEXT        NOT NULL,
      description     TEXT,
      category        TEXT,
      prompt_addendum TEXT        NOT NULL,
      curated_key     TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT skills_project_key_unique UNIQUE (project_id, key)
    );

    CREATE TABLE IF NOT EXISTS agent_skills (
      agent_id    UUID        NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      skill_id    UUID        NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
      assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (agent_id, skill_id)
    );

    CREATE TABLE IF NOT EXISTS tools (
      id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id      UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      key             TEXT        NOT NULL,
      name            TEXT        NOT NULL,
      description     TEXT        NOT NULL,
      category        TEXT,
      mcp_server_id   UUID,
      input_schema    JSONB,
      output_schema   JSONB,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT tools_project_key_unique UNIQUE (project_id, key)
    );

    CREATE TABLE IF NOT EXISTS agent_tools (
      agent_id    UUID        NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      tool_id     UUID        NOT NULL REFERENCES tools(id) ON DELETE CASCADE,
      assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (agent_id, tool_id)
    );

    CREATE TABLE IF NOT EXISTS mcp_servers (
      id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id   UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name         TEXT        NOT NULL,
      description  TEXT,
      transport    TEXT        NOT NULL,
      url          TEXT,
      command      TEXT,
      args         JSONB       NOT NULL DEFAULT '[]'::jsonb,
      headers      JSONB       NOT NULL DEFAULT '[]'::jsonb,
      headers_iv   TEXT,
      headers_tag  TEXT,
      enabled      BOOLEAN     NOT NULL DEFAULT TRUE,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS agent_mcp_servers (
      agent_id      UUID        NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      mcp_server_id UUID        NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
      assigned_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (agent_id, mcp_server_id)
    );

    -- Now that mcp_servers exists, link tools.mcp_server_id with ON DELETE SET NULL.
    DO $$ BEGIN
      ALTER TABLE tools
        ADD CONSTRAINT tools_mcp_server_fk
        FOREIGN KEY (mcp_server_id) REFERENCES mcp_servers(id) ON DELETE SET NULL;
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;

    -- Phase 17: Ask / Consult mode — free-form brainstorm sessions.
    DO $$ BEGIN
      CREATE TYPE consult_mode AS ENUM ('agent', 'model');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;

    DO $$ BEGIN
      CREATE TYPE consult_status AS ENUM ('active', 'idle', 'completed', 'failed', 'cancelled');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;

    DO $$ BEGIN
      CREATE TYPE consult_message_role AS ENUM ('user', 'assistant', 'system', 'tool');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;

    DO $$ BEGIN
      CREATE TYPE consult_proposal_kind AS ENUM (
        'issue', 'ceremony', 'inbox_item', 'capture_to_decision', 'assign_agent_to_issue'
      );
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;

    DO $$ BEGIN
      CREATE TYPE consult_proposal_status AS ENUM ('pending', 'accepted', 'edited', 'discarded');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;

    CREATE TABLE IF NOT EXISTS consult_sessions (
      id                       UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id               UUID            REFERENCES projects(id) ON DELETE CASCADE,
      name                     TEXT,
      mode                     consult_mode    NOT NULL DEFAULT 'agent',
      agent_id                 UUID            REFERENCES agents(id) ON DELETE SET NULL,
      agent_name               TEXT,
      model                    TEXT,
      status                   consult_status  NOT NULL DEFAULT 'active',
      sdk_session_id           TEXT,
      input_tokens             INTEGER         NOT NULL DEFAULT 0,
      output_tokens            INTEGER         NOT NULL DEFAULT 0,
      cost_usd                 NUMERIC(12, 6)  NOT NULL DEFAULT 0,
      message_count            INTEGER         NOT NULL DEFAULT 0,
      forked_from_session_id   UUID,
      error_message            TEXT,
      started_at               TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
      ended_at                 TIMESTAMPTZ,
      created_at               TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
      updated_at               TIMESTAMPTZ     NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS consult_sessions_project_idx
      ON consult_sessions (project_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS consult_sessions_created_idx
      ON consult_sessions (created_at DESC);

    CREATE TABLE IF NOT EXISTS consult_messages (
      id                UUID                  PRIMARY KEY DEFAULT gen_random_uuid(),
      session_id        UUID                  NOT NULL REFERENCES consult_sessions(id) ON DELETE CASCADE,
      role              consult_message_role  NOT NULL,
      content           TEXT                  NOT NULL DEFAULT '',
      reasoning_content TEXT,
      tool_name         TEXT,
      tool_args         JSONB,
      tool_result       JSONB,
      input_tokens      INTEGER,
      output_tokens     INTEGER,
      cost_usd          NUMERIC(12, 6),
      ts                TIMESTAMPTZ           NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS consult_messages_session_idx
      ON consult_messages (session_id, ts);

    CREATE TABLE IF NOT EXISTS consult_proposals (
      id              UUID                      PRIMARY KEY DEFAULT gen_random_uuid(),
      session_id      UUID                      NOT NULL REFERENCES consult_sessions(id) ON DELETE CASCADE,
      message_id      UUID                      REFERENCES consult_messages(id) ON DELETE SET NULL,
      kind            consult_proposal_kind     NOT NULL,
      payload         JSONB                     NOT NULL DEFAULT '{}'::jsonb,
      edited_payload  JSONB,
      status          consult_proposal_status   NOT NULL DEFAULT 'pending',
      result          JSONB,
      error_message   TEXT,
      created_at      TIMESTAMPTZ               NOT NULL DEFAULT NOW(),
      decided_at      TIMESTAMPTZ
    );

    CREATE INDEX IF NOT EXISTS consult_proposals_session_idx
      ON consult_proposals (session_id, created_at);
    CREATE INDEX IF NOT EXISTS consult_proposals_status_idx
      ON consult_proposals (status);

    -- Phase dynamic-columns: column_meta is the source of truth for project columns.
    -- New columns: semantic (roll-up bucket) and is_default (new-issue landing column).
    CREATE TABLE IF NOT EXISTS column_meta (
      id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id  UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      column_id   TEXT        NOT NULL,
      label       TEXT        NOT NULL,
      description TEXT,
      color       TEXT        NOT NULL,
      position    INTEGER     NOT NULL DEFAULT 0,
      semantic    TEXT        NOT NULL DEFAULT 'custom',
      is_default  BOOLEAN     NOT NULL DEFAULT false,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE UNIQUE INDEX IF NOT EXISTS column_meta_project_column_uq
      ON column_meta (project_id, column_id);

    -- Image attachments — binary content stored in BYTEA (5 MB cap enforced in service layer)
    CREATE TABLE IF NOT EXISTS issue_attachments (
      id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      issue_id    UUID        NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
      filename    TEXT        NOT NULL,
      mime_type   TEXT        NOT NULL,
      size_bytes  INTEGER     NOT NULL,
      content     BYTEA       NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS issue_attachments_issue_idx
      ON issue_attachments (issue_id, created_at);

    -- Phase 19: Templates & Portability
    CREATE TABLE IF NOT EXISTS templates (
      id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      kind        TEXT        NOT NULL,
      name        TEXT        NOT NULL,
      description TEXT,
      payload     JSONB       NOT NULL,
      project_id  UUID        REFERENCES projects(id) ON DELETE SET NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT templates_kind_chk CHECK (kind IN ('workflow', 'team', 'project'))
    );

    CREATE INDEX IF NOT EXISTS templates_kind_name_idx
      ON templates (kind, name);
  `);

  // ---------------------------------------------------------------------------
  // Phase dynamic-columns: idempotent migration from column_status enum → TEXT
  // Runs on every server start; all steps are no-ops once applied.
  // ---------------------------------------------------------------------------
  await _pool.query(`
    -- Step 1: If the Postgres column_status enum still exists, migrate issues.status
    -- to plain TEXT (enum→text is implicit in Postgres; USING clause is explicit for safety).
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'column_status') THEN
        ALTER TABLE issues ALTER COLUMN status TYPE TEXT USING status::TEXT;
        ALTER TABLE issues ALTER COLUMN status SET DEFAULT 'backlog';
        DROP TYPE column_status;
      END IF;
    END $$;

    -- Step 2: Add semantic and is_default columns to column_meta if not present.
    ALTER TABLE column_meta
      ADD COLUMN IF NOT EXISTS semantic    TEXT    NOT NULL DEFAULT 'custom',
      ADD COLUMN IF NOT EXISTS is_default  BOOLEAN NOT NULL DEFAULT false;

    -- Step 3: Backfill semantic roll-up values for the 5 seed columns.
    UPDATE column_meta SET semantic = 'backlog'     WHERE column_id = 'backlog'     AND semantic = 'custom';
    UPDATE column_meta SET semantic = 'ready'       WHERE column_id = 'todo'        AND semantic = 'custom';
    UPDATE column_meta SET semantic = 'in_progress' WHERE column_id = 'in_progress' AND semantic = 'custom';
    UPDATE column_meta SET semantic = 'review'      WHERE column_id = 'in_review'   AND semantic = 'custom';
    UPDATE column_meta SET semantic = 'done'        WHERE column_id = 'done'        AND semantic = 'custom';

    -- Step 4: Backfill is_default=true on the backlog column for every project
    -- that does not yet have any column marked as default.
    UPDATE column_meta
    SET    is_default = true
    WHERE  column_id  = 'backlog'
    AND    project_id NOT IN (
      SELECT DISTINCT project_id FROM column_meta WHERE is_default = true
    );
  `);

  // ---------------------------------------------------------------------------
  // Wave 10 D2: skill provenance tracking — distinguish curated/imported/custom
  // skills so the UI can render a "From: built-in catalog" / "From: import"
  // badge. Backfills `source='curated'` for any skill that already has a
  // curatedKey set.
  // ---------------------------------------------------------------------------
  await _pool.query(`
    ALTER TABLE skills
      ADD COLUMN IF NOT EXISTS source     TEXT NOT NULL DEFAULT 'custom',
      ADD COLUMN IF NOT EXISTS source_uri TEXT;

    UPDATE skills
    SET    source = 'curated'
    WHERE  curated_key IS NOT NULL
    AND    source = 'custom';
  `);

  // ---------------------------------------------------------------------------
  // Wave 10 D3: tool + MCP-server provenance tracking — same pattern as D2.
  // ---------------------------------------------------------------------------
  await _pool.query(`
    ALTER TABLE tools
      ADD COLUMN IF NOT EXISTS source     TEXT NOT NULL DEFAULT 'custom',
      ADD COLUMN IF NOT EXISTS source_uri TEXT;

    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'mcp_servers') THEN
        ALTER TABLE mcp_servers
          ADD COLUMN IF NOT EXISTS source     TEXT NOT NULL DEFAULT 'custom',
          ADD COLUMN IF NOT EXISTS source_uri TEXT;
      END IF;
    END $$;
  `);

  // ---------------------------------------------------------------------------
  // Wave 10 D4: ceremony trigger source. workflow_runs.trigger_source records
  // whether the run was spawned manually, by the schedule sweep, or by an
  // event (and which event/schedule). Surfaced on the runs list.
  // ---------------------------------------------------------------------------
  await _pool.query(`
    ALTER TABLE workflow_runs
      ADD COLUMN IF NOT EXISTS trigger_source jsonb;
  `);

  // ---------------------------------------------------------------------------
  // Wave 10 D6: GitHub Copilot premium-request multipliers. Adds an
  // alternate cost rollup column on issue_runs / workflow_runs / consult_sessions
  // (USD remains the default). Adds projects.cost_model so each project can
  // pick which cost model the Costs page shows; env SQUADBOARD_COST_MODEL is
  // the default when null.
  // ---------------------------------------------------------------------------
  await _pool.query(`
    ALTER TABLE issue_runs
      ADD COLUMN IF NOT EXISTS premium_requests numeric(12, 4) DEFAULT 0;

    ALTER TABLE workflow_runs
      ADD COLUMN IF NOT EXISTS premium_requests numeric(12, 4) DEFAULT 0;

    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'consult_sessions') THEN
        ALTER TABLE consult_sessions
          ADD COLUMN IF NOT EXISTS premium_requests numeric(12, 4) NOT NULL DEFAULT 0;
      END IF;
    END $$;

    ALTER TABLE projects
      ADD COLUMN IF NOT EXISTS cost_model text;
  `);

  // Wave 12 — N2: Double-pickup prevention on inbox_items.
  //   idempotency_key: caller-supplied dedup token; same key = same row.
  //   created_by:      provenance tag ('user'|'copilot-cli'|'squadboard-server'|'webhook').
  //   claimed_by:      opaque worker/session ID that holds the claim lease.
  //   claim_expires_at: UTC timestamp; NULL or past = unclaimed / lease expired.
  await _pool.query(`
    ALTER TABLE inbox_items
      ADD COLUMN IF NOT EXISTS idempotency_key   TEXT        UNIQUE,
      ADD COLUMN IF NOT EXISTS created_by        TEXT        NOT NULL DEFAULT 'user',
      ADD COLUMN IF NOT EXISTS claimed_by        TEXT,
      ADD COLUMN IF NOT EXISTS claim_expires_at  TIMESTAMPTZ;

    CREATE INDEX IF NOT EXISTS inbox_items_idempotency_idx
      ON inbox_items (idempotency_key)
      WHERE idempotency_key IS NOT NULL;

    CREATE INDEX IF NOT EXISTS inbox_items_claim_idx
      ON inbox_items (claimed_by, claim_expires_at)
      WHERE claimed_by IS NOT NULL;
  `);

  // Wave 13 — Bulk-import: provenance + done-timestamp on issues.
  await _pool.query(`
    ALTER TABLE issues
      ADD COLUMN IF NOT EXISTS completed_at  TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS created_by    TEXT NOT NULL DEFAULT 'user';
  `);

  // Wave 17 — Stream G Phase 2A: git/PR state cached on issue_runs for fast card badges.
  await _pool.query(`
    ALTER TABLE issue_runs
      ADD COLUMN IF NOT EXISTS git_branch              TEXT,
      ADD COLUMN IF NOT EXISTS git_branch_url          TEXT,
      ADD COLUMN IF NOT EXISTS pr_number               INTEGER,
      ADD COLUMN IF NOT EXISTS pr_url                  TEXT,
      ADD COLUMN IF NOT EXISTS pr_state                TEXT,
      ADD COLUMN IF NOT EXISTS ci_state                TEXT,
      ADD COLUMN IF NOT EXISTS ci_url                  TEXT,
      ADD COLUMN IF NOT EXISTS git_cache_refreshed_at  TIMESTAMPTZ;
  `);

  // Wave 18 — Stream G Phase 2B: GitHub event ingest + ceremony idempotency.
  await _pool.query(`
    -- github_events: raw webhook event log for audit and replay
    CREATE TABLE IF NOT EXISTS github_events (
      id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      event_type           TEXT        NOT NULL,
      action               TEXT,
      payload              JSONB       NOT NULL,
      delivery_id          TEXT,
      project_id_resolved  UUID        REFERENCES projects(id) ON DELETE SET NULL,
      received_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      processed_at         TIMESTAMPTZ,
      processed_outcome    TEXT
    );

    CREATE INDEX IF NOT EXISTS github_events_event_type_idx
      ON github_events (event_type, received_at DESC);

    CREATE INDEX IF NOT EXISTS github_events_project_idx
      ON github_events (project_id_resolved, received_at DESC)
      WHERE project_id_resolved IS NOT NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS github_events_delivery_id_uq
      ON github_events (delivery_id)
      WHERE delivery_id IS NOT NULL;

    -- github_webhook_secret on projects: per-project HMAC secret for X-Hub-Signature-256
    ALTER TABLE projects
      ADD COLUMN IF NOT EXISTS github_webhook_secret TEXT;

    -- ceremony_github_fires: idempotency guard — one row per (slug, delivery_id) pair
    CREATE TABLE IF NOT EXISTS ceremony_github_fires (
      id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      ceremony_slug  TEXT        NOT NULL,
      delivery_id    TEXT        NOT NULL,
      fired_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE UNIQUE INDEX IF NOT EXISTS ceremony_github_fires_uq
      ON ceremony_github_fires (ceremony_slug, delivery_id);
  `);

  await seedSystemReviewPolicyPresets();

  console.log('[db] schema bootstrapped');
}

// ---------------------------------------------------------------------------
// System review-policy presets — seeded idempotently on every boot.
// Match key: (scope='system', slug). Payload is overwritten so Squadboard
// upgrades pick up new defaults without manual migration; users customise
// by cloning a system preset to scope='project'.
// ---------------------------------------------------------------------------

const SYSTEM_REVIEW_PRESETS = [
  {
    slug: 'solo',
    name: 'Solo Reviewer',
    description: 'A single reviewer (typically the lead) approves. First request_changes blocks.',
    payload: {
      approvers: ['lead'],
      request_changes_policy: 'first',
      timeout: '24h',
      timeout_action: 'notify',
    },
  },
  {
    slug: 'two_eyes',
    name: 'Two Eyes',
    description: 'Two reviewers must approve before advancing. Any request_changes blocks.',
    payload: {
      quorum: { n: 2, of: 2 },
      request_changes_policy: 'first',
      timeout: '24h',
      timeout_action: 'notify',
    },
  },
  {
    slug: 'security_quorum',
    name: 'Security Quorum',
    description: '2-of-3 reviewers must approve. Author excluded. Escalates after timeout.',
    payload: {
      quorum: { n: 2, of: 3 },
      exclude_author: true,
      request_changes_policy: 'first',
      timeout: '24h',
      timeout_action: 'escalate',
    },
  },
  {
    slug: 'strict',
    name: 'Strict (all must approve)',
    description: 'Every reviewer must approve; only when all reviewers request_changes does the workflow rewind.',
    payload: {
      request_changes_policy: 'all',
      timeout: '48h',
      timeout_action: 'notify',
    },
  },
  {
    slug: 'advisory',
    name: 'Advisory (auto-approve on timeout)',
    description: 'Reviewers may comment, but the workflow advances automatically if no decision is recorded before the timeout.',
    payload: {
      request_changes_policy: 'first',
      timeout: '24h',
      timeout_action: 'auto_approve',
    },
  },
];

async function seedSystemReviewPolicyPresets(): Promise<void> {
  if (!_pool) throw new Error('Pool not initialised');
  for (const preset of SYSTEM_REVIEW_PRESETS) {
    await _pool.query(
      `
      INSERT INTO review_policy_presets (scope, project_id, slug, name, description, payload)
      VALUES ('system', NULL, $1, $2, $3, $4::jsonb)
      ON CONFLICT (slug) WHERE scope = 'system'
      DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        payload = EXCLUDED.payload,
        updated_at = NOW()
      `,
      [preset.slug, preset.name, preset.description, JSON.stringify(preset.payload)],
    );
  }
  console.log(`[db] seeded ${SYSTEM_REVIEW_PRESETS.length} system review-policy presets`);
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
