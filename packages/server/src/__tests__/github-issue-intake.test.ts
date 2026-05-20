import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbContainer = vi.hoisted(() => ({
  pool: null as import('../db/pglite.js').PoolLike | null,
}));

vi.mock('../db/index.js', async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const { createPoolAdapter } = await import('../db/pglite.js');
  const schema = await import('../db/schema.js');

  const pg = new PGlite();
  await pg.waitReady;
  await pg.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      path TEXT NOT NULL DEFAULT '.',
      github_owner TEXT,
      github_repo TEXT,
      github_sync_last_at TIMESTAMPTZ,
      github_auth_type TEXT,
      github_token TEXT,
      github_app_id TEXT,
      github_app_installation_id TEXT,
      github_app_private_key TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS settings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      key TEXT NOT NULL UNIQUE,
      value TEXT,
      project_id UUID REFERENCES projects(id)
    );

    CREATE TABLE IF NOT EXISTS column_meta (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      column_id TEXT NOT NULL,
      label TEXT NOT NULL,
      description TEXT,
      color TEXT NOT NULL DEFAULT '#6B6B6B',
      position INTEGER NOT NULL DEFAULT 0,
      semantic TEXT NOT NULL DEFAULT 'custom',
      is_default BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS issues (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'backlog',
      assignee_id UUID,
      position INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0,
      version INTEGER NOT NULL DEFAULT 1,
      github_issue_number INTEGER,
      github_issue_url TEXT,
      github_node_id TEXT,
      completed_at TIMESTAMPTZ,
      created_by TEXT NOT NULL DEFAULT 'user',
      deliverable_type TEXT NOT NULL DEFAULT 'none',
      deliverable_link TEXT,
      deliverable_acceptance_criteria TEXT,
      deliverable_status TEXT NOT NULL DEFAULT 'not-started',
      archived_at TIMESTAMPTZ,
      archived_reason TEXT,
      idempotency_key TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE UNIQUE INDEX IF NOT EXISTS issues_project_idempotency_uq
      ON issues (project_id, idempotency_key)
      WHERE idempotency_key IS NOT NULL;

    CREATE TABLE IF NOT EXISTS labels (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#388bfd',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS issue_labels (
      issue_id UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
      label_id UUID NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
      PRIMARY KEY (issue_id, label_id)
    );

    CREATE TABLE IF NOT EXISTS agents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      model TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      charter_path TEXT NOT NULL DEFAULT '.squad/agents/agent/charter.md',
      history_path TEXT,
      charter_hash TEXT,
      charter_content TEXT NOT NULL DEFAULT '',
      agent_kind TEXT NOT NULL DEFAULT 'squad',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS issue_runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      issue_id UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
      agent_id UUID NOT NULL REFERENCES agents(id),
      kind TEXT NOT NULL DEFAULT 'agent_run',
      status TEXT NOT NULL DEFAULT 'pending',
      workspace_strategy TEXT NOT NULL DEFAULT 'scratch',
      workspace_path TEXT,
      step_run_id UUID,
      input_context TEXT,
      lease_expires_at TIMESTAMPTZ,
      heartbeat_at TIMESTAMPTZ,
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      output TEXT,
      error_message TEXT,
      cost_tokens INTEGER DEFAULT 0,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      cached_input_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd TEXT DEFAULT '0',
      premium_requests NUMERIC(12,4) DEFAULT 0,
      routing_tier INTEGER,
      routing_score NUMERIC(5,4),
      routing_reasoning TEXT,
      git_branch TEXT,
      git_branch_url TEXT,
      pr_number INTEGER,
      pr_url TEXT,
      pr_state TEXT,
      ci_state TEXT,
      ci_url TEXT,
      git_cache_refreshed_at TIMESTAMPTZ,
      stale_reason TEXT,
      external_ref JSONB,
      coordinator_decision JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS workflows (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      description TEXT,
      trigger_kind TEXT NOT NULL DEFAULT 'on_issue_entry',
      trigger_config JSONB NOT NULL DEFAULT '{}',
      kind TEXT NOT NULL DEFAULT 'ceremony',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS workflow_versions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      yaml_content TEXT NOT NULL,
      json_schema TEXT,
      pinned_agent_revisions TEXT,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS workflow_runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      issue_id UUID NOT NULL REFERENCES issues(id),
      workflow_version_id UUID,
      status TEXT NOT NULL DEFAULT 'pending',
      current_step_index INTEGER DEFAULT 0,
      request_changes_policy TEXT DEFAULT 'first',
      parent_workflow_run_id TEXT,
      child_workflow_run_ids JSONB DEFAULT '[]',
      pinned_agent_revisions TEXT,
      variables JSONB DEFAULT '{}',
      inline_steps_json TEXT,
      trigger_source JSONB,
      premium_requests NUMERIC(12,4) DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS step_runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workflow_run_id UUID NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
      issue_run_id UUID REFERENCES issue_runs(id),
      step_index INTEGER NOT NULL,
      step_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      pinned_agent_revisions TEXT,
      retry_count INTEGER DEFAULT 0,
      max_retries INTEGER DEFAULT 3,
      retry_delay INTEGER DEFAULT 0,
      lease_expires_at TIMESTAMPTZ,
      heartbeat_at TIMESTAMPTZ,
      review_decision TEXT,
      review_comment TEXT,
      review_suggestions JSONB,
      split_targets JSONB,
      output TEXT,
      step_config JSONB,
      resolved_agent_id TEXT,
      session_id TEXT,
      started_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS issue_workflows (
      issue_id UUID PRIMARY KEY REFERENCES issues(id) ON DELETE CASCADE,
      workflow_version_id UUID NOT NULL REFERENCES workflow_versions(id),
      attached_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  const pool = createPoolAdapter(pg);
  dbContainer.pool = pool;

  return {
    getDb: () => drizzle(pg, { schema }),
    getPool: () => pool,
    schema,
    initDb: vi.fn(),
    closeDb: vi.fn(),
  };
});

import {
  GITHUB_ISSUE_INTAKE_CONTRACT_VERSION,
  runGitHubIssueIntake,
} from '../github/issue-intake.js';
import {
  DOC_REVIEW_INTAKE_CONTRACT_VERSION,
  runGitHubDocReviewIntake,
} from '../github/doc-review-intake.js';
import { advanceWorkflowRun } from '../engine/workflow-runner.js';

describe('GitHub issue intake', () => {
  let projectId: string;

  beforeEach(async () => {
    const pool = dbContainer.pool!;
    await pool.query(`
      DELETE FROM step_runs;
      DELETE FROM workflow_runs;
      DELETE FROM issue_workflows;
      DELETE FROM workflow_versions;
      DELETE FROM workflows;
      DELETE FROM issue_runs;
      DELETE FROM issue_labels;
      DELETE FROM labels;
      DELETE FROM issues;
      DELETE FROM agents;
      DELETE FROM column_meta;
      DELETE FROM settings;
      DELETE FROM projects;
    `);

    const project = await pool.query<{ id: string }>(
      `INSERT INTO projects (name, path) VALUES ('Squad Issues Router', '.squad') RETURNING id`,
    );
    projectId = project.rows[0].id;

    await pool.query(
      `INSERT INTO column_meta (project_id, column_id, label, position, semantic, is_default)
       VALUES ($1, 'triage', 'Triage', 0, 'backlog', true)`,
      [projectId],
    );
    await pool.query(
      `INSERT INTO agents (project_id, name, role)
       VALUES ($1, 'issue-triager', 'Squad Issue Triage Lead')`,
      [projectId],
    );
    const workflow = await pool.query<{ id: string }>(
      `INSERT INTO workflows (project_id, name, slug, trigger_kind, trigger_config, kind, status)
       VALUES ($1, 'Squad Issue Triage', 'squad-issue-triage', 'on_issue_entry', '{"column":"triage"}', 'ceremony', 'active')
       RETURNING id`,
      [projectId],
    );
    await pool.query(
      `INSERT INTO workflow_versions (workflow_id, version, yaml_content, is_active)
       VALUES ($1, 1, $2, true)`,
      [
        workflow.rows[0].id,
        `name: Squad Issue Triage
steps:
  - type: agent_run
    agent: issue-triager
    prompt: "Classify this issue."
`,
      ],
    );
  });

  it('imports public GitHub issues once, skips PRs, stores cursor, and starts triage workflow', async () => {
    const listIssues = vi.fn(async () => [
      {
        number: 101,
        title: 'Bug: intake fails',
        body: 'Steps to reproduce...',
        state: 'open' as const,
        labels: [{ name: 'bug' }],
        html_url: 'https://github.com/bradygaster/squad/issues/101',
        node_id: 'I_kwDO101',
        updated_at: '2026-05-20T10:00:00.000Z',
        created_at: '2026-05-20T09:00:00.000Z',
      },
      {
        number: 102,
        title: 'PR: not an issue',
        body: null,
        state: 'open' as const,
        labels: [],
        html_url: 'https://github.com/bradygaster/squad/pull/102',
        node_id: 'PR_kwDO102',
        updated_at: '2026-05-20T10:01:00.000Z',
        created_at: '2026-05-20T09:01:00.000Z',
        pull_request: {},
      },
    ]);

    const triggerConfig = {
      contractVersion: GITHUB_ISSUE_INTAKE_CONTRACT_VERSION,
      owner: 'bradygaster',
      repo: 'squad',
      targetColumn: 'triage',
      triageCeremonyId: 'squad-issue-triage',
      excludePullRequests: true,
    };

    const first = await runGitHubIssueIntake({
      projectId,
      triggerConfig,
      client: { listIssues },
      now: new Date('2026-05-20T12:00:00.000Z'),
    });

    expect(first).toMatchObject({
      fetched: 2,
      created: 1,
      skipped: 1,
      workflowsStarted: 1,
      cursor: '2026-05-20T12:00:00.000Z',
    });

    const pool = dbContainer.pool!;
    const issues = await pool.query<{
      title: string;
      status: string;
      github_issue_number: number;
      idempotency_key: string;
    }>(`SELECT title, status, github_issue_number, idempotency_key FROM issues`);
    expect(issues.rows).toEqual([
      {
        title: 'Bug: intake fails',
        status: 'triage',
        github_issue_number: 101,
        idempotency_key: 'github:bradygaster/squad#101',
      },
    ]);

    const workflowRuns = await pool.query<{ id: string }>(`SELECT id FROM workflow_runs`);
    expect(workflowRuns.rows).toHaveLength(1);
    await advanceWorkflowRun(workflowRuns.rows[0].id);

    const issueRuns = await pool.query<{ input_context: string }>(
      `SELECT input_context FROM issue_runs`,
    );
    expect(issueRuns.rows).toHaveLength(1);
    expect(issueRuns.rows[0].input_context).toContain('Classify this issue');

    const workflowRunCount = await pool.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM workflow_runs`);
    expect(workflowRunCount.rows[0].count).toBe('1');

    const project = await pool.query<{ github_sync_last_at: Date }>(
      `SELECT github_sync_last_at FROM projects WHERE id = $1`,
      [projectId],
    );
    expect(new Date(project.rows[0].github_sync_last_at).toISOString()).toBe('2026-05-20T12:00:00.000Z');

    const second = await runGitHubIssueIntake({
      projectId,
      triggerConfig,
      client: { listIssues },
      now: new Date('2026-05-20T18:00:00.000Z'),
    });

    expect(second.created).toBe(0);
    expect(second.updated).toBe(0);
    expect(second.workflowsStarted).toBe(0);
    expect(listIssues).toHaveBeenLastCalledWith('2026-05-20T12:00:00.000Z', { state: 'open' });

    const issueCount = await pool.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM issues`);
    const runCount = await pool.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM workflow_runs`);
    expect(issueCount.rows[0].count).toBe('1');
    expect(runCount.rows[0].count).toBe('1');
  });
});

describe('GitHub doc review intake', () => {
  let projectId: string;
  let workflowId: string;

  beforeEach(async () => {
    const pool = dbContainer.pool!;
    await pool.query(`
      DELETE FROM step_runs;
      DELETE FROM workflow_runs;
      DELETE FROM issue_workflows;
      DELETE FROM workflow_versions;
      DELETE FROM workflows;
      DELETE FROM issue_runs;
      DELETE FROM issue_labels;
      DELETE FROM labels;
      DELETE FROM issues;
      DELETE FROM agents;
      DELETE FROM column_meta;
      DELETE FROM settings;
      DELETE FROM projects;
    `);

    const project = await pool.query<{ id: string }>(
      `INSERT INTO projects (name, path) VALUES ('Squad Doc Review', '.squad') RETURNING id`,
    );
    projectId = project.rows[0].id;

    await pool.query(
      `INSERT INTO column_meta (project_id, column_id, label, position, semantic, is_default)
       VALUES ($1, 'technical-review', 'Technical Review', 0, 'backlog', true)`,
      [projectId],
    );
    await pool.query(
      `INSERT INTO agents (project_id, name, role)
       VALUES ($1, 'docs-maintainer', 'Squad Docs Maintainer')`,
      [projectId],
    );
    const workflow = await pool.query<{ id: string }>(
      `INSERT INTO workflows (project_id, name, slug, trigger_kind, trigger_config, kind, status)
       VALUES ($1, 'Squad Doc Review Scheduled', 'squad-doc-review-scheduled', 'on_schedule', $2, 'ceremony', 'active')
       RETURNING id`,
      [
        projectId,
        JSON.stringify({
          contractVersion: DOC_REVIEW_INTAKE_CONTRACT_VERSION,
          owner: 'bradygaster',
          repo: 'squad',
          includePaths: ['docs/**', 'README.md'],
          reviewProfiles: ['technical-accuracy', 'reader-success'],
          finalAction: 'create-or-update-squadboard-issues',
        }),
      ],
    );
    workflowId = workflow.rows[0].id;
    await pool.query(
      `INSERT INTO workflow_versions (workflow_id, version, yaml_content, is_active)
       VALUES ($1, 1, $2, true)`,
      [
        workflowId,
        `name: Squad Doc Review
steps:
  - type: agent_run
    agent: docs-maintainer
    prompt: "Review this doc issue and create traceable findings."
`,
      ],
    );
    await pool.query(
      `INSERT INTO settings (key, value, project_id) VALUES ($1, $2, $3)`,
      [
        `project:${projectId}:docReview`,
        JSON.stringify({
          contractVersion: DOC_REVIEW_INTAKE_CONTRACT_VERSION,
          source: {
            type: 'github-repo',
            owner: 'bradygaster',
            repo: 'squad',
            includePaths: ['docs/**', 'README.md'],
          },
          reviewProfiles: ['technical-accuracy', 'reader-success'],
          rubric: { profile: 'balanced-maintainer' },
          staleThresholdDays: 30,
          triage: {
            labels: ['docs', 'technical-review', 'needs-owner'],
            stages: ['technical-review', 'reader-review'],
          },
          finalAction: {
            kind: 'create-or-update-squadboard-issues',
            autoEditDocs: false,
            draftPr: 'future-explicit-action-only',
          },
        }),
        projectId,
      ],
    );
  });

  it('uses source-specific cursor and doc/source-sha dedupe without auto-editing docs', async () => {
    const listRepositoryTree = vi.fn(async () => [
      { path: 'docs/intro.md', mode: '100644', type: 'blob' as const, sha: 'blob-intro' },
      { path: 'README.md', mode: '100644', type: 'blob' as const, sha: 'blob-readme' },
      { path: 'src/index.ts', mode: '100644', type: 'blob' as const, sha: 'blob-code' },
    ]);
    const listCommitsForPath = vi.fn(async (path: string) => [
      {
        sha: path === 'README.md' ? 'commit-readme' : 'commit-intro',
        html_url: `https://github.com/bradygaster/squad/commit/${path}`,
        commit: {
          committer: {
            date: path === 'README.md'
              ? '2026-04-01T00:00:00.000Z'
              : '2026-05-19T10:00:00.000Z',
          },
        },
      },
    ]);

    const first = await runGitHubDocReviewIntake({
      projectId,
      workflowId,
      scheduleId: 'schedule-1',
      triggerConfig: {
        contractVersion: DOC_REVIEW_INTAKE_CONTRACT_VERSION,
        owner: 'bradygaster',
        repo: 'squad',
        includePaths: ['docs/**', 'README.md'],
      },
      client: { listRepositoryTree, listCommitsForPath },
      now: new Date('2026-05-20T12:00:00.000Z'),
    });

    expect(first).toMatchObject({
      fetched: 2,
      candidates: 2,
      created: 2,
      workflowsStarted: 2,
      cursor: '2026-05-20T12:00:00.000Z',
    });

    const pool = dbContainer.pool!;
    const issues = await pool.query<{
      title: string;
      body: string;
      idempotency_key: string;
      deliverable_type: string;
    }>(
      `SELECT title, body, idempotency_key, deliverable_type
       FROM issues ORDER BY title`,
    );
    expect(issues.rows).toHaveLength(2);
    expect(issues.rows[0].idempotency_key).toContain('github-doc:bradygaster/squad:README.md:blob-readme:review-profile:balanced-maintainer');
    expect(issues.rows[0].body).toContain('Doc path: README.md');
    expect(issues.rows[0].body).toContain('Source SHA: blob-readme');
    expect(issues.rows[0].body).toContain('Auto-edit docs: no');
    expect(issues.rows[0].deliverable_type).toBe('doc');

    const cursor = await pool.query<{ key: string; value: string }>(
      `SELECT key, value FROM settings WHERE key LIKE $1`,
      [`project:${projectId}:sourceCursor:%`],
    );
    expect(cursor.rows).toHaveLength(1);
    expect(JSON.parse(cursor.rows[0].value)).toMatchObject({
      cursor: '2026-05-20T12:00:00.000Z',
      lastSuccessfulAt: '2026-05-20T12:00:00.000Z',
    });

    const second = await runGitHubDocReviewIntake({
      projectId,
      workflowId,
      scheduleId: 'schedule-1',
      triggerConfig: {
        contractVersion: DOC_REVIEW_INTAKE_CONTRACT_VERSION,
        owner: 'bradygaster',
        repo: 'squad',
        includePaths: ['docs/**', 'README.md'],
      },
      client: { listRepositoryTree, listCommitsForPath },
      now: new Date('2026-05-21T12:00:00.000Z'),
    });

    expect(second.created).toBe(0);
    expect(second.workflowsStarted).toBe(0);

    const counts = await pool.query<{ issues: string; runs: string }>(
      `SELECT
         (SELECT COUNT(*)::text FROM issues) AS issues,
         (SELECT COUNT(*)::text FROM workflow_runs) AS runs`,
    );
    expect(counts.rows[0]).toEqual({ issues: '2', runs: '2' });
  });
});
