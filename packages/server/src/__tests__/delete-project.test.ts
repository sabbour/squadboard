/**
 * delete-project.test.ts — focused tests for DELETE /api/projects/:id (Danger Zone).
 *
 * Covers:
 *   1. Metadata-only delete (default) — returns JSON 200 summary, no folder touched.
 *   2. Project-not-found → 404.
 *   3. deleteFolder=true with a valid .squad path → folder deleted.
 *   4. Safety guards: empty path, root, home, cwd ancestor, missing folder,
 *      folder without .squad subdir.
 *   5. Settings cleanup before project row deletion.
 *
 * Uses the same route-handler-as-pure-function pattern as patch-project-fields.test.ts.
 * No real Postgres or filesystem I/O.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';

// ---------------------------------------------------------------------------
// FS mock — intercept fs.stat and fs.rm without touching disk.
// ---------------------------------------------------------------------------

type StatResult = { isDirectory: () => boolean } | null;

const statResponses: Record<string, StatResult> = {};
let rmCalled: string | null = null;
let rmError: Error | null = null;

vi.mock('node:fs/promises', () => ({
  default: {
    stat: vi.fn(async (p: string) => {
      const result = statResponses[p];
      if (!result) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return result;
    }),
    rm: vi.fn(async (p: string) => {
      rmCalled = p;
      if (rmError) throw rmError;
    }),
  },
}));

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { default: { ...actual, homedir: vi.fn(() => '/home/testuser') } };
});

// ---------------------------------------------------------------------------
// DB mock — mirrors patch-project-fields.test.ts pattern.
// ---------------------------------------------------------------------------

type ProjectRow = { id: string; path: string; name: string } | null;
let projectRow: ProjectRow = null;
let settingsDeleteWhere: unknown = null;
let projectDeleteWhere: unknown = null;
let selectError: Error | null = null;
let settingsDeleteError: Error | null = null;

// When set, the mock's withPgliteOidRetry will simulate the stale-OID path:
// the first call to fn() throws a stale-OID error, DEALLOCATE is recorded,
// and the retry (second call) uses the normal mock response.
let simulateOidRetry = false;
let oidRetryDeallocateCalled = false;
// Tracks whether the one-shot OID error for the recovery test has been thrown yet.
// Reset in beforeEach so each test starts clean.
let _selectOidErrorConsumed = false;

vi.mock('../db/index.js', () => {
  // settings delete chain
  const settingsWhereImpl = vi.fn(async (w: unknown) => {
    settingsDeleteWhere = w;
    if (settingsDeleteError) throw settingsDeleteError;
    return [];
  });

  // projects delete chain
  const projectsWhereImpl = vi.fn((w: unknown) => {
    projectDeleteWhere = w;
    projectRow = null;
    return Promise.resolve([]);
  });

  // projects select chain
  const selectWhereImpl = vi.fn(async () => {
    if (selectError) throw selectError;
    // simulateOidRetry: throw exactly once (one-shot, tracked by _selectOidErrorConsumed).
    // withPgliteOidRetry catches the OID error, marks oidRetryDeallocateCalled, and
    // retries; the second call finds _selectOidErrorConsumed=true and returns normally.
    if (simulateOidRetry && !_selectOidErrorConsumed) {
      _selectOidErrorConsumed = true;
      throw new Error('could not open relation with OID 66346');
    }
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
     * withPgliteOidRetry mock:
     *   - By default (simulateOidRetry=false): transparent — calls fn() once.
     *   - When simulateOidRetry=true: implements the same stale-OID retry logic
     *     as the real function so tests exercise the full recovery flow end-to-end
     *     without needing a real PGlite instance.
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
          oidRetryDeallocateCalled = true; // stands in for the real DEALLOCATE ALL
          return fn();
        }
        throw err;
      }
    }),
  };
});

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col, val) => ({ col, val })),
}));

// ---------------------------------------------------------------------------
// Minimal Express-like mock + handler capture — same as patch-project-fields.
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
  let sendCalled = false;

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
      sendCalled = true;
      return res;
    },
  };

  return {
    req,
    res,
    getStatus: () => statusCode,
    getBody: () => jsonBody as Record<string, unknown>,
    wasSendCalled: () => sendCalled,
  };
}

function makeStatDir(): StatResult {
  return { isDirectory: () => true };
}

beforeEach(() => {
  projectRow = null;
  settingsDeleteWhere = null;
  projectDeleteWhere = null;
  rmCalled = null;
  rmError = null;
  selectError = null;
  settingsDeleteError = null;
  simulateOidRetry = false;
  oidRetryDeallocateCalled = false;
  _selectOidErrorConsumed = false;

  // Clear stat responses.
  for (const k of Object.keys(statResponses)) delete statResponses[k];
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DELETE /api/projects/:id — Danger Zone', () => {
  // 1. Metadata-only delete (default, no body)
  it('deletes metadata only by default — returns JSON 200 with folder=false', async () => {
    projectRow = { id: 'proj-1', path: '/projects/myapp/.squad', name: 'My App' };

    const { req, res, getStatus, getBody } = makeReqRes({ id: 'proj-1' });
    await deleteHandler(req, res);

    expect(getStatus()).toBe(200);
    const body = getBody();
    expect(body?.ok).toBe(true);
    expect((body?.deleted as Record<string, unknown>)?.metadata).toBe(true);
    expect((body?.deleted as Record<string, unknown>)?.folder).toBe(false);
    expect(rmCalled).toBeNull();
  });

  // 2. Project not found
  it('returns 404 when the project does not exist', async () => {
    projectRow = null;

    const { req, res, getStatus, getBody } = makeReqRes({ id: 'missing' });
    await deleteHandler(req, res);

    expect(getStatus()).toBe(404);
    expect((getBody() as Record<string, unknown>)?.ok).toBe(false);
  });

  // 3. deleteFolder=true — happy path (.squad suffix → parent folder used)
  it('deleteFolder=true deletes the project folder and returns its path', async () => {
    projectRow = { id: 'proj-2', path: '/projects/webapp/.squad', name: 'Web App' };
    statResponses['/projects/webapp'] = makeStatDir();
    statResponses['/projects/webapp/.squad'] = makeStatDir();

    const { req, res, getStatus, getBody } = makeReqRes(
      { id: 'proj-2' },
      { deleteFolder: true },
    );
    await deleteHandler(req, res);

    expect(getStatus()).toBe(200);
    const body = getBody();
    expect(body?.ok).toBe(true);
    expect((body?.deleted as Record<string, unknown>)?.folder).toBe('/projects/webapp');
    expect(rmCalled).toBe('/projects/webapp');
  });

  // 4. deleteFolder=false explicitly — same as default, no rm
  it('deleteFolder=false is treated same as default — no folder delete', async () => {
    projectRow = { id: 'proj-3', path: '/projects/api/.squad', name: 'API' };

    const { req, res, getStatus, getBody } = makeReqRes(
      { id: 'proj-3' },
      { deleteFolder: false },
    );
    await deleteHandler(req, res);

    expect(getStatus()).toBe(200);
    expect((getBody()?.deleted as Record<string, unknown>)?.folder).toBe(false);
    expect(rmCalled).toBeNull();
  });

  // 5. Guard: empty path
  it('rejects deleteFolder=true when project path is empty', async () => {
    projectRow = { id: 'proj-4', path: '', name: 'Bad' };

    const { req, res, getStatus, getBody } = makeReqRes(
      { id: 'proj-4' },
      { deleteFolder: true },
    );
    await deleteHandler(req, res);

    expect(getStatus()).toBe(400);
    expect(String((getBody() as Record<string, unknown>)?.error)).toMatch(/no path/i);
    expect(rmCalled).toBeNull();
  });

  // 6. Guard: folder is home directory
  it('rejects deleteFolder=true when resolved folder is the home directory', async () => {
    const home = os.homedir(); // '/home/testuser' from mock
    projectRow = { id: 'proj-5', path: `${home}/.squad`, name: 'Home Project' };
    // parent of home/.squad is home itself
    statResponses[home] = makeStatDir();
    statResponses[`${home}/.squad`] = makeStatDir();

    const { req, res, getStatus, getBody } = makeReqRes(
      { id: 'proj-5' },
      { deleteFolder: true },
    );
    await deleteHandler(req, res);

    expect(getStatus()).toBe(400);
    expect(String((getBody() as Record<string, unknown>)?.error)).toMatch(/home/i);
    expect(rmCalled).toBeNull();
  });

  // 7. Guard: folder is the server's cwd (or an ancestor of it)
  it('rejects deleteFolder=true when resolved folder is the cwd', async () => {
    const cwd = process.cwd();
    projectRow = { id: 'proj-6', path: `${cwd}/.squad`, name: 'CWD Project' };
    statResponses[cwd] = makeStatDir();
    statResponses[`${cwd}/.squad`] = makeStatDir();

    const { req, res, getStatus, getBody } = makeReqRes(
      { id: 'proj-6' },
      { deleteFolder: true },
    );
    await deleteHandler(req, res);

    expect(getStatus()).toBe(400);
    expect(String((getBody() as Record<string, unknown>)?.error)).toMatch(/working directory/i);
    expect(rmCalled).toBeNull();
  });

  // 8. Guard: folder does not contain a .squad subdirectory
  it('rejects deleteFolder=true when the folder has no .squad subdirectory', async () => {
    projectRow = { id: 'proj-7', path: '/projects/plain', name: 'Plain Dir' };
    statResponses['/projects/plain'] = makeStatDir();
    // .squad stat will throw (not registered)

    const { req, res, getStatus, getBody } = makeReqRes(
      { id: 'proj-7' },
      { deleteFolder: true },
    );
    await deleteHandler(req, res);

    expect(getStatus()).toBe(400);
    expect(String((getBody() as Record<string, unknown>)?.error)).toMatch(/\.squad/i);
    expect(rmCalled).toBeNull();
  });

  // 9. Guard: folder does not exist on disk
  it('rejects deleteFolder=true when the folder does not exist on disk', async () => {
    projectRow = { id: 'proj-8', path: '/projects/ghost/.squad', name: 'Ghost' };
    // neither /projects/ghost nor /.squad registered → stat throws

    const { req, res, getStatus, getBody } = makeReqRes(
      { id: 'proj-8' },
      { deleteFolder: true },
    );
    await deleteHandler(req, res);

    expect(getStatus()).toBe(400);
    expect(String((getBody() as Record<string, unknown>)?.error)).toMatch(/does not exist/i);
    expect(rmCalled).toBeNull();
  });

  // 10. Guard: root directory
  it('rejects deleteFolder=true when path resolves to root', async () => {
    projectRow = { id: 'proj-9', path: '/.squad', name: 'Root Project' };
    // path.dirname('/.squad') === '/' — should be caught before stat

    const { req, res, getStatus, getBody } = makeReqRes(
      { id: 'proj-9' },
      { deleteFolder: true },
    );
    await deleteHandler(req, res);

    expect(getStatus()).toBe(400);
    expect(String((getBody() as Record<string, unknown>)?.error)).toMatch(/root/i);
    expect(rmCalled).toBeNull();
  });

  it('rejects deleteFolder=true when the configured project path is relative', async () => {
    projectRow = { id: 'proj-relative', path: '../outside/.squad', name: 'Relative' };

    const { req, res, getStatus, getBody } = makeReqRes(
      { id: 'proj-relative' },
      { deleteFolder: true },
    );
    await deleteHandler(req, res);

    expect(getStatus()).toBe(400);
    expect(String((getBody() as Record<string, unknown>)?.error)).toMatch(/absolute/i);
    expect(settingsDeleteWhere).toBeNull();
    expect(projectDeleteWhere).toBeNull();
    expect(rmCalled).toBeNull();
  });

  it('reports folder delete errors after metadata deletion without returning a false failure', async () => {
    projectRow = { id: 'proj-rm-error', path: '/projects/locked/.squad', name: 'Locked' };
    statResponses['/projects/locked'] = makeStatDir();
    statResponses['/projects/locked/.squad'] = makeStatDir();
    rmError = new Error('EACCES: permission denied');

    const { req, res, getStatus, getBody } = makeReqRes(
      { id: 'proj-rm-error' },
      { deleteFolder: true },
    );
    await deleteHandler(req, res);

    expect(getStatus()).toBe(200);
    expect(getBody()?.ok).toBe(true);
    expect((getBody()?.deleted as Record<string, unknown>)?.metadata).toBe(true);
    expect((getBody()?.deleted as Record<string, unknown>)?.folder).toBe(false);
    expect(String((getBody()?.deleted as Record<string, unknown>)?.folderError)).toMatch(/permission denied/i);
    expect(settingsDeleteWhere).not.toBeNull();
    expect(projectDeleteWhere).not.toBeNull();
    expect(rmCalled).toBe('/projects/locked');
  });

  // 11. Settings cleanup before project deletion
  it('deletes project-scoped settings before the project row', async () => {
    projectRow = { id: 'proj-10', path: '/projects/clean/.squad', name: 'Clean' };

    const { req, res, getStatus } = makeReqRes({ id: 'proj-10' });
    await deleteHandler(req, res);

    expect(getStatus()).toBe(200);
    // settingsDeleteWhere is set → settings.delete().where() was called
    expect(settingsDeleteWhere).not.toBeNull();
    // projectDeleteWhere is set → projects.delete().where() was called
    expect(projectDeleteWhere).not.toBeNull();
  });

  // 12. DB select throws (e.g. PGlite stale OID) → JSON 500, not HTML
  it('returns JSON 500 when the DB select throws (e.g. stale PGlite OID) and retry also fails', async () => {
    // Both the first attempt AND the retry throw — no recovery possible.
    selectError = new Error('could not open relation with OID 66346');

    const { req, res, getStatus, getBody } = makeReqRes({ id: 'any-id' });
    await deleteHandler(req, res);

    expect(getStatus()).toBe(500);
    const body = getBody() as Record<string, unknown>;
    expect(body?.ok).toBe(false);
    expect(String(body?.error)).toMatch(/database error/i);
    expect(String(body?.error)).toMatch(/66346/);
    // No filesystem mutation must occur.
    expect(rmCalled).toBeNull();
    expect(settingsDeleteWhere).toBeNull();
    expect(projectDeleteWhere).toBeNull();
  });

  // 13. DB delete(settings) throws stale-OID mid-deletion → trigger-bypass fallback succeeds.
  it('falls back to metadata-only trigger bypass when settings delete hits stale PGlite catalog state', async () => {
    projectRow = { id: 'proj-db-err', path: '/projects/dberr/.squad', name: 'DBErr' };
    settingsDeleteError = new Error('could not open relation with OID 99999');

    const { req, res, getStatus, getBody } = makeReqRes({ id: 'proj-db-err' });
    await deleteHandler(req, res);

    expect(getStatus()).toBe(200);
    const body = getBody() as Record<string, unknown>;
    expect(body?.ok).toBe(true);
    expect((body?.deleted as Record<string, unknown>)?.metadata).toBe(true);
    expect((body?.deleted as Record<string, unknown>)?.folder).toBe(false);
    expect(rmCalled).toBeNull();
  });

  // 14. RECOVERY: stale-OID on select → withPgliteOidRetry clears cache → retry succeeds → project deleted
  it('recovers from stale-OID error on lookup — retries once and deletes project metadata', async () => {
    projectRow = { id: 'proj-oid-recover', path: '/projects/oid-recover/.squad', name: 'OID Recover' };
    // First call to db.select() throws "could not open relation with OID 66346".
    // The withPgliteOidRetry mock simulates the DEALLOCATE ALL + retry, and the
    // second call succeeds because simulateOidRetry resets the internal counter.
    simulateOidRetry = true;

    const { req, res, getStatus, getBody } = makeReqRes({ id: 'proj-oid-recover' });
    await deleteHandler(req, res);

    expect(getStatus()).toBe(200);
    const body = getBody() as Record<string, unknown>;
    expect(body?.ok).toBe(true);
    expect((body?.deleted as Record<string, unknown>)?.metadata).toBe(true);
    // Recovery path was exercised (DEALLOCATE ALL equivalent was called).
    expect(oidRetryDeallocateCalled).toBe(true);
    // Both settings and project rows were deleted.
    expect(settingsDeleteWhere).not.toBeNull();
    expect(projectDeleteWhere).not.toBeNull();
    expect(rmCalled).toBeNull();
  });
});
