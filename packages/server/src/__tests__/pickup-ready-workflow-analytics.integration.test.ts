import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { readdir, readFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
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
  COORDINATOR_DISPATCH_ENABLED: process.env.COORDINATOR_DISPATCH_ENABLED,
  SQUADBOARD_CHARTER_BACKFILL: process.env.SQUADBOARD_CHARTER_BACKFILL,
  SKIP_BOOTSTRAP_DDL: process.env.SKIP_BOOTSTRAP_DDL,
};

import { closeDb, getPool, initDb } from '../db/index.js';
import { PGLITE_SENTINEL } from '../db/pglite.js';
import analyticsRouter from '../routes/analytics.js';
import { pickupReadySweep } from '../engine/sweeps/pickup-ready.js';

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

async function seedReadyPickupScenario(pool: PoolLike): Promise<{
  projectId: string;
  issueId: string;
  agentId: string;
}> {
  const workPickup = BUILT_IN_CEREMONIES.find((ceremony) => ceremony.slug === 'work-pickup');
  if (!workPickup) throw new Error('built-in Work Pickup ceremony not found');

  const [project] = (await pool.query<{ id: string }>(
    `INSERT INTO projects (name, path)
     VALUES ('Metrics regression project', '.')
     RETURNING id`,
  )).rows;

  await pool.query(
    `INSERT INTO column_meta (project_id, column_id, label, color, position, semantic, is_default)
     VALUES ($1, 'ready', 'Ready', '#238636', 10, 'ready', false)`,
    [project.id],
  );

  const [agent] = (await pool.query<{ id: string }>(
    `INSERT INTO agents (project_id, name, role, charter_path, charter_content, status)
     VALUES ($1, 'Kujan', 'Lead Reviewer', '.squad/agents/kujan/charter.md', '# Kujan', 'active')
     RETURNING id`,
    [project.id],
  )).rows;

  const [issue] = (await pool.query<{ id: string }>(
    `INSERT INTO issues (project_id, title, body, status)
     VALUES ($1, 'Ready pickup should count as workflow health', 'Regression fixture', 'ready')
     RETURNING id`,
    [project.id],
  )).rows;

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
    [project.id, JSON.stringify({ signalName: 'board.ready' })],
  )).rows;

  await pool.query(
    `INSERT INTO workflow_versions (workflow_id, version, yaml_content, is_active)
     VALUES ($1, 1, $2, true)`,
    [workflow.id, workPickup.yamlContent],
  );

  return { projectId: project.id, issueId: issue.id, agentId: agent.id };
}

async function fetchJson<T>(path: string): Promise<T> {
  const app = express();
  app.use(express.json());
  app.use('/api/projects/:id/analytics', analyticsRouter);

  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });

  try {
    const address = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`);
    expect(response.status).toBe(200);
    return await response.json() as T;
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

describe('pickup-ready Work Pickup workflow analytics integration', () => {
  beforeEach(async () => {
    process.env.COORDINATOR_DISPATCH_ENABLED = '0';
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

  it('queues one agent run and records one completed Work Pickup workflow run counted by analytics', async () => {
    const pool = getPool();
    const { projectId, issueId, agentId } = await seedReadyPickupScenario(pool);

    const result = await pickupReadySweep.run();

    expect(result).toMatchObject({ acted: 1, errors: 0 });

    const issueRuns = (await pool.query<{
      id: string;
      kind: string;
      status: string;
      agent_id: string;
    }>(
      `SELECT id, kind, status, agent_id
       FROM issue_runs
       WHERE issue_id = $1
       ORDER BY created_at ASC`,
      [issueId],
    )).rows;

    expect(issueRuns).toHaveLength(1);
    expect(issueRuns[0]).toMatchObject({
      kind: 'agent_run',
      status: 'pending',
      agent_id: agentId,
    });

    const workflowRuns = (await pool.query<{
      id: string;
      status: string;
      workflow_name: string;
      step_count: number;
      completed_steps: number;
    }>(
      `SELECT
         wr.id,
         wr.status,
         w.name AS workflow_name,
         COUNT(sr.id)::int AS step_count,
         COUNT(sr.id) FILTER (WHERE sr.status = 'completed')::int AS completed_steps
       FROM workflow_runs wr
       JOIN workflow_versions wv ON wv.id = wr.workflow_version_id
       JOIN workflows w ON w.id = wv.workflow_id
       LEFT JOIN step_runs sr ON sr.workflow_run_id = wr.id
       WHERE wr.issue_id = $1 AND w.slug = 'work-pickup'
       GROUP BY wr.id, wr.status, w.name`,
      [issueId],
    )).rows;

    expect(workflowRuns).toHaveLength(1);
    expect(workflowRuns[0]).toMatchObject({
      status: 'completed',
      workflow_name: 'Work Pickup',
      step_count: 3,
      completed_steps: 3,
    });

    const workflowAnalytics = await fetchJson<{
      workflows: Array<{ name: string; runsTotal: number; completedRuns: number; failedRuns: number }>;
    }>(`/api/projects/${projectId}/analytics/workflows`);
    const workPickupStats = workflowAnalytics.workflows.find((workflow) => workflow.name === 'Work Pickup');

    expect(workPickupStats).toMatchObject({
      runsTotal: 1,
      completedRuns: 1,
      failedRuns: 0,
    });

    const agentAnalytics = await fetchJson<{
      agents: Array<{ name: string; runsTotal: number }>;
    }>(`/api/projects/${projectId}/analytics/agents`);
    const kujanStats = agentAnalytics.agents.find((agent) => agent.name === 'Kujan');

    expect(kujanStats).toMatchObject({ runsTotal: 1 });
  });
});
