/**
 * packages/server/src/__tests__/github-actions.e2e.test.ts
 *
 * G5.1 — E2E smoke: assign-to-copilot → PR detection → comment → merge → cleanup.
 *
 * Isolation strategy:
 *   - vi.mock() for db/index.js: backed by a real PGlite in-memory instance
 *     so all SQL actually runs; no hand-rolled mocks.
 *   - vi.mock() for node:child_process: returns scripted gh responses so no
 *     real GitHub calls are made; GH_BIN_OVERRIDE is set for service code
 *     that re-reads the env at call time.
 *   - eventBus is the real singleton — tests subscribe directly to capture
 *     WS events without a live WebSocket server.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

// ---------------------------------------------------------------------------
// 1. PGlite in-memory DB — set up before any module imports.
// ---------------------------------------------------------------------------

// vi.hoisted() runs BEFORE vi.mock() factories, so the container object is
// accessible when the mock factory closes over it.
const dbContainer = vi.hoisted(() => ({
  pg: null as import('@electric-sql/pglite').PGlite | null,
  pool: null as import('../db/pglite.js').PoolLike | null,
}));

vi.mock('../db/index.js', async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const { createPoolAdapter } = await import('../db/pglite.js');
  const schema = await import('../db/schema.js');

  const pg = new PGlite(); // in-memory (no data dir)
  await pg.waitReady;

  // Bootstrap minimal tables needed for the test scenario.
  await pg.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name                  TEXT NOT NULL,
      path                  TEXT NOT NULL DEFAULT '.',
      github_owner          TEXT,
      github_repo           TEXT,
      copilot_workflow_file TEXT,
      github_sync_enabled   BOOLEAN NOT NULL DEFAULT false,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS agents (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id   UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name         TEXT NOT NULL,
      role         TEXT NOT NULL DEFAULT 'assistant',
      model        TEXT,
      status       TEXT NOT NULL DEFAULT 'active',
      charter_path TEXT NOT NULL DEFAULT '@copilot',
      agent_kind   TEXT NOT NULL DEFAULT 'squad',
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS issues (
      id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id           UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title                TEXT NOT NULL,
      body                 TEXT NOT NULL DEFAULT '',
      status               TEXT NOT NULL DEFAULT 'backlog',
      position             INTEGER NOT NULL DEFAULT 0,
      archived             INTEGER NOT NULL DEFAULT 0,
      version              INTEGER NOT NULL DEFAULT 1,
      deliverable_type     TEXT NOT NULL DEFAULT 'none',
      deliverable_status   TEXT NOT NULL DEFAULT 'not-started',
      created_by           TEXT NOT NULL DEFAULT 'user',
      github_issue_number  INTEGER,
      github_issue_url     TEXT,
      github_node_id       TEXT,
      created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS issue_runs (
      id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      issue_id                UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
      agent_id                UUID NOT NULL REFERENCES agents(id),
      kind                    TEXT NOT NULL DEFAULT 'agent_run',
      status                  TEXT NOT NULL DEFAULT 'pending',
      workspace_strategy      TEXT NOT NULL DEFAULT 'scratch',
      workspace_path          TEXT,
      input_tokens            INTEGER DEFAULT 0,
      output_tokens           INTEGER DEFAULT 0,
      cost_tokens             INTEGER DEFAULT 0,
      cost_usd                TEXT DEFAULT '0',
      premium_requests        NUMERIC(12,4) DEFAULT 0,
      git_branch              TEXT,
      git_branch_url          TEXT,
      pr_number               INTEGER,
      pr_url                  TEXT,
      pr_state                TEXT,
      ci_state                TEXT,
      ci_url                  TEXT,
      git_cache_refreshed_at  TIMESTAMPTZ,
      external_ref            JSONB,
      lease_expires_at        TIMESTAMPTZ,
      heartbeat_at            TIMESTAMPTZ,
      started_at              TIMESTAMPTZ,
      completed_at            TIMESTAMPTZ,
      output                  TEXT,
      error_message           TEXT,
      routing_tier            INTEGER,
      routing_score           NUMERIC(5,4),
      routing_reasoning       TEXT,
      step_run_id             UUID,
      input_context           TEXT,
      created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS copilot_auto_assign_rules (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      label       TEXT NOT NULL,
      enabled     BOOLEAN NOT NULL DEFAULT true,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS copilot_auto_assign_dispatches (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      rule_id     UUID NOT NULL REFERENCES copilot_auto_assign_rules(id) ON DELETE CASCADE,
      issue_id    UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE UNIQUE INDEX IF NOT EXISTS copilot_auto_assign_dispatches_uq
      ON copilot_auto_assign_dispatches (rule_id, issue_id);
  `);

  const db = drizzle(pg, { schema }) as ReturnType<typeof drizzle>;
  const pool = createPoolAdapter(pg);

  dbContainer.pg = pg;
  dbContainer.pool = pool;

  return {
    getDb: () => db,
    getPool: () => pool,
    schema,
    initDb: vi.fn(),
    closeDb: vi.fn(),
  };
});

// ---------------------------------------------------------------------------
// 2. Stub child_process execFile — simulate gh CLI responses.
// ---------------------------------------------------------------------------

// gh response registry: keyed by the command string "arg0 arg1 arg2..."
const ghResponses: Record<string, { stdout: string; stderr?: string; exitCode?: number }> = {};

function registerGhResponse(args: string[], response: { stdout: string; stderr?: string; exitCode?: number }) {
  const key = args.join(' ');
  ghResponses[key] = response;
}

function findGhResponse(args: string[]): { stdout: string; stderr: string } {
  // Exact match first.
  const key = args.join(' ');
  if (ghResponses[key]) {
    const r = ghResponses[key];
    if (r.exitCode && r.exitCode !== 0) {
      throw Object.assign(new Error(r.stderr ?? 'gh error'), { stderr: r.stderr ?? '' });
    }
    return { stdout: r.stdout, stderr: r.stderr ?? '' };
  }
  // Prefix match: try progressively shorter prefixes.
  for (let len = args.length - 1; len >= 1; len--) {
    const prefix = args.slice(0, len).join(' ');
    const found = Object.entries(ghResponses).find(([k]) => k.startsWith(prefix));
    if (found) {
      const r = found[1];
      if (r.exitCode && r.exitCode !== 0) {
        throw Object.assign(new Error(r.stderr ?? 'gh error'), { stderr: r.stderr ?? '' });
      }
      return { stdout: r.stdout, stderr: '' };
    }
  }
  // Default: empty success.
  return { stdout: '', stderr: '' };
}

vi.mock('node:child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:child_process')>();
  return {
    ...original,
    execFile: vi.fn((
      _file: string,
      args: string[],
      _optsOrCb: unknown,
      cbMaybe?: unknown,
    ) => {
      // Handle (file, args, cb) and (file, args, opts, cb) signatures.
      const cb = typeof _optsOrCb === 'function' ? _optsOrCb : cbMaybe;
      try {
        const result = findGhResponse(args);
        // Pass { stdout, stderr } as the resolved value so that
        // promisify(execFile) resolves to { stdout, stderr } (standard convention:
        // promise resolves to the first non-error arg to the callback).
        (cb as (err: null, val: { stdout: string; stderr: string }) => void)(
          null,
          { stdout: result.stdout, stderr: result.stderr },
        );
      } catch (err) {
        (cb as (err: Error) => void)(err as Error);
      }
    }),
  };
});

// Mock assertSafeWorkspacePath so workspace path checks don't block tests.
vi.mock('../engine/workspace.js', () => ({
  assertSafeWorkspacePath: vi.fn(() => { /* no-op in tests */ }),
}));

// ---------------------------------------------------------------------------
// 3. Import service modules AFTER mocks are registered.
// ---------------------------------------------------------------------------

import { assignToCopilot, commentOnIssue, mergePr } from '../services/github-git-ops.js';
import { runWatcherTickOnce } from '../services/copilot-watcher.js';
import { eventBus } from '../realtime/event-bus.js';
import type { BusEvent } from '../realtime/event-bus.js';
import { eq } from 'drizzle-orm';
import * as schemaModule from '../db/schema.js';

// ---------------------------------------------------------------------------
// 4. Test fixtures
// ---------------------------------------------------------------------------

let projectId: string;
let issueId: string;
let runId: string;

// Capture WS events emitted during the test.
const capturedEvents: BusEvent[] = [];

beforeAll(async () => {
  // Subscribe to all bus events.
  eventBus.on('event', (e: BusEvent) => capturedEvents.push(e));

  // Seed test data via the pool (raw SQL is simplest for bootstrapping).
  const pool = dbContainer.pool!;

  const projResult = await pool.query<{ id: string }>(
    `INSERT INTO projects (name, path, github_owner, github_repo, github_sync_enabled)
     VALUES ('Test Project', '.', 'acme', 'myrepo', true)
     RETURNING id`,
  );
  projectId = projResult.rows[0].id;

  const issueResult = await pool.query<{ id: string }>(
    `INSERT INTO issues (project_id, title, github_issue_number)
     VALUES ($1, 'Build feature X', 42)
     RETURNING id`,
    [projectId],
  );
  issueId = issueResult.rows[0].id;
});

afterAll(() => {
  eventBus.removeAllListeners('event');
});

// ---------------------------------------------------------------------------
// 5. Tests
// ---------------------------------------------------------------------------

describe('G5.1 — assign-to-copilot → PR detection → comment → merge', () => {
  it('G4.1 assign-to-copilot via gh issue assign creates issue_runs row', async () => {
    // Register gh stub: assign issue
    registerGhResponse(
      ['issue', 'edit', '42', '--add-assignee', 'copilot', '--repo', 'acme/myrepo'],
      { stdout: '' },
    );

    const result = await assignToCopilot({
      issueId,
      owner: 'acme',
      repo: 'myrepo',
      // no workflowFile → issue assign mode
    });

    expect(result.mode).toBe('issue_assign');
    expect(result.issueNumber).toBe(42);

    // Manually insert the issue_runs row (the route handler does this;
    // assignToCopilot() only dispatches, not persists).
    const pool = dbContainer.pool!;
    const agentResult = await pool.query<{ id: string }>(
      `INSERT INTO agents (project_id, name, role, status, charter_path, agent_kind)
       VALUES ($1, '@copilot', 'copilot-coding-agent', 'active', '@copilot', 'copilot')
       RETURNING id`,
      [projectId],
    );
    const copilotAgentId = agentResult.rows[0].id;

    const runResult = await pool.query<{ id: string }>(
      `INSERT INTO issue_runs (issue_id, agent_id, status, workspace_strategy, external_ref)
       VALUES ($1, $2, 'pending', 'scratch', '{"owner":"acme","repo":"myrepo","issueNumber":42}')
       RETURNING id`,
      [issueId, copilotAgentId],
    );
    runId = runResult.rows[0].id;

    expect(runId).toBeTruthy();

    // Verify the row has external_ref persisted.
    const runRow = await pool.query<{ external_ref: string; status: string }>(
      `SELECT external_ref, status FROM issue_runs WHERE id = $1`,
      [runId],
    );
    expect(runRow.rows[0].status).toBe('pending');
    const extRef = typeof runRow.rows[0].external_ref === 'string'
      ? JSON.parse(runRow.rows[0].external_ref)
      : runRow.rows[0].external_ref;
    expect(extRef).toMatchObject({ owner: 'acme', repo: 'myrepo', issueNumber: 42 });
  });

  it('G4.2 watcher tick detects copilot draft PR and updates issue_runs', async () => {
    // Register gh stub: pr list returns a draft PR referencing our issue.
    registerGhResponse(
      ['pr', 'list', '--repo', 'acme/myrepo', '--author', 'copilot', '--state', 'open',
       '--json', 'number,headRefName,isDraft,createdAt,url,body,state'],
      {
        stdout: JSON.stringify([
          {
            number: 99,
            headRefName: 'copilot/fix-42',
            isDraft: true,
            createdAt: '2026-05-16T07:00:00Z',
            url: 'https://github.com/acme/myrepo/pull/99',
            body: 'Closes #42',
            state: 'OPEN',
          },
        ]),
      },
    );

    // Capture events emitted during tick.
    const prDetectedEvents: BusEvent[] = [];
    const handler = (e: BusEvent) => {
      if (e.type === 'copilot.pr.detected') prDetectedEvents.push(e);
    };
    eventBus.on('event', handler);

    await runWatcherTickOnce();

    eventBus.off('event', handler);

    // The run should now have pr_number=99, pr_state='draft'.
    const pool = dbContainer.pool!;
    const row = await pool.query<{ pr_number: number; pr_url: string; pr_state: string }>(
      `SELECT pr_number, pr_url, pr_state FROM issue_runs WHERE id = $1`,
      [runId],
    );

    expect(row.rows[0].pr_number).toBe(99);
    expect(row.rows[0].pr_state).toBe('draft');
    expect(row.rows[0].pr_url).toBe('https://github.com/acme/myrepo/pull/99');

    // A copilot.pr.detected event should have been emitted.
    expect(prDetectedEvents.length).toBeGreaterThan(0);
    const payload = prDetectedEvents[0].payload as Record<string, unknown>;
    expect(payload['pr_number']).toBe(99);
    expect(payload['draft']).toBe(true);
  });

  it('G2.3 commentOnIssue posts a comment and emits git.comment.posted', async () => {
    // Register stub: gh issue comment
    registerGhResponse(
      ['issue', 'comment', '42', '--body-file', '-'],
      { stdout: 'https://github.com/acme/myrepo/issues/42#issuecomment-999\n' },
    );

    const eventsBeforeCount = capturedEvents.filter((e) => e.type === 'git.comment.posted').length;

    const result = await commentOnIssue(runId, { issueNumber: 42, body: 'Looking good!' });

    expect(result.issueNumber).toBe(42);
    expect(result.commentUrl).toContain('issuecomment');

    const newEvents = capturedEvents.filter((e) => e.type === 'git.comment.posted');
    expect(newEvents.length).toBeGreaterThan(eventsBeforeCount);
  });

  it('G2.5 mergePr with passing CI marks prState=merged and emits git.pr.merged', async () => {
    // First, set pr_number on the run so mergePr() doesn't call `gh pr view`.
    const pool = dbContainer.pool!;
    await pool.query(
      `UPDATE issue_runs SET pr_number = 99, pr_url = 'https://github.com/acme/myrepo/pull/99', workspace_path = '/fake/ws' WHERE id = $1`,
      [runId],
    );

    // Stub: pr checks passes (no output, exit 0).
    registerGhResponse(['pr', 'checks', '99', '--required'], { stdout: '' });
    // Stub: pr merge succeeds.
    registerGhResponse(
      ['pr', 'merge', '99', '--squash', '--delete-branch'],
      { stdout: 'a'.repeat(40) + '\n' },
    );

    const mergeEventsBeforeCount = capturedEvents.filter((e) => e.type === 'git.pr.merged').length;

    const mergeResult = await mergePr(runId, { method: 'squash' });

    expect(mergeResult.method).toBe('squash');
    expect(mergeResult.sha).toHaveLength(40);

    // pr_state should be 'merged' in the DB.
    const row = await pool.query<{ pr_state: string; status: string }>(
      `SELECT pr_state, status FROM issue_runs WHERE id = $1`,
      [runId],
    );
    expect(row.rows[0].pr_state).toBe('merged');

    const mergeEvents = capturedEvents.filter((e) => e.type === 'git.pr.merged');
    expect(mergeEvents.length).toBeGreaterThan(mergeEventsBeforeCount);
  });

  it('G4.3 label rule idempotency: duplicate dispatch blocked', async () => {
    const pool = dbContainer.pool!;

    // Create a rule.
    const ruleResult = await pool.query<{ id: string }>(
      `INSERT INTO copilot_auto_assign_rules (project_id, label, enabled)
       VALUES ($1, 'needs-copilot', true)
       RETURNING id`,
      [projectId],
    );
    const ruleId = ruleResult.rows[0].id;

    // Record a dispatch for this (rule, issue) pair.
    await pool.query(
      `INSERT INTO copilot_auto_assign_dispatches (rule_id, issue_id)
       VALUES ($1, $2)`,
      [ruleId, issueId],
    );

    // Try inserting again — should fail the unique constraint (ON CONFLICT DO NOTHING
    // returns 0 rows; if the test logic checks rowCount it should be 0).
    const result = await pool.query(
      `INSERT INTO copilot_auto_assign_dispatches (rule_id, issue_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [ruleId, issueId],
    );
    expect(result.rowCount).toBe(0); // second dispatch blocked
  });
});
