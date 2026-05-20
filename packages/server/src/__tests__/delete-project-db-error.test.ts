/**
 * delete-project-db-error.test.ts
 *
 * Regression coverage for the DELETE /api/projects/:id stale-OID recovery path.
 *
 * What this file covers (not duplicated in delete-project.test.ts):
 *
 *   A. MUTATION recovery — the real-world bug path:
 *      db.delete(settings OR projects) throws stale-OID on attempt 1
 *      → withPgliteOidRetry issues DEALLOCATE ALL and retries
 *      → retry succeeds → handler responds 200 { ok: true }
 *
 *      Hockney's test 14 covers SELECT path recovery only. This file adds
 *      mutation-path recovery. The screenshot showing OID 66346 came from
 *      the mutation phase, not the lookup — so this is the primary
 *      regression contract.
 *
 *   B. projects.delete exhaustion — both mutation attempts fail:
 *      withPgliteOidRetry retries once; if the retry also throws, the
 *      handler catches and returns 500 JSON.  Hockney's test 13 exercises
 *      the settings.delete leg; this file exercises the projects.delete leg
 *      (the second statement inside the wrapped callback).
 *
 *   C. projects.delete non-OID error — bypassed by retry wrapper:
 *      A non-OID error (e.g. FK violation) from projects.delete must
 *      propagate immediately without retry → 500 JSON, error string preserved.
 *
 * The withPgliteOidRetry mock here uses the SAME contract as Hockney's:
 *   - simulateOidRetry=false (default): transparent, calls fn() once.
 *   - simulateOidRetry=true: intercepts the first OID error, records
 *     oidRetryDeallocateCalled=true (stand-in for DEALLOCATE ALL), retries.
 *
 * Safety: no real filesystem I/O, no real Postgres, no real PGlite.
 * All filesystem and OS calls are mocked identically to delete-project.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Shared mutable state (per-test, reset in beforeEach)
// ---------------------------------------------------------------------------

let projectRow: { id: string; path: string; name: string } | null = null;
let settingsDeleteWhere: unknown = null;
let projectDeleteWhere: unknown = null;
let rmCalled: string | null = null;

// Persistent OID-retry control flags
let simulateOidRetry = false;        // arm the mock retry path
let oidRetryDeallocateCalled = false; // records that DEALLOCATE ALL equivalent ran

// One-shot flag: tracks whether the mutation fn has thrown once already.
// The mutation callback wraps BOTH db.delete(settings) + db.delete(projects),
// so withPgliteOidRetry retries the entire callback; on second call these flags
// are already consumed.
let _mutationOidConsumed = false;

// Per-table persistent error (non-OID, always-throw)
let projectDeleteError: Error | null = null;

// ---------------------------------------------------------------------------
// DB mock — mirrors delete-project.test.ts, extended with mutation OID path.
// ---------------------------------------------------------------------------

vi.mock('../db/index.js', () => {
  const settingsWhereImpl = vi.fn(async (w: unknown) => {
    settingsDeleteWhere = w;
    // Mutation OID retry path: throw exactly once per test when armed.
    if (simulateOidRetry && !_mutationOidConsumed) {
      _mutationOidConsumed = true;
      throw new Error('could not open relation with OID 66346');
    }
    return [];
  });

  const projectsWhereImpl = vi.fn(async (w: unknown) => {
    projectDeleteWhere = w;
    if (projectDeleteError) throw projectDeleteError;
    projectRow = null;
    return [];
  });

  const selectWhereImpl = vi.fn(async () => {
    return projectRow ? [projectRow] : [];
  });
  const selectFromImpl = vi.fn(() => ({
    where: selectWhereImpl,
    then: (resolve: (value: unknown) => unknown, reject: (reason?: unknown) => unknown) =>
      Promise.resolve(projectRow ? [projectRow] : []).then(resolve, reject),
  }));
  const selectImpl = vi.fn(() => ({ from: selectFromImpl }));

  const mockDb = {
    select: selectImpl,
    delete: vi.fn((table: unknown) => {
      const t = table as { _isSettings?: boolean };
      if (t._isSettings) return { where: settingsWhereImpl };
      return { where: projectsWhereImpl };
    }),
  };

  return {
    getDb: vi.fn(() => mockDb),
    getPool: vi.fn(() => ({
      query: vi.fn(async () => ({ rows: [], rowCount: 1 })),
    })),
    isPgliteCatalogCorruptionError: vi.fn(
      (err: unknown) => err instanceof Error && /could not open relation with OID/i.test(err.message),
    ),
    schema: {
      projects: { id: 'id', _isSettings: false },
      settings: { projectId: 'projectId', _isSettings: true },
    },

    /**
     * withPgliteOidRetry mock contract (identical to delete-project.test.ts):
     *   - simulateOidRetry=false → transparent: calls fn() once.
     *   - simulateOidRetry=true  → intercepts first OID error, marks
     *     oidRetryDeallocateCalled, then retries fn() once. Non-OID errors
     *     are always re-thrown without retry.
     */
    withPgliteOidRetry: vi.fn(async (fn: () => Promise<unknown>) => {
      try {
        return await fn();
      } catch (err) {
        if (
          simulateOidRetry &&
          err instanceof Error &&
          /could not open relation with OID/i.test(err.message)
        ) {
          oidRetryDeallocateCalled = true;
          return fn(); // retry once — second call must succeed or propagate
        }
        throw err; // non-OID or retry-not-armed: re-throw immediately
      }
    }),
  };
});

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col, val) => ({ col, val })),
}));

vi.mock('node:fs/promises', () => ({
  default: {
    stat: vi.fn(async () => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    }),
    rm: vi.fn(async (p: string) => {
      rmCalled = p;
    }),
  },
}));

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { default: { ...actual, homedir: vi.fn(() => '/home/testuser') } };
});

// ---------------------------------------------------------------------------
// Express mock + handler capture
// ---------------------------------------------------------------------------

const handlers: Record<string, Record<string, Function>> = {};

vi.mock('express', async () => {
  const router = {
    get: vi.fn((p: string, ...fns: Function[]) => {
      (handlers['GET'] ??= {})[p] = fns[fns.length - 1]!;
    }),
    post: vi.fn((p: string, ...fns: Function[]) => {
      (handlers['POST'] ??= {})[p] = fns[fns.length - 1]!;
    }),
    patch: vi.fn((p: string, ...fns: Function[]) => {
      (handlers['PATCH'] ??= {})[p] = fns[fns.length - 1]!;
    }),
    delete: vi.fn((p: string, ...fns: Function[]) => {
      (handlers['DELETE'] ??= {})[p] = fns[fns.length - 1]!;
    }),
  };
  return { Router: () => router };
});

vi.mock('../services/project-init.js', () => ({ createProject: vi.fn() }));
vi.mock('../services/setup-lifecycle.js', () => ({ suggestProjectSetup: vi.fn() }));

await import('../routes/projects.js');

const deleteHandler = handlers['DELETE']?.['/:id'];
if (!deleteHandler) throw new Error('DELETE /:id handler not found');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReqRes(params: Record<string, string>, body: Record<string, unknown> = {}) {
  const req = { params, body };
  let statusCode = 200;
  let jsonBody: unknown;

  const res = {
    status(code: number) {
      statusCode = code;
      return res;
    },
    json(data: unknown) {
      jsonBody = data;
      return res;
    },
    send() {
      return res;
    },
  };

  return {
    req,
    res,
    getStatus: () => statusCode,
    getBody: () => jsonBody as Record<string, unknown>,
  };
}

beforeEach(() => {
  projectRow = null;
  settingsDeleteWhere = null;
  projectDeleteWhere = null;
  rmCalled = null;
  simulateOidRetry = false;
  oidRetryDeallocateCalled = false;
  _mutationOidConsumed = false;
  projectDeleteError = null;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DELETE /api/projects/:id — stale-OID recovery + mutation exhaustion', () => {

  /**
   * Contract A (primary missing coverage): the screenshot bug path.
   *
   * What does the system do when db.delete(settings) throws a stale-OID error
   * on the first attempt?
   *
   * Expected: withPgliteOidRetry issues DEALLOCATE ALL (oidRetryDeallocateCalled=true),
   * retries the entire mutation callback, retry succeeds, handler returns 200.
   *
   * This is the real-world scenario: user deletes a project after a migration has
   * recycled a relation OID. Without the retry wrapper, the first (and only) attempt
   * throws, Express's default handler returns 500 text/html, and the modal shows raw HTML.
   */
  it('mutation OID error on first attempt → DEALLOCATE → retry → 200 OK with metadata deleted', async () => {
    projectRow = { id: 'proj-mutation-oid', path: '/projects/oid/.squad', name: 'OID Project' };
    simulateOidRetry = true;

    const { req, res, getStatus, getBody } = makeReqRes({ id: 'proj-mutation-oid' });
    await deleteHandler(req, res);

    // Must succeed — not fail with 500
    expect(getStatus()).toBe(200);
    const body = getBody();
    expect(body?.ok).toBe(true);
    expect((body?.deleted as Record<string, unknown>)?.metadata).toBe(true);

    // withPgliteOidRetry MUST have issued DEALLOCATE ALL before retrying.
    // If this fails the handler is not using the retry wrapper for the mutation.
    expect(oidRetryDeallocateCalled).toBe(true);

    // Both settings and project rows were deleted on the retry.
    expect(settingsDeleteWhere).not.toBeNull();
    expect(projectDeleteWhere).not.toBeNull();

    // No filesystem mutation.
    expect(rmCalled).toBeNull();
  });

  /**
   * Same recovery scenario but with deleteFolder=false explicitly stated —
   * confirms the folder guard does not run before the mutation in this path.
   */
  it('mutation OID recovery does not attempt filesystem operations', async () => {
    projectRow = { id: 'proj-oid-nofs', path: '/projects/nofs/.squad', name: 'NoFS' };
    simulateOidRetry = true;

    const { req, res, getStatus, getBody } = makeReqRes(
      { id: 'proj-oid-nofs' },
      { deleteFolder: false },
    );
    await deleteHandler(req, res);

    expect(getStatus()).toBe(200);
    expect(getBody()?.ok).toBe(true);
    expect(oidRetryDeallocateCalled).toBe(true);
    expect(rmCalled).toBeNull(); // critically: no real folder deletion
  });

  /**
   * Contract B: projects.delete stale-catalog exhaustion.
   *
   * When db.delete(projects) throws stale PGlite catalog errors, the handler
   * falls back to a metadata-only trigger-bypass delete.
   *
   * Hockney's test 13 covers settings.delete exhaustion; this test covers
   * the projects.delete leg (the second statement in the mutation callback).
   *
   * We configure: settings.delete succeeds, projects.delete always throws.
   * With simulateOidRetry=false the retry wrapper is transparent — the error
   * propagates immediately.
   */
  it('projects.delete stale-catalog failure → metadata-only trigger-bypass fallback', async () => {
    projectRow = { id: 'proj-projdel-fail', path: '/projects/fail/.squad', name: 'Fail' };
    projectDeleteError = new Error('could not open relation with OID 77777');
    // simulateOidRetry=false → withPgliteOidRetry is transparent → re-throws on first error

    const { req, res, getStatus, getBody } = makeReqRes({ id: 'proj-projdel-fail' });
    await deleteHandler(req, res);

    expect(getStatus()).toBe(200);
    const body = getBody();
    expect(body?.ok).toBe(true);
    expect((body?.deleted as Record<string, unknown>)?.metadata).toBe(true);
    expect((body?.deleted as Record<string, unknown>)?.folder).toBe(false);
  });

  /**
   * Contract C: non-OID error on projects.delete is NOT retried.
   *
   * The retry wrapper must only retry stale-OID errors (pattern
   * /could not open relation with OID/i). A generic FK violation,
   * unique constraint, or permission error must propagate immediately
   * without a retry attempt.
   *
   * Setup: pre-consume the one-shot OID flag so settings.delete succeeds
   * on the first call. projects.delete then throws a FK error. The wrapper
   * must NOT call DEALLOCATE ALL (oidRetryDeallocateCalled must stay false).
   */
  it('non-OID error on projects.delete is NOT retried — propagates to 500 immediately', async () => {
    projectRow = { id: 'proj-fk-err', path: '/projects/fk/.squad', name: 'FK Error' };
    projectDeleteError = new Error('violates foreign key constraint "fk_something"');
    simulateOidRetry = true;
    // Pre-consume the one-shot OID slot so settings.delete does NOT throw.
    // The mutation callback's first (and only) exception is now the FK error.
    _mutationOidConsumed = true;

    const { req, res, getStatus, getBody } = makeReqRes({ id: 'proj-fk-err' });
    await deleteHandler(req, res);

    // Must fail with 500 — non-OID errors are not retried
    expect(getStatus()).toBe(500);
    expect(getBody()?.ok).toBe(false);

    // DEALLOCATE ALL must NOT have run (FK error does not trigger retry)
    expect(oidRetryDeallocateCalled).toBe(false);

    // Error string must reference the FK constraint, not an OID
    expect(String(getBody()?.error)).toMatch(/foreign key/i);
  });
});

// ---------------------------------------------------------------------------
// withPgliteOidRetry contract — behaviour of the wrapper itself
// ---------------------------------------------------------------------------

describe('withPgliteOidRetry mock contract (self-validation)', () => {
  /**
   * Verify the mock behaves as documented: transparent when simulateOidRetry=false.
   * If this fails, ALL other tests in this file that rely on the mock are invalid.
   */
  it('transparent by default — fn() called once, result returned directly', async () => {
    projectRow = { id: 'proj-transparent', path: '/projects/ok/.squad', name: 'OK' };
    // simulateOidRetry=false (default) → mock is pass-through

    const { req, res, getStatus, getBody } = makeReqRes({ id: 'proj-transparent' });
    await deleteHandler(req, res);

    expect(getStatus()).toBe(200);
    expect(getBody()?.ok).toBe(true);
    expect(oidRetryDeallocateCalled).toBe(false); // no retry path exercised
  });

  /**
   * Verify one-shot: the mutation OID error fires exactly once per test.
   * On the second handler call within the same test, no OID error is thrown.
   * (This documents the mock's _mutationOidConsumed flag behaviour.)
   */
  it('one-shot OID error — second invocation within same test succeeds without retry', async () => {
    projectRow = { id: 'proj-oneshot', path: '/projects/oneshot/.squad', name: 'OneShot' };
    simulateOidRetry = true;

    // First call: OID error on mutation → retry → 200
    const { req: req1, res: res1, getStatus: s1 } = makeReqRes({ id: 'proj-oneshot' });
    await deleteHandler(req1, res1);
    expect(s1()).toBe(200);
    expect(oidRetryDeallocateCalled).toBe(true);

    // Reset project row so the handler can find it again
    projectRow = { id: 'proj-oneshot', path: '/projects/oneshot/.squad', name: 'OneShot' };
    // Reset deletion tracking but keep _mutationOidConsumed=true — the error is spent
    settingsDeleteWhere = null;
    projectDeleteWhere = null;

    // Second call: _mutationOidConsumed=true → no OID error → transparent 200
    // (oidRetryDeallocateCalled stays true from first call)
    const { req: req2, res: res2, getStatus: s2 } = makeReqRes({ id: 'proj-oneshot' });
    await deleteHandler(req2, res2);
    expect(s2()).toBe(200);
  });
});
