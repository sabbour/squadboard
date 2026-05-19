import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PoolLike } from '../db/pglite.js';

const dbContainer = vi.hoisted(() => ({
  pg: null as import('@electric-sql/pglite').PGlite | null,
}));

vi.mock('../db/pglite.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db/pglite.js')>();
  return {
    ...actual,
    getPglite: () => dbContainer.pg,
  };
});

const originalEnv = {
  SKIP_BOOTSTRAP_DDL: process.env.SKIP_BOOTSTRAP_DDL,
  SQUADBOARD_CHARTER_BACKFILL: process.env.SQUADBOARD_CHARTER_BACKFILL,
};

import { closeDb, getPool, initDb } from '../db/index.js';
import { PGLITE_SENTINEL } from '../db/pglite.js';

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

async function insertIssueRunWithDependents(pool: PoolLike): Promise<string> {
  const [project] = (await pool.query<{ id: string }>(
    `INSERT INTO projects (name, path) VALUES ('PGlite regression project', '.') RETURNING id`,
  )).rows;

  const [agent] = (await pool.query<{ id: string }>(
    `INSERT INTO agents (project_id, name, role, charter_path, charter_content)
     VALUES ($1, 'Kujan Synthetic', 'Tester', '.squad/agents/kujan/charter.md', '')
     RETURNING id`,
    [project.id],
  )).rows;

  const [issue] = (await pool.query<{ id: string }>(
    `INSERT INTO issues (project_id, title, body, status)
     VALUES ($1, 'PGlite claim regression', 'Exercise issue_runs update path', 'ready')
     RETURNING id`,
    [project.id],
  )).rows;

  const [run] = (await pool.query<{ id: string }>(
    `INSERT INTO issue_runs (issue_id, agent_id, status)
     VALUES ($1, $2, 'pending')
     RETURNING id`,
    [issue.id, agent.id],
  )).rows;

  const [workflowRun] = (await pool.query<{ id: string }>(
    `INSERT INTO workflow_runs (issue_id, status) VALUES ($1, 'pending') RETURNING id`,
    [issue.id],
  )).rows;

  const [stepRun] = (await pool.query<{ id: string }>(
    `INSERT INTO step_runs (workflow_run_id, issue_run_id, step_index, step_type)
     VALUES ($1, $2, 0, 'agent_run')
     RETURNING id`,
    [workflowRun.id, run.id],
  )).rows;

  await pool.query(
    `INSERT INTO issue_run_events (run_id, seq, event_type, payload)
     VALUES ($1, 0, 'start', '{}'::jsonb)`,
    [run.id],
  );

  await pool.query(
    `INSERT INTO routing_log (project_id, issue_id, tier, resolved_agent, specifier_run_id)
     VALUES ($1, $2, 3, 'Kujan Synthetic', $3)`,
    [project.id, issue.id, run.id],
  );

  await pool.query(
    `INSERT INTO review_events (workflow_run_id, step_run_id, issue_run_id, reviewer_name, verb)
     VALUES ($1, $2, $3, 'Kujan Synthetic', 'comment')`,
    [workflowRun.id, stepRun.id, run.id],
  );

  await pool.query(
    `INSERT INTO deliverables (issue_id, run_id, kind, title, payload)
     VALUES ($1, $2, 'text', 'Synthetic deliverable', '{}'::jsonb)`,
    [issue.id, run.id],
  );

  return run.id;
}

describe('PGlite issue_runs claim regression', () => {
  beforeEach(async () => {
    process.env.SKIP_BOOTSTRAP_DDL = '1';
    process.env.SQUADBOARD_CHARTER_BACKFILL = '0';

    dbContainer.pg = new PGlite();
    await dbContainer.pg.waitReady;
    await initDb(PGLITE_SENTINEL);
    await applyForwardMigrations(getPool());
  });

  afterEach(async () => {
    await closeDb();
    dbContainer.pg = null;
    restoreEnv();
  });

  it('Invariant: a migrated PGlite issue_run can be claimed running without malformed FK trigger failure', async () => {
    // What does the system do when every issue_runs dependent exists and the
    // ready-workflow-step sweep performs its running-claim UPDATE? It must not
    // trip ri_LoadConstraintInfo with "constraint ... is not a foreign key".
    const pool = getPool();
    const runId = await insertIssueRunWithDependents(pool);

    const claim = await pool.query(
      `UPDATE issue_runs
       SET status = 'running',
           lease_expires_at = NOW() + INTERVAL '90 seconds',
           heartbeat_at = NOW(),
           started_at = NOW(),
           updated_at = NOW()
       WHERE id = $1`,
      [runId],
    );

    expect(claim.rowCount).toBe(1);

    const [claimed] = (await pool.query<{
      status: string;
      lease_expires_at: Date | string | null;
      heartbeat_at: Date | string | null;
      started_at: Date | string | null;
    }>(
      `SELECT status, lease_expires_at, heartbeat_at, started_at
       FROM issue_runs
       WHERE id = $1`,
      [runId],
    )).rows;

    expect(claimed.status).toBe('running');
    expect(claimed.lease_expires_at).toBeTruthy();
    expect(claimed.heartbeat_at).toBeTruthy();
    expect(claimed.started_at).toBeTruthy();
  });
});
