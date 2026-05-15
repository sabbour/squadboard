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

    -- Phase 8 vertical slice: column metadata overlay (2026-05-15)
    -- Stores per-project display overrides for the 5 hard-coded columns.
    CREATE TABLE IF NOT EXISTS column_meta (
      id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id  UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      column_id   TEXT        NOT NULL,
      label       TEXT        NOT NULL,
      description TEXT,
      color       TEXT        NOT NULL,
      position    INTEGER     NOT NULL DEFAULT 0,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE UNIQUE INDEX IF NOT EXISTS column_meta_project_column_uq
      ON column_meta (project_id, column_id);
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
