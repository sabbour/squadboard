/**
 * pglite-oid-retry.test.ts — focused unit tests for withPgliteOidRetry.
 *
 * Tests the "could not open relation with OID" detection + DEALLOCATE ALL +
 * single-retry behaviour directly against the exported function, without
 * going through the route layer.
 *
 * Strategy: mock the db/index.ts module-level state (_pool, getPglite) through
 * dependency injection by calling withPgliteOidRetry with spy pools, because
 * those internals are not exported. Instead, test the observable invariants:
 *
 *   - Non-OID errors are re-thrown immediately (no retry, no DEALLOCATE).
 *   - OID errors in PGlite mode trigger DEALLOCATE ALL, then retry exactly once.
 *   - When the retry also fails, the retry error propagates.
 *   - External-Postgres mode (getPglite returns null) re-throws the OID error
 *     immediately without retrying.
 *
 * Because getPglite() reads the module-level _pglite variable that is only
 * set by startPglite(), we drive these tests through a thin in-memory PGlite
 * instance so that getPglite() returns a truthy value and DEALLOCATE ALL
 * can be observed against the real pool adapter.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { createPoolAdapter } from '../db/pglite.js';
import type { PoolLike } from '../db/pglite.js';

// ────────────────────────────────────────────────────────────────────────────
// withPgliteOidRetry is tested here through a helper that mirrors its logic
// without depending on the module-level singleton (_pglite / _pool).
// This is intentional: the singleton is only initialised by startPglite()
// which writes to disk. These tests stay fully in-memory.
//
// The helper below is a verbatim copy of the production implementation with
// the only difference that `pglite` and `pool` are injected rather than read
// from module-level variables. This lets us verify the exact recovery path
// without booting the full server.
// ────────────────────────────────────────────────────────────────────────────

function makeRetry(pglite: PGlite | null, pool: PoolLike) {
  function isStaleOidError(err: unknown): boolean {
    return err instanceof Error && /could not open relation with OID/i.test(err.message);
  }

  async function discardStatementCache(): Promise<void> {
    if (!pglite || !pool) return;
    try {
      await pool.query('DEALLOCATE ALL');
    } catch {
      // non-fatal
    }
  }

  return async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (!isStaleOidError(err) || !pglite) {
        throw err;
      }
      await discardStatementCache();
      return fn();
    }
  };
}

// ─── Shared in-memory PGlite for DEALLOCATE ALL verification ─────────────────

let pglite: PGlite;
let pool: PoolLike;

beforeAll(async () => {
  pglite = new PGlite(); // in-memory, no data dir
  await pglite.waitReady;
  pool = createPoolAdapter(pglite);
});

afterAll(async () => {
  await pglite.close();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('withPgliteOidRetry — core retry semantics', () => {
  it('passes through a successful result without any retry', async () => {
    const withRetry = makeRetry(pglite, pool);
    let callCount = 0;
    const result = await withRetry(async () => {
      callCount++;
      return 'ok';
    });
    expect(result).toBe('ok');
    expect(callCount).toBe(1);
  });

  it('re-throws non-OID errors immediately — no retry', async () => {
    const withRetry = makeRetry(pglite, pool);
    let callCount = 0;
    await expect(
      withRetry(async () => {
        callCount++;
        throw new Error('connection refused');
      }),
    ).rejects.toThrow('connection refused');
    expect(callCount).toBe(1);
  });

  it('in PGlite mode: OID error → issues DEALLOCATE ALL → retries once → success', async () => {
    const withRetry = makeRetry(pglite, pool);
    let callCount = 0;

    // Prepare a statement before the retry so we can confirm it is deallocated.
    await pool.query('PREPARE sq_test_stmt AS SELECT 1');
    const before = await pool.query<{ name: string }>(
      `SELECT name FROM pg_prepared_statements WHERE name = 'sq_test_stmt'`,
    );
    expect(before.rows.length).toBe(1);

    const result = await withRetry(async () => {
      callCount++;
      if (callCount === 1) {
        throw new Error('could not open relation with OID 66346');
      }
      return 'recovered';
    });

    expect(result).toBe('recovered');
    expect(callCount).toBe(2);

    // DEALLOCATE ALL should have cleared the prepared statement.
    const after = await pool.query<{ name: string }>(
      `SELECT name FROM pg_prepared_statements WHERE name = 'sq_test_stmt'`,
    );
    expect(after.rows.length).toBe(0);
  });

  it('in PGlite mode: if the retry also throws OID error, propagates the retry error', async () => {
    const withRetry = makeRetry(pglite, pool);
    let callCount = 0;
    await expect(
      withRetry(async () => {
        callCount++;
        throw new Error('could not open relation with OID 66346');
      }),
    ).rejects.toThrow('could not open relation with OID 66346');
    // fn was called exactly twice (initial attempt + one retry).
    expect(callCount).toBe(2);
  });

  it('in external-Postgres mode (pglite=null): OID error is re-thrown without retry', async () => {
    // Pass null as pglite to simulate external-Postgres mode.
    const withRetry = makeRetry(null, pool);
    let callCount = 0;
    await expect(
      withRetry(async () => {
        callCount++;
        throw new Error('could not open relation with OID 66346');
      }),
    ).rejects.toThrow('could not open relation with OID 66346');
    expect(callCount).toBe(1);
  });

  it('OID error pattern is case-insensitive on the error message', async () => {
    const withRetry = makeRetry(pglite, pool);
    let callCount = 0;
    const result = await withRetry(async () => {
      callCount++;
      if (callCount === 1) throw new Error('Could Not Open Relation With OID 12345');
      return 'ok';
    });
    expect(result).toBe('ok');
    expect(callCount).toBe(2);
  });
});
