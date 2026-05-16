/**
 * pglite-spike.ts — PGlite feasibility prove-out for the embedded-postgres → PGlite migration.
 *
 * Runs the EXACT bootstrap SQL from db/index.ts (every CREATE TABLE, CREATE TYPE, CREATE INDEX,
 * DO $$ BEGIN … END $$) and then a smoke-test CRUD sequence.
 *
 * Usage:
 *   pnpm exec tsx packages/server/src/scripts/pglite-spike.ts
 *
 * Data dir: ~/.squadboard-spike (cleaned up at the end).
 */

import { PGlite } from '@electric-sql/pglite';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';

const DATA_DIR = join(homedir(), '.squadboard-spike');

// ─── Result accumulator ─────────────────────────────────────────────────────

type FeatureResult = { feature: string; status: 'PASS' | 'FAIL'; detail?: string };
const results: FeatureResult[] = [];

function pass(feature: string, detail?: string) {
  results.push({ feature, status: 'PASS', detail });
  console.log(`  ✅ ${feature}${detail ? ': ' + detail : ''}`);
}

function fail(feature: string, err: unknown) {
  const detail = err instanceof Error ? err.message : String(err);
  results.push({ feature, status: 'FAIL', detail });
  console.error(`  ❌ ${feature}: ${detail}`);
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  PGlite Feasibility Spike — Squadboard embedded-PG migration');
  console.log('══════════════════════════════════════════════════════════\n');

  // Clean old spike dir if it exists
  if (existsSync(DATA_DIR)) {
    rmSync(DATA_DIR, { recursive: true, force: true });
  }

  const db = new PGlite(DATA_DIR);
  await db.waitReady;
  console.log('[spike] PGlite booted at', DATA_DIR);

  // ── 1. Bootstrap schema (verbatim from db/index.ts bootstrapSchema()) ────
  console.log('\n[1] Running bootstrap schema SQL…');
  try {
    await db.exec(`
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

      ALTER TABLE workflow_runs
        ADD COLUMN IF NOT EXISTS workflow_version_id UUID REFERENCES workflow_versions(id);

      ALTER TABLE step_runs
        ADD COLUMN IF NOT EXISTS pinned_agent_revisions TEXT;

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
    `);
    pass('Phase 1-7 schema (CREATE TABLE, ENUM, ALTER TABLE, ADD COLUMN IF NOT EXISTS)');
  } catch (e) {
    fail('Phase 1-7 schema', e);
  }

  // ── 2. DO $$ with ALTER TYPE ADD VALUE IF NOT EXISTS ────────────────────
  console.log('\n[2] Testing DO $$ ALTER TYPE ADD VALUE IF NOT EXISTS…');
  try {
    await db.exec(`
      DO $$ BEGIN
        ALTER TYPE issue_run_kind ADD VALUE IF NOT EXISTS 'specifier_run';
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;

      ALTER TABLE issue_runs
        ADD COLUMN IF NOT EXISTS routing_tier      INTEGER,
        ADD COLUMN IF NOT EXISTS routing_score     NUMERIC(5, 4),
        ADD COLUMN IF NOT EXISTS routing_reasoning TEXT;

      CREATE TABLE IF NOT EXISTS agent_keywords (
        agent_id    UUID        PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
        keywords    TEXT        NOT NULL DEFAULT '[]',
        focus_areas TEXT        NOT NULL DEFAULT '[]',
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

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
    `);
    pass('ALTER TYPE ADD VALUE IF NOT EXISTS inside DO $$ block');
  } catch (e) {
    fail('ALTER TYPE ADD VALUE IF NOT EXISTS inside DO $$ block', e);
  }

  // ── 3. JSONB columns and DEFAULT '{}' / '[]' literals ───────────────────
  console.log('\n[3] Testing JSONB columns…');
  try {
    await db.exec(`
      ALTER TABLE step_runs
        ADD COLUMN IF NOT EXISTS review_decision    TEXT,
        ADD COLUMN IF NOT EXISTS review_comment     TEXT,
        ADD COLUMN IF NOT EXISTS review_suggestions JSONB;

      CREATE TABLE IF NOT EXISTS review_events (
        id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        workflow_run_id     UUID        REFERENCES workflow_runs(id) ON DELETE CASCADE,
        step_run_id         UUID        REFERENCES step_runs(id) ON DELETE CASCADE,
        issue_run_id        UUID        REFERENCES issue_runs(id),
        reviewer_agent_id   UUID        REFERENCES agents(id),
        reviewer_name       TEXT,
        verb                TEXT        NOT NULL,
        body                TEXT,
        suggestions         JSONB,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      DO $$ BEGIN
        ALTER TYPE run_status ADD VALUE IF NOT EXISTS 'splitting';
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;

      DO $$ BEGIN
        ALTER TYPE run_status ADD VALUE IF NOT EXISTS 'waiting_children';
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;

      ALTER TABLE workflow_runs
        ADD COLUMN IF NOT EXISTS parent_workflow_run_id TEXT,
        ADD COLUMN IF NOT EXISTS child_workflow_run_ids JSONB DEFAULT '[]',
        ADD COLUMN IF NOT EXISTS pinned_agent_revisions TEXT,
        ADD COLUMN IF NOT EXISTS variables              JSONB DEFAULT '{}',
        ADD COLUMN IF NOT EXISTS inline_steps_json      TEXT;

      ALTER TABLE step_runs
        ADD COLUMN IF NOT EXISTS split_targets     JSONB,
        ADD COLUMN IF NOT EXISTS output            TEXT,
        ADD COLUMN IF NOT EXISTS step_config       JSONB,
        ADD COLUMN IF NOT EXISTS resolved_agent_id TEXT;

      ALTER TABLE step_runs
        ADD COLUMN IF NOT EXISTS session_id        TEXT,
        ADD COLUMN IF NOT EXISTS started_at        TIMESTAMPTZ;

      CREATE TABLE IF NOT EXISTS issue_links (
        id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        parent_issue_id  UUID        NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
        child_issue_id   UUID        NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
        link_type        TEXT        NOT NULL DEFAULT 'fan_out',
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS handoff_context (
        id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        workflow_run_id  UUID        NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
        step_run_id      UUID        NOT NULL REFERENCES step_runs(id) ON DELETE CASCADE,
        target_issue_id  UUID        REFERENCES issues(id) ON DELETE SET NULL,
        context_json     JSONB       NOT NULL DEFAULT '{}',
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    pass('JSONB columns (DEFAULT {}, DEFAULT [])');
  } catch (e) {
    fail('JSONB columns (DEFAULT {}, DEFAULT [])', e);
  }

  // ── 4. CREATE INDEX IF NOT EXISTS (normal + partial) ────────────────────
  console.log('\n[4] Testing CREATE INDEX with partial WHERE clauses…');
  try {
    await db.exec(`
      ALTER TABLE issues
        ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

      ALTER TABLE projects
        ADD COLUMN IF NOT EXISTS github_sync_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS github_token        TEXT,
        ADD COLUMN IF NOT EXISTS github_owner        TEXT,
        ADD COLUMN IF NOT EXISTS github_repo         TEXT,
        ADD COLUMN IF NOT EXISTS github_sync_last_at TIMESTAMPTZ;

      ALTER TABLE issues
        ADD COLUMN IF NOT EXISTS github_issue_number INTEGER,
        ADD COLUMN IF NOT EXISTS github_issue_url    TEXT,
        ADD COLUMN IF NOT EXISTS github_node_id      TEXT;

      ALTER TABLE comments
        ADD COLUMN IF NOT EXISTS github_comment_id TEXT;

      ALTER TABLE projects
        ADD COLUMN IF NOT EXISTS github_auth_type            TEXT,
        ADD COLUMN IF NOT EXISTS github_app_id               TEXT,
        ADD COLUMN IF NOT EXISTS github_app_installation_id  TEXT,
        ADD COLUMN IF NOT EXISTS github_app_private_key      TEXT;

      ALTER TABLE projects
        ADD COLUMN IF NOT EXISTS default_model TEXT;

      CREATE TABLE IF NOT EXISTS github_sync_log (
        id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id   UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        direction    TEXT        NOT NULL,
        entity_type  TEXT        NOT NULL,
        entity_id    TEXT        NOT NULL,
        github_number INTEGER,
        status       TEXT        NOT NULL,
        error_msg    TEXT,
        synced_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

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
    `);
    pass('CREATE INDEX (plain + partial WHERE clause)');
  } catch (e) {
    fail('CREATE INDEX (plain + partial WHERE clause)', e);
  }

  // ── 5. DO $$ with ADD CONSTRAINT and EXCEPTION WHEN duplicate_object ────
  console.log('\n[5] Testing DO $$ ADD CONSTRAINT with duplicate_object guard…');
  try {
    await db.exec(`
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
    `);
    pass('DO $$ ADD CONSTRAINT with EXCEPTION WHEN duplicate_object THEN NULL');
  } catch (e) {
    fail('DO $$ ADD CONSTRAINT with EXCEPTION WHEN duplicate_object THEN NULL', e);
  }

  // ── 6. BYTEA columns ────────────────────────────────────────────────────
  console.log('\n[6] Testing BYTEA columns…');
  try {
    await db.exec(`
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
    `);
    pass('BYTEA column type');
  } catch (e) {
    fail('BYTEA column type', e);
  }

  // ── 7. information_schema queries (used in bootstrap migrations) ─────────
  console.log('\n[7] Testing information_schema queries…');
  try {
    const r = await db.query<{ exists: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name = 'projects') AS exists`,
    );
    if (!r.rows[0]?.exists) throw new Error('projects table not found via information_schema');
    pass('information_schema.tables queries');
  } catch (e) {
    fail('information_schema.tables queries', e);
  }

  // ── 8. pg_type system catalog (used in dynamic-columns migration) ────────
  console.log('\n[8] Testing pg_type catalog (column_status enum detection)…');
  try {
    const r = await db.query<{ exists: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM pg_type WHERE typname = 'column_status') AS exists`,
    );
    // column_status should exist (we created it above)
    if (!r.rows[0]?.exists) throw new Error('column_status enum not found via pg_type');
    pass('pg_type catalog (SELECT FROM pg_type WHERE typname)');
  } catch (e) {
    fail('pg_type catalog (SELECT FROM pg_type WHERE typname)', e);
  }

  // ── 9. Full remaining schema (consult, skills, MCP, templates, etc.) ────
  console.log('\n[9] Running full remaining bootstrap SQL (Phases 10-19)…');
  try {
    await db.exec(`
      ALTER TABLE review_events
        ALTER COLUMN step_run_id DROP NOT NULL,
        ALTER COLUMN workflow_run_id DROP NOT NULL,
        ADD COLUMN IF NOT EXISTS deliverable_id UUID;

      DO $$ BEGIN
        ALTER TABLE review_events
          ADD CONSTRAINT review_events_target_chk
          CHECK (
            (step_run_id IS NOT NULL AND deliverable_id IS NULL) OR
            (step_run_id IS NULL     AND deliverable_id IS NOT NULL)
          );
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;

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

      ALTER TABLE workflows
        ADD COLUMN IF NOT EXISTS trigger_kind   TEXT  NOT NULL DEFAULT 'on_issue_entry';
      ALTER TABLE workflows
        ADD COLUMN IF NOT EXISTS trigger_config JSONB NOT NULL DEFAULT '{}'::jsonb;
      ALTER TABLE workflows
        ADD COLUMN IF NOT EXISTS kind           TEXT  NOT NULL DEFAULT 'ceremony';

      UPDATE workflows
         SET kind = 'workflow'
       WHERE kind = 'ceremony'
         AND created_at < (now() - interval '5 minutes');

      ALTER TABLE workflows
        ADD COLUMN IF NOT EXISTS status                       TEXT        NOT NULL DEFAULT 'active';
      ALTER TABLE workflows
        ADD COLUMN IF NOT EXISTS parent_narrative_id          UUID        REFERENCES workflows(id) ON DELETE SET NULL;
      ALTER TABLE workflows
        ADD COLUMN IF NOT EXISTS last_translation_error       TEXT;
      ALTER TABLE workflows
        ADD COLUMN IF NOT EXISTS last_translation_attempt_at  TIMESTAMPTZ;

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

      DO $$ BEGIN
        ALTER TABLE tools
          ADD CONSTRAINT tools_mcp_server_fk
          FOREIGN KEY (mcp_server_id) REFERENCES mcp_servers(id) ON DELETE SET NULL;
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

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
    `);
    pass('Full remaining schema (Phases 10-19, consult/skills/MCP/templates)');
  } catch (e) {
    fail('Full remaining schema (Phases 10-19)', e);
  }

  // ── 10. Dynamic-columns migration (pg_type check + DROP TYPE) ───────────
  console.log('\n[10] Testing dynamic-columns migration (enum→TEXT migration)…');
  try {
    await db.exec(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'column_status') THEN
          ALTER TABLE issues ALTER COLUMN status TYPE TEXT USING status::TEXT;
          ALTER TABLE issues ALTER COLUMN status SET DEFAULT 'backlog';
          DROP TYPE column_status;
        END IF;
      END $$;

      ALTER TABLE column_meta
        ADD COLUMN IF NOT EXISTS semantic    TEXT    NOT NULL DEFAULT 'custom',
        ADD COLUMN IF NOT EXISTS is_default  BOOLEAN NOT NULL DEFAULT false;
    `);
    pass('Dynamic-columns migration (IF EXISTS pg_type check, ALTER COLUMN TYPE, DROP TYPE)');
  } catch (e) {
    fail('Dynamic-columns migration', e);
  }

  // ── 11. Skills/tools provenance migrations ───────────────────────────────
  console.log('\n[11] Testing provenance column migrations (Wave 10 D2/D3)…');
  try {
    await db.exec(`
      ALTER TABLE skills
        ADD COLUMN IF NOT EXISTS source     TEXT NOT NULL DEFAULT 'custom',
        ADD COLUMN IF NOT EXISTS source_uri TEXT;

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

      ALTER TABLE workflow_runs
        ADD COLUMN IF NOT EXISTS trigger_source jsonb;

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

      ALTER TABLE issues
        ADD COLUMN IF NOT EXISTS completed_at  TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS created_by    TEXT NOT NULL DEFAULT 'user';
    `);
    pass('Provenance + inbox + issues Wave 10/12/13 migrations');
  } catch (e) {
    fail('Provenance + inbox + issues Wave 10/12/13 migrations', e);
  }

  // ── 12. INSERT … ON CONFLICT … DO UPDATE ────────────────────────────────
  console.log('\n[12] Testing INSERT … ON CONFLICT … DO UPDATE (system preset seeding)…');
  try {
    await db.exec(`
      INSERT INTO review_policy_presets (scope, project_id, slug, name, description, payload)
      VALUES ('system', NULL, 'solo', 'Solo Reviewer', 'Single reviewer.', '{"approvers":["lead"]}'::jsonb)
      ON CONFLICT (slug) WHERE scope = 'system'
      DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        payload = EXCLUDED.payload,
        updated_at = NOW();
    `);
    // Run again to exercise the ON CONFLICT path
    await db.exec(`
      INSERT INTO review_policy_presets (scope, project_id, slug, name, description, payload)
      VALUES ('system', NULL, 'solo', 'Solo Reviewer v2', 'Updated.', '{"approvers":["lead"]}'::jsonb)
      ON CONFLICT (slug) WHERE scope = 'system'
      DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        payload = EXCLUDED.payload,
        updated_at = NOW();
    `);
    const r = await db.query<{ name: string }>(`SELECT name FROM review_policy_presets WHERE slug='solo'`);
    if (r.rows[0]?.name !== 'Solo Reviewer v2') throw new Error(`Expected 'Solo Reviewer v2', got '${r.rows[0]?.name}'`);
    pass('INSERT … ON CONFLICT (key) DO UPDATE (partial-index conflict)');
  } catch (e) {
    fail('INSERT … ON CONFLICT (key) DO UPDATE', e);
  }

  // ── 13. gen_random_uuid() as DEFAULT ────────────────────────────────────
  console.log('\n[13] Testing gen_random_uuid() as column DEFAULT…');
  try {
    const r = await db.query<{ id: string }>(`INSERT INTO projects (name, path) VALUES ('spike-test', '/tmp') RETURNING id`);
    const id = r.rows[0]?.id;
    if (!id || id.length !== 36) throw new Error(`UUID default produced unexpected value: ${id}`);
    pass(`gen_random_uuid() as DEFAULT (got UUID: ${id.slice(0, 8)}…)`);
  } catch (e) {
    fail('gen_random_uuid() as DEFAULT', e);
  }

  // ── 14. CRUD smoke-run with cascade delete ──────────────────────────────
  console.log('\n[14] CRUD smoke-run (insert project + 3 issues, update, cascade delete)…');
  try {
    const projResult = await db.query<{ id: string }>(
      `INSERT INTO projects (name, path) VALUES ('cascade-test', '/foo') RETURNING id`,
    );
    const projectId = projResult.rows[0]!.id;

    // Insert 3 issues
    for (let i = 1; i <= 3; i++) {
      await db.query(
        `INSERT INTO issues (project_id, title, body) VALUES ($1, $2, 'body') RETURNING id`,
        [projectId, `Issue ${i}`],
      );
    }

    // Verify count
    const countResult = await db.query<{ cnt: string }>(
      `SELECT COUNT(*) AS cnt FROM issues WHERE project_id = $1`,
      [projectId],
    );
    const cnt = parseInt(countResult.rows[0]!.cnt, 10);
    if (cnt !== 3) throw new Error(`Expected 3 issues, got ${cnt}`);

    // Update one
    await db.query(
      `UPDATE issues SET title = 'Updated Issue 1' WHERE project_id = $1 AND title = 'Issue 1'`,
      [projectId],
    );

    // Delete project — cascade must clear issues
    await db.query(`DELETE FROM projects WHERE id = $1`, [projectId]);
    const afterCascade = await db.query<{ cnt: string }>(
      `SELECT COUNT(*) AS cnt FROM issues WHERE project_id = $1`,
      [projectId],
    );
    const remaining = parseInt(afterCascade.rows[0]!.cnt, 10);
    if (remaining !== 0) throw new Error(`CASCADE DELETE failed: ${remaining} issue(s) remain`);

    pass('CRUD smoke-run (INSERT, UPDATE, SELECT, CASCADE DELETE)');
  } catch (e) {
    fail('CRUD smoke-run', e);
  }

  // ── 15. Parameterized query with $1/$2 positional params ─────────────────
  console.log('\n[15] Testing positional $1/$2 parameterized queries…');
  try {
    const r = await db.query<{ id: string }>(
      `INSERT INTO projects (name, path) VALUES ($1, $2) RETURNING id`,
      ['param-test', '/bar'],
    );
    const id = r.rows[0]?.id;
    if (!id) throw new Error('No id returned from parameterized INSERT');
    pass('Positional $1/$2 parameterized queries');
    // Cleanup
    await db.query(`DELETE FROM projects WHERE id = $1`, [id]);
  } catch (e) {
    fail('Positional $1/$2 parameterized queries', e);
  }

  // ── 16. TIMESTAMPTZ round-trip ───────────────────────────────────────────
  console.log('\n[16] Testing TIMESTAMPTZ round-trip…');
  try {
    const r = await db.query<{ created_at: Date }>(
      `INSERT INTO projects (name, path) VALUES ($1, $2) RETURNING created_at`,
      ['ts-test', '/ts'],
    );
    const ts = r.rows[0]?.created_at;
    if (!ts) throw new Error('No created_at returned');
    pass(`TIMESTAMPTZ round-trip (value: ${ts})`);
    await db.query(`DELETE FROM projects WHERE name = 'ts-test'`);
  } catch (e) {
    fail('TIMESTAMPTZ round-trip', e);
  }

  // ── 17. affectedRows (PGlite analog to pg rowCount) ─────────────────────
  console.log('\n[17] Testing affectedRows (PGlite analog to pg rowCount)…');
  try {
    // Insert a row, then UPDATE it, check affectedRows
    await db.query(`INSERT INTO projects (name, path) VALUES ('af-test', '/af')`);
    const upd = await db.query(`UPDATE projects SET name = 'af-test-2' WHERE name = 'af-test'`);
    const affected = (upd as unknown as { affectedRows: number }).affectedRows;
    if (affected !== 1) throw new Error(`Expected affectedRows=1, got ${affected}`);
    pass(`affectedRows on UPDATE (got: ${affected})`);
    await db.query(`DELETE FROM projects WHERE name = 'af-test-2'`);
  } catch (e) {
    fail('affectedRows', e);
  }

  // ── Cleanup ──────────────────────────────────────────────────────────────
  await db.close();
  if (existsSync(DATA_DIR)) {
    rmSync(DATA_DIR, { recursive: true, force: true });
    console.log('\n[spike] cleaned up', DATA_DIR);
  }

  // ── Summary table ────────────────────────────────────────────────────────
  const colW = 62;
  const pass_count = results.filter(r => r.status === 'PASS').length;
  const fail_count = results.filter(r => r.status === 'FAIL').length;

  console.log('\n');
  console.log('══════════════════════════════════════════════════════════');
  console.log('  PGlite Feasibility Spike — Results');
  console.log('══════════════════════════════════════════════════════════');
  console.log(`  ${'Feature'.padEnd(colW)} Status`);
  console.log(`  ${'─'.repeat(colW)} ──────`);
  for (const r of results) {
    const icon = r.status === 'PASS' ? '✅ PASS' : '❌ FAIL';
    console.log(`  ${r.feature.padEnd(colW)} ${icon}`);
    if (r.status === 'FAIL' && r.detail) {
      console.log(`  ${''.padEnd(colW)}   ↳ ${r.detail.slice(0, 120)}`);
    }
  }
  console.log('──────────────────────────────────────────────────────────');
  console.log(`  Total: ${pass_count} PASS / ${fail_count} FAIL`);
  console.log('══════════════════════════════════════════════════════════\n');

  if (fail_count > 0) {
    console.error(`[spike] ❌ ${fail_count} incompatibility(ies) found — do NOT proceed with migration.`);
    process.exit(1);
  } else {
    console.log('[spike] ✅ All features compatible — PGlite is a safe drop-in for this schema.');
    process.exit(0);
  }
}

main().catch((err: unknown) => {
  console.error('[spike] Fatal error:', err);
  process.exit(1);
});
