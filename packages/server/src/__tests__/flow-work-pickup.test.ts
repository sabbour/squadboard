import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { BUILT_IN_CEREMONIES } from '../ceremonies/built-in/index.js';
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
  SQUADBOARD_CHARTER_BACKFILL: process.env.SQUADBOARD_CHARTER_BACKFILL,
  SKIP_BOOTSTRAP_DDL: process.env.SKIP_BOOTSTRAP_DDL,
};

import { closeDb, getPool, initDb } from '../db/index.js';
import { PGLITE_SENTINEL } from '../db/pglite.js';
import { getIssueFlow } from '../services/flow.js';

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

async function seedIssue(pool: PoolLike): Promise<{
  projectId: string;
  issueId: string;
  agentId: string;
}> {
  const [project] = (await pool.query<{ id: string }>(
    `INSERT INTO projects (name, path)
     VALUES ('Flow Work Pickup project', '.')
     RETURNING id`,
  )).rows;

  const [agent] = (await pool.query<{ id: string }>(
    `INSERT INTO agents (project_id, name, role, charter_path, charter_content, status)
     VALUES ($1, 'Kujan', 'Lead Reviewer', '.squad/agents/kujan/charter.md', '# Kujan', 'active')
     RETURNING id`,
    [project.id],
  )).rows;

  const [issue] = (await pool.query<{ id: string }>(
    `INSERT INTO issues (project_id, title, body, status)
     VALUES ($1, 'Render Work Pickup failure path', 'Regression fixture', 'ready')
     RETURNING id`,
    [project.id],
  )).rows;

  return { projectId: project.id, issueId: issue.id, agentId: agent.id };
}

async function insertFailedWorkPickupRun(
  pool: PoolLike,
  issueId: string,
  agentId: string,
): Promise<{ id: string }> {
  const [run] = (await pool.query<{ id: string }>(
    `INSERT INTO issue_runs (
       issue_id, agent_id, kind, status, output, error_message,
       routing_tier, routing_reasoning, started_at, completed_at
     )
     VALUES (
       $1, $2, 'agent_run', 'failed',
       '[auto-dispatched by pickup-ready sweep]',
       'CLI exited 1',
       2,
       'keyword-score selected Kujan',
       now(),
       now()
     )
     RETURNING id`,
    [issueId, agentId],
  )).rows;
  return run;
}

describe('Work Pickup issue flow', () => {
  beforeEach(async () => {
    process.env.SQUADBOARD_CHARTER_BACKFILL = '0';
    process.env.SKIP_BOOTSTRAP_DDL = '1';

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

  it('renders the implicit default Work Pickup plan before a failed pickup-ready run', async () => {
    const pool = getPool();
    const { projectId, issueId, agentId } = await seedIssue(pool);
    const run = await insertFailedWorkPickupRun(pool, issueId, agentId);

    const flow = await getIssueFlow(projectId, issueId);

    expect(flow.workflowVersion).toBeNull();
    expect(flow.stepRuns.map((step) => step.label)).toEqual([
      'Confirm ready card',
      'Choose worker',
      'Start work',
      'Agent run',
    ]);
    expect(flow.stepRuns.map((step) => step.kind)).toEqual([
      'route',
      'agent_run',
      'notify',
      'agent_run',
    ]);
    expect(flow.stepRuns[3]).toMatchObject({
      id: run.id,
      status: 'failed',
      agentName: 'Kujan',
      outputSummary: 'CLI exited 1',
    });
    expect(flow.edges.map((edge) => [edge.from, edge.to])).toEqual([
      [`work-pickup:${run.id}:confirm-ready`, `work-pickup:${run.id}:choose-agent`],
      [`work-pickup:${run.id}:choose-agent`, `work-pickup:${run.id}:start-work`],
      [`work-pickup:${run.id}:start-work`, run.id],
    ]);
  });

  it('links recorded Work Pickup ceremony steps to the actual failed agent run', async () => {
    const pool = getPool();
    const { projectId, issueId, agentId } = await seedIssue(pool);
    const run = await insertFailedWorkPickupRun(pool, issueId, agentId);
    const workPickup = BUILT_IN_CEREMONIES.find((ceremony) => ceremony.slug === 'work-pickup');
    if (!workPickup) throw new Error('built-in Work Pickup ceremony not found');

    const [workflow] = (await pool.query<{ id: string }>(
      `INSERT INTO workflows (
         project_id, name, slug, description, trigger_kind, trigger_config, kind, status
       )
       VALUES (
         $1, 'Work Pickup', 'work-pickup',
         'Required default run plan for assigning Ready cards.',
         'agent-signal', $2::jsonb, 'ceremony', 'active'
       )
       RETURNING id`,
      [projectId, JSON.stringify({ signalName: 'board.ready' })],
    )).rows;

    const [version] = (await pool.query<{ id: string }>(
      `INSERT INTO workflow_versions (workflow_id, version, yaml_content, is_active)
       VALUES ($1, 1, $2, true)
       RETURNING id`,
      [workflow.id, workPickup.yamlContent],
    )).rows;

    const [workflowRun] = (await pool.query<{ id: string }>(
      `INSERT INTO workflow_runs (issue_id, workflow_version_id, status, trigger_source)
       VALUES ($1, $2, 'completed', $3::jsonb)
       RETURNING id`,
      [
        issueId,
        version.id,
        JSON.stringify({
          kind: 'on_event',
          eventType: 'agent-signal:board.ready',
          detail: JSON.stringify({
            issueId,
            issueRunId: run.id,
            agentId,
            agentName: 'Kujan',
            routingTier: 2,
          }),
          anchorIssueId: issueId,
        }),
      ],
    )).rows;

    await pool.query(
      `INSERT INTO step_runs (workflow_run_id, step_index, step_type, status)
       VALUES
         ($1, 0, 'route', 'completed'),
         ($1, 1, 'agent_run', 'completed'),
         ($1, 2, 'notify', 'completed')`,
      [workflowRun.id],
    );

    const steps = (await pool.query<{ id: string; step_index: number }>(
      `SELECT id, step_index
       FROM step_runs
       WHERE workflow_run_id = $1
       ORDER BY step_index`,
      [workflowRun.id],
    )).rows;

    const flow = await getIssueFlow(projectId, issueId);

    expect(flow.workflowVersion).toEqual({ id: version.id, name: 'Work Pickup' });
    expect(flow.stepRuns.map((step) => step.label)).toEqual([
      'Confirm ready card',
      'Choose worker',
      'Start work',
      'Agent run',
    ]);
    expect(flow.stepRuns[1]).toMatchObject({ agentName: 'Coordinator', agentRole: 'Routing' });
    expect(flow.stepRuns[2]).toMatchObject({ kind: 'notify', agentName: 'Kujan' });
    expect(flow.stepRuns[3]).toMatchObject({
      id: run.id,
      status: 'failed',
      outputSummary: 'CLI exited 1',
    });
    expect(flow.edges).toEqual(
      expect.arrayContaining([
        { from: steps[0].id, to: steps[1].id, kind: 'sequence' },
        { from: steps[1].id, to: steps[2].id, kind: 'sequence' },
        { from: steps[2].id, to: run.id, kind: 'sequence' },
      ]),
    );
  });
});
