import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import type { PoolLike } from '../db/pglite.js';

const testState = vi.hoisted(() => {
  const state = {
    pg: null as import('@electric-sql/pglite').PGlite | null,
    executeAgentRun: vi.fn(),
    emitFlowEvent: vi.fn(),
    emitFlowHeartbeat: vi.fn(),
    emitIssueEvent: vi.fn(),
    recordRunCompletion: vi.fn(async (issueRunId: string, output: string) => {
      if (!state.pg) throw new Error('PGlite test database is not initialized');
      await state.pg.query(
        `UPDATE issue_runs
         SET status = 'completed',
             output = $2,
             lease_expires_at = NULL,
             heartbeat_at = NULL,
             completed_at = NOW(),
             updated_at = NOW()
         WHERE id = $1`,
        [issueRunId, output],
      );
    }),
  };
  return state;
});

vi.mock('../db/pglite.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db/pglite.js')>();
  return {
    ...actual,
    getPglite: () => testState.pg,
  };
});

vi.mock('../engine/workspace.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../engine/workspace.js')>();
  return {
    ...actual,
    resolveWorkspaceLifecycle: vi.fn(async (
      _issueRunId: string,
      strategy: 'scratch' | 'dir' | 'worktree',
    ) => ({
      workspacePath: process.cwd(),
      workspaceStrategy: strategy,
      branch: null,
      cleanup: {},
    })),
  };
});

vi.mock('../sdk/bridge.js', () => ({
  executeAgentRun: testState.executeAgentRun,
}));

vi.mock('../services/output-validator.js', () => ({
  recordRunCompletion: testState.recordRunCompletion,
}));

vi.mock('../realtime/event-bus.js', () => ({
  eventBus: {
    emitFlowEvent: testState.emitFlowEvent,
    emitFlowHeartbeat: testState.emitFlowHeartbeat,
    emitIssueEvent: testState.emitIssueEvent,
  },
}));

const originalEnv = {
  SKIP_BOOTSTRAP_DDL: process.env.SKIP_BOOTSTRAP_DDL,
  SQUADBOARD_CHARTER_BACKFILL: process.env.SQUADBOARD_CHARTER_BACKFILL,
};

import { closeDb, getPool, initDb } from '../db/index.js';
import { PGLITE_SENTINEL } from '../db/pglite.js';
import { runWorker } from '../engine/stepper.js';

function restoreEnv(): void {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

async function applyForwardMigrations(pool: PoolLike): Promise<void> {
  const migrationsDir = fileURLToPath(new URL('../db/migrations/', import.meta.url));
  const migrationFiles = (await readdir(migrationsDir))
    .filter((name) => /^\d+_.*\.sql$/.test(name) && !name.endsWith('.rollback.sql'))
    .sort();

  for (const filename of migrationFiles) {
    await pool.query(await readFile(join(migrationsDir, filename), 'utf8'));
  }
}

async function seedRunningAgentRun(
  pool: PoolLike,
  overrides: { agentStatus?: 'active' | 'disabled' | 'retired' } = {},
): Promise<{ projectId: string; issueId: string; runId: string }> {
  const [project] = (await pool.query<{ id: string }>(
    `INSERT INTO projects (name, path)
     VALUES ('Stepper review promotion regression', '.')
     RETURNING id`,
  )).rows;

  await pool.query(
    `INSERT INTO column_meta (project_id, column_id, label, color, position, semantic, is_default)
     VALUES
       ($1, 'ready', 'Ready', '#388bfd', 10, 'ready', false),
       ($1, 'in_progress', 'In Progress', '#d29922', 20, 'in_progress', false),
       ($1, 'in_review', 'In Review', '#a371f7', 30, 'review', false)`,
    [project.id],
  );

  const [agent] = (await pool.query<{ id: string }>(
    `INSERT INTO agents (project_id, name, role, charter_path, charter_content, status)
     VALUES ($1, 'Kujan', 'Tester', '.squad/agents/kujan/charter.md', '# Kujan', $2)
     RETURNING id`,
    [project.id, overrides.agentStatus ?? 'active'],
  )).rows;

  const [issue] = (await pool.query<{ id: string }>(
    `INSERT INTO issues (project_id, title, body, status)
     VALUES ($1, 'Failed run must not enter review', 'Regression fixture', 'in_progress')
     RETURNING id`,
    [project.id],
  )).rows;

  const [run] = (await pool.query<{ id: string }>(
    `INSERT INTO issue_runs (
       issue_id, agent_id, kind, status, workspace_strategy, started_at, heartbeat_at
     )
     VALUES ($1, $2, 'agent_run', 'running', 'dir', NOW(), NOW())
     RETURNING id`,
    [issue.id, agent.id],
  )).rows;

  return { projectId: project.id, issueId: issue.id, runId: run.id };
}

async function issueStatus(pool: PoolLike, issueId: string): Promise<string> {
  const [issue] = (await pool.query<{ status: string }>(
    `SELECT status FROM issues WHERE id = $1`,
    [issueId],
  )).rows;
  return issue.status;
}

describe('stepper review promotion guard', () => {
  beforeEach(async () => {
    process.env.SKIP_BOOTSTRAP_DDL = '1';
    process.env.SQUADBOARD_CHARTER_BACKFILL = '0';

    testState.pg = new PGlite();
    await testState.pg.waitReady;
    await initDb(PGLITE_SENTINEL);
    await applyForwardMigrations(getPool());

    testState.executeAgentRun.mockReset();
    testState.recordRunCompletion.mockClear();
    testState.emitFlowEvent.mockClear();
    testState.emitFlowHeartbeat.mockClear();
    testState.emitIssueEvent.mockClear();
  });

  afterEach(async () => {
    await closeDb();
    testState.pg = null;
    restoreEnv();
  });

  it('promotes the owning work to review only after a successful completion', async () => {
    const pool = getPool();
    const { projectId, issueId, runId } = await seedRunningAgentRun(pool);
    testState.executeAgentRun.mockResolvedValueOnce({
      success: true,
      output: 'Ready for review.',
      tokensUsed: 12,
      costUsd: '0.02',
    });

    await runWorker(runId);

    expect(await issueStatus(pool, issueId)).toBe('in_review');
    expect(testState.recordRunCompletion).toHaveBeenCalledWith(runId, 'Ready for review.', null);
    expect(testState.emitIssueEvent).toHaveBeenCalledWith(
      'issue.moved',
      projectId,
      expect.objectContaining({ issueId, column: 'in_review' }),
    );
  });

  it.each([
    ['failed result', () => {
      testState.executeAgentRun.mockResolvedValueOnce({
        success: false,
        errorMessage: 'CLI exited with code 1',
      });
    }],
    ['cancelled result', () => {
      testState.executeAgentRun.mockResolvedValueOnce({
        success: false,
        errorMessage: 'Run was cancelled by the operator',
      });
    }],
    ['timeout error', () => {
      testState.executeAgentRun.mockRejectedValueOnce(new Error('Timed out waiting for agent output'));
    }],
  ])('does not promote the owning work to review after a %s', async (_label, configureRun) => {
    const pool = getPool();
    const { issueId, runId } = await seedRunningAgentRun(pool);
    configureRun();

    await runWorker(runId);

    expect(await issueStatus(pool, issueId)).toBe('in_progress');
    expect(testState.emitIssueEvent).not.toHaveBeenCalledWith(
      'issue.moved',
      expect.any(String),
      expect.objectContaining({ issueId, column: 'in_review' }),
    );
  });

  it('does not promote the owning work to review when the run fails before agent execution', async () => {
    const pool = getPool();
    const { issueId, runId } = await seedRunningAgentRun(pool, { agentStatus: 'disabled' });

    await runWorker(runId);

    expect(testState.executeAgentRun).not.toHaveBeenCalled();
    expect(await issueStatus(pool, issueId)).toBe('in_progress');
  });
});
