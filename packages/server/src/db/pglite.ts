/**
 * pglite.ts — PGlite in-process Postgres engine (replaces embedded-postgres).
 *
 * Decision recorded 2026-05-15: no embedded PG. PGlite (~5 MB WASM)
 * replaces embedded-postgres (~50 MB per-platform binary).
 *
 * Exports a pool-compatible adapter so all callers of getPool() in db/index.ts
 * continue to work without per-caller changes. The adapter honours:
 *   - pool.query(sql, params?)     → pglite.query()
 *   - pool.connect()               → fake client (BEGIN/COMMIT/ROLLBACK pass-through)
 *   - client.release()             → no-op (PGlite is single in-process connection)
 *   - result.rowCount              → maps from PGlite's affectedRows
 *
 * DATABASE_URL override: when set, this module returns the env value and does
 * NOT boot PGlite. initDb() in db/index.ts detects DATABASE_URL and falls back
 * to a real pg.Pool. This keeps CI / cloud deployments working unchanged.
 *
 * Data directory: ~/.squadboard/data/pglite
 * (parent dir unchanged from the old embedded-postgres layout; the `pglite`
 * sub-dir leaves room for a one-time migrator that reads the legacy
 * ~/.squadboard/data/postgres cluster on first boot — see TODO below.)
 *
 * TODO (q1-followup-data-migration): write a one-time migrator that, on first
 * boot of the new server with a clean pglite dir, checks whether
 * ~/.squadboard/data/postgres/ exists (legacy embedded-postgres cluster). If so,
 * run pg_dump on the old cluster → pipe SQL → exec into PGlite, then rename
 * the old dir to ~/.squadboard/data/postgres.legacy. This unblocks users with
 * existing squadboard data from the embedded-postgres era.
 */

import { PGlite } from '@electric-sql/pglite';
import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const PGLITE_DATA_DIR = join(homedir(), '.squadboard', 'data', 'pglite');

// Sentinel string returned when PGlite is the active driver.
// db/index.ts uses this to distinguish "boot PGlite" from "connect to real PG".
export const PGLITE_SENTINEL = 'pglite://local';

let _pglite: PGlite | null = null;
/** True only after startPglite() resolves without error. */
let _startedSuccessfully = false;

// ─── Pool-compatible adapter types ──────────────────────────────────────────

/** Subset of pg.QueryResult that our codebase actually uses. */
export interface QueryResult<R extends Record<string, unknown> = Record<string, unknown>> {
  rows: R[];
  /** Rows affected by the last UPDATE/INSERT/DELETE. Maps from PGlite affectedRows. */
  rowCount: number | null;
}

export interface ClientLike {
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<QueryResult<R>>;
  release(): void;
}

export interface PoolLike {
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<QueryResult<R>>;
  /** Acquire a client for manual transaction control (BEGIN/COMMIT/ROLLBACK). */
  connect(): Promise<ClientLike>;
  /** Graceful shutdown — closes the underlying PGlite instance. */
  end(): Promise<void>;
}

// ─── Adapter factory ─────────────────────────────────────────────────────────

/** Wrap a PGlite instance in the pool-like interface expected by our services. */
export function createPoolAdapter(pglite: PGlite): PoolLike {
  /**
   * Route SQL to the right PGlite protocol:
   * - With params  → pglite.query()  (prepared-statement / extended protocol)
   * - Without params → pglite.exec() (simple protocol; supports multi-statement DDL blocks)
   *
   * This is the critical difference from pg's Pool: PGlite's query() uses the
   * extended query protocol and rejects multi-statement SQL. exec() uses the
   * simple query protocol (same as pg's pool.query with a plain string).
   */
  const runQuery = async <R extends Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<QueryResult<R>> => {
    if (params !== undefined && params.length > 0) {
      const result = await pglite.query<R>(sql, params as unknown[]);
      return {
        rows: result.rows,
        rowCount: (result as unknown as { affectedRows?: number }).affectedRows ?? null,
      };
    } else {
      // exec() returns Results[] (one per statement); return the last for compat
      const results = await pglite.exec(sql);
      const last = results[results.length - 1];
      return {
        rows: ((last?.rows ?? []) as R[]),
        rowCount: (last as unknown as { affectedRows?: number } | undefined)?.affectedRows ?? null,
      };
    }
  };

  return {
    query: runQuery,
    connect: async (): Promise<ClientLike> => ({
      query: runQuery,
      // Single in-process connection — no real pooling, release is a no-op.
      release: () => {},
    }),
    end: async () => {
      await pglite.close();
    },
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Boot PGlite (or detect DATABASE_URL override).
 *
 * @returns PGLITE_SENTINEL when PGlite is active, or the DATABASE_URL value
 *          when an external Postgres is configured. db/index.ts branches on this.
 */
export async function startPglite(): Promise<string> {
  const startMs = Date.now();

  // DATABASE_URL overrides PGlite entirely (CI / cloud deployments).
  const envUrl = process.env['DATABASE_URL'];
  if (envUrl) {
    console.log('[pglite] DATABASE_URL set — using provided connection, PGlite not started');
    return envUrl;
  }

  console.log(`[pglite] booting WASM Postgres at ${PGLITE_DATA_DIR}`);

  mkdirSync(PGLITE_DATA_DIR, { recursive: true });
  try {
    _pglite = new PGlite(PGLITE_DATA_DIR);
    await _pglite.waitReady;
  } catch (err) {
    // Clear the reference so stopPglite() / getPglite() don't try to operate
    // on a half-aborted WASM instance and potentially corrupt the data dir.
    _pglite = null;
    _startedSuccessfully = false;

    const isWasmAbort =
      err instanceof Error &&
      (err.name === 'RuntimeError' || err.message.includes('Aborted'));

    if (!isWasmAbort) throw err;

    // Back up the corrupted data directory and retry once with a fresh one.
    const backupPath = `${PGLITE_DATA_DIR}.corrupted.${Date.now()}`;
    if (existsSync(PGLITE_DATA_DIR)) {
      renameSync(PGLITE_DATA_DIR, backupPath);
      console.warn(
        `[pglite] ⚠️  WASM boot failed — data directory backed up to ${backupPath} and reset. ` +
          `Server starting with empty database. To restore, copy files back from the backup.`,
      );
    }
    mkdirSync(PGLITE_DATA_DIR, { recursive: true });

    try {
      _pglite = new PGlite(PGLITE_DATA_DIR);
      await _pglite.waitReady;
      console.log('[pglite] ✅ Recovery successful — started with fresh database.');
    } catch (retryErr) {
      _pglite = null;
      _startedSuccessfully = false;
      console.error('[pglite] ❌ Recovery failed — could not start PGlite even with a fresh directory.');
      throw retryErr;
    }
  }

  _startedSuccessfully = true;
  const elapsed = Date.now() - startMs;
  console.log(`[pglite] ready in ${elapsed}ms`);

  return PGLITE_SENTINEL;
}

/**
 * Reopen the in-process PGlite engine against the same persistent data dir.
 *
 * This is intentionally narrower than full database initialisation: callers in
 * db/index.ts rebind Drizzle/pool handles after reopening. Use this for runtime
 * recovery from connection-local PGlite cache/catalog faults only.
 */
export async function restartPglite(): Promise<PGlite | null> {
  if (process.env['DATABASE_URL']) return null;

  if (_pglite) {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        _pglite.close(),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error('PGlite close timed out')), 3000);
        }),
      ]);
    } catch (err) {
      console.warn('[pglite] close during restart did not complete; reopening anyway:', err);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
    _pglite = null;
  }

  console.warn('[pglite] reopening WASM Postgres connection');
  mkdirSync(PGLITE_DATA_DIR, { recursive: true });
  _pglite = new PGlite(PGLITE_DATA_DIR);
  await _pglite.waitReady;
  _startedSuccessfully = true;
  return _pglite;
}

/**
 * @deprecated kept for backward compatibility with call sites that imported
 * startEmbeddedPostgres(). Delegates to startPglite().
 */
export const startEmbeddedPostgres = startPglite;

/** Returns the live PGlite instance, or null when DATABASE_URL is in use or startup failed. */
export function getPglite(): PGlite | null {
  return _startedSuccessfully ? _pglite : null;
}

/**
 * Connection string — only meaningful when DATABASE_URL is active.
 * Not used in PGlite mode (PGlite is accessed directly, not via TCP).
 */
export function getConnectionString(): string {
  const envUrl = process.env['DATABASE_URL'];
  if (envUrl) return envUrl;
  return PGLITE_SENTINEL;
}

/** Gracefully close PGlite on server shutdown. */
export async function stopPglite(): Promise<void> {
  if (_pglite) {
    await _pglite.close();
    _pglite = null;
    _startedSuccessfully = false;
    console.log('[pglite] closed');
  }
}

/**
 * @deprecated kept for backward compatibility. Delegates to stopPglite().
 */
export const stopEmbeddedPostgres = stopPglite;
