import { afterEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPoolAdapter } from '../db/pglite.js';
import { repairPgliteIssueRunEventsFkCatalog } from '../db/index.js';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const WORKSPACE_ROOT = path.join(SERVER_ROOT, '.test-workspaces', 'pglite-issue-run-events-catalog-repair');

let workspaceCounter = 0;
const cleanupPaths: string[] = [];

async function makeDataDir(): Promise<string> {
  workspaceCounter += 1;
  const dataDir = path.join(WORKSPACE_ROOT, `${process.pid}-${workspaceCounter}`, 'pglite');
  cleanupPaths.push(path.dirname(dataDir));
  await rm(path.dirname(dataDir), { recursive: true, force: true });
  await mkdir(dataDir, { recursive: true });
  return dataDir;
}

async function expectIssueRunUpdateFails(dataDir: string, runId: string): Promise<void> {
  const pg = new PGlite(dataDir);
  await pg.waitReady;
  try {
    await expect(
      pg.query(`UPDATE issue_runs SET status = 'running' WHERE id = $1`, [runId]),
    ).rejects.toThrow(/not a foreign key constraint/);
  } finally {
    await pg.close();
  }
}

async function createCorruptedIssueRunEventsCatalog(dataDir: string): Promise<string> {
  const pg = new PGlite(dataDir);
  await pg.waitReady;
  try {
    await pg.exec(`
      CREATE TABLE issue_runs (
        id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        status  TEXT NOT NULL DEFAULT 'pending'
      );

      CREATE TABLE issue_run_events (
        id          BIGSERIAL   PRIMARY KEY,
        run_id      UUID        NOT NULL REFERENCES issue_runs(id) ON DELETE CASCADE,
        seq         INTEGER     NOT NULL,
        event_type  TEXT        NOT NULL,
        payload     JSONB       NOT NULL DEFAULT '{}'::jsonb,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT  issue_run_events_run_seq_uniq UNIQUE (run_id, seq)
      );
    `);

    const inserted = await pg.query<{ id: string }>(
      `INSERT INTO issue_runs DEFAULT VALUES RETURNING id`,
    );
    const runId = inserted.rows[0].id;
    const badConstraint = await pg.query<{ oid: number }>(`
      SELECT oid::int AS oid
      FROM pg_constraint
      WHERE conname = 'issue_run_events_run_seq_uniq'
    `);
    const badOid = Number(badConstraint.rows[0]?.oid);
    expect(Number.isInteger(badOid)).toBe(true);

    await pg.query(`
      UPDATE pg_trigger
      SET tgconstraint = ${badOid}::oid
      WHERE (tgrelid = 'issue_runs'::regclass AND tgconstrrelid = 'issue_run_events'::regclass)
         OR (tgrelid = 'issue_run_events'::regclass AND tgconstrrelid = 'issue_runs'::regclass)
    `);

    return runId;
  } finally {
    await pg.close();
  }
}

afterEach(async () => {
  await Promise.all(cleanupPaths.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});

describe('PGlite issue_run_events FK catalog repair', () => {
  it('repoints corrupted RI triggers before issue_runs updates run', async () => {
    const dataDir = await makeDataDir();
    const runId = await createCorruptedIssueRunEventsCatalog(dataDir);

    await expectIssueRunUpdateFails(dataDir, runId);

    const pg = new PGlite(dataDir);
    await pg.waitReady;
    try {
      const pool = createPoolAdapter(pg);
      await expect(repairPgliteIssueRunEventsFkCatalog(pool)).resolves.toBe(4);
      await expect(
        pool.query(`UPDATE issue_runs SET status = 'running' WHERE id = $1`, [runId]),
      ).resolves.toMatchObject({ rowCount: 1 });
    } finally {
      await pg.close();
    }
  }, 30000);
});
