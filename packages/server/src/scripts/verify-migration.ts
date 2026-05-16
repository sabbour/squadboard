/**
 * verify-migration.ts
 *
 * Post-migration verification: compares row counts between the legacy
 * embedded-postgres cluster and the new PGlite cluster.
 *
 * Usage:
 *   tsx packages/server/src/scripts/verify-migration.ts
 *   tsx packages/server/src/scripts/verify-migration.ts --verbose
 *
 * Reads the marker file for the expected row counts (source_counts) and compares
 * them against actual PGlite counts. Reports per-table deltas with status icons.
 * After verification, patches the marker to include a `dest_counts` block so
 * future verifications are self-contained (no live PGlite required).
 *
 * When the server is running (detected by GET http://localhost:3000/api/health),
 * counts are fetched via GET /api/system/db-counts to avoid opening a second
 * PGlite instance against the same data directory (which would corrupt state).
 * When the server is NOT running, PGlite is booted directly.
 *
 * Exported:
 *   runVerify({ verbose }) → Promise<boolean>  (true = all OK)
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const HOME = homedir();
const MARKER_FILE = join(HOME, '.squadboard', 'data', '.migrated-to-pglite-v1');
const SERVER_BASE = 'http://localhost:3000';

export interface MarkerPayload {
  migrated_at: string;
  source_path: string;
  dest_path: string;
  pg_major_version: number;
  /** Source counts read from the legacy embedded-PG cluster at migration time. */
  row_counts: Record<string, number>;
  /** Destination counts stamped by --verify after the migration. Self-contained audit trail. */
  dest_counts?: {
    verified_at: string;
    counts: Record<string, number>;
    all_ok: boolean;
  };
}

export interface VerifyOptions {
  verbose?: boolean;
}

/** Returns true if the squadboard server appears to be live on localhost:3000. */
async function isServerRunning(): Promise<boolean> {
  try {
    const { default: http } = await import('node:http');
    return await new Promise<boolean>((resolve) => {
      const req = http.get(`${SERVER_BASE}/api/health`, { timeout: 1500 }, (res) => {
        resolve(res.statusCode === 200);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
    });
  } catch {
    return false;
  }
}

/** Fetch live table counts from the running server's /api/system/db-counts endpoint. */
async function fetchCountsFromServer(): Promise<Record<string, number>> {
  const { default: http } = await import('node:http');
  return new Promise<Record<string, number>>((resolve, reject) => {
    http.get(`${SERVER_BASE}/api/system/db-counts`, (res) => {
      let body = '';
      res.on('data', (chunk: string) => { body += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body) as { ok: boolean; counts: Record<string, number> };
          if (parsed.ok) resolve(parsed.counts);
          else reject(new Error(`Server db-counts returned ok=false: ${body}`));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

/**
 * Verify migration row counts. Queries all tables (via HTTP if server is live,
 * or via direct PGlite boot if not). Diffs against marker's source counts.
 * Patches marker with dest_counts block.
 * Returns true if all actual >= expected.
 */
export async function runVerify(opts: VerifyOptions = {}): Promise<boolean> {
  const { verbose = false } = opts;

  // ── Read marker ────────────────────────────────────────────────────────────
  if (!existsSync(MARKER_FILE)) {
    console.error(`[verify] No marker file found at ${MARKER_FILE}`);
    console.error('[verify] Run `squadboard migrate` first.');
    return false;
  }

  const marker: MarkerPayload = JSON.parse(readFileSync(MARKER_FILE, 'utf8'));
  const expectedCounts = marker.row_counts;

  console.log(`[verify] Migration marker from: ${marker.migrated_at}`);
  console.log(`[verify] Source: ${marker.source_path}`);
  console.log(`[verify] Destination: ${marker.dest_path}`);
  if (marker.dest_counts) {
    console.log(`[verify] Previous dest_counts verified at: ${marker.dest_counts.verified_at}`);
  }
  console.log('');

  // ── Acquire counts (HTTP if server live, else direct PGlite) ──────────────
  let destCounts: Record<string, number>;
  const serverLive = await isServerRunning();

  if (serverLive) {
    console.log(`[verify] Server detected at ${SERVER_BASE} — fetching counts via HTTP`);
    destCounts = await fetchCountsFromServer();
  } else {
    console.log('[verify] Server not running — booting PGlite directly');
    const { startPglite, createPoolAdapter, getPglite } = await import('../db/pglite.js');
    const connStr = await startPglite();

    if (connStr !== 'pglite://local') {
      console.error('[verify] DATABASE_URL is set — cannot verify PGlite directly');
      return false;
    }

    const pglite = getPglite();
    if (!pglite) throw new Error('[verify] PGlite instance null');
    const pool = createPoolAdapter(pglite);

    const { initDb } = await import('../db/index.js');
    await initDb(connStr);

    const tablesRes = await pool.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
    );
    destCounts = {};
    for (const row of tablesRes.rows) {
      const tbl = row['tablename'];
      const countRes = await pool.query(`SELECT COUNT(*) AS cnt FROM "${tbl}"`);
      destCounts[tbl] = parseInt(String(countRes.rows[0]?.['cnt'] ?? '0'), 10);
    }
  }

  // ── Compare counts ─────────────────────────────────────────────────────────
  let allOk = true;
  const results: Array<{ table: string; expected: number; actual: number; ok: boolean }> = [];

  for (const [table, expectedCount] of Object.entries(expectedCounts)) {
    const actual = destCounts[table] ?? 0;
    const ok = actual >= expectedCount;
    if (expectedCount > 0 || verbose) {
      results.push({ table, expected: expectedCount, actual, ok });
    }
    if (!ok) allOk = false;
  }

  // ── Report ─────────────────────────────────────────────────────────────────
  const maxTable = Math.max(...results.map((r) => r.table.length), 10);

  console.log(`${'Table'.padEnd(maxTable)}  Source  Dest   Status`);
  console.log(`${'-'.repeat(maxTable)}  ------  -----  ------`);

  for (const r of results) {
    let status: string;
    if (r.actual === 0 && r.expected === 0) {
      status = '✅ match (empty)';
    } else if (r.actual >= r.expected) {
      const delta = r.actual - r.expected;
      status = delta > 0 ? `✅ match (+${delta} post-migration)` : '✅ match';
    } else {
      status = `❌ short by ${r.expected - r.actual}`;
    }
    console.log(
      `${r.table.padEnd(maxTable)}  ${String(r.expected).padStart(6)}  ${String(r.actual).padStart(5)}  ${status}`,
    );
  }

  console.log('');
  if (allOk) {
    console.log('[verify] ✅ All row counts match — migration verified.');
  } else {
    console.error('[verify] ❌ Some tables have mismatched counts — check above.');
  }

  // ── Patch marker with dest_counts ─────────────────────────────────────────
  const updated: MarkerPayload = {
    ...marker,
    dest_counts: {
      verified_at: new Date().toISOString(),
      counts: destCounts,
      all_ok: allOk,
    },
  };
  writeFileSync(MARKER_FILE, JSON.stringify(updated, null, 2), 'utf8');
  console.log(`[verify] Marker updated with dest_counts at ${MARKER_FILE}`);

  return allOk;
}

// ─── Standalone entry point ───────────────────────────────────────────────────

import { fileURLToPath } from 'node:url';

async function main(): Promise<void> {
  const verbose = process.argv.includes('--verbose') || process.argv.includes('-v');
  const ok = await runVerify({ verbose });
  process.exit(ok ? 0 : 1);
}

const thisFile = fileURLToPath(import.meta.url);
const argv1 = process.argv[1] ?? '';
if (argv1 === thisFile || argv1.endsWith('/verify-migration.js') || argv1.endsWith('/verify-migration.ts')) {
  main().catch((err) => {
    console.error('[verify] Fatal:', err);
    process.exit(1);
  });
}
