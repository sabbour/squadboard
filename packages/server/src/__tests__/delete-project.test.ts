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

vi.mock('../db/index.js', () => {
  // settings delete chain
  const settingsWhereImpl = vi.fn((w: unknown) => {
    settingsDeleteWhere = w;
    return Promise.resolve([]);
  });
  const settingsDeleteImpl = vi.fn(() => ({ where: settingsWhereImpl }));

  // projects delete chain (no .returning() needed anymore)
  const projectsWhereImpl = vi.fn((w: unknown) => {
    projectDeleteWhere = w;
    return Promise.resolve([]);
  });
  const projectsDeleteImpl = vi.fn(() => ({ where: projectsWhereImpl }));

  // projects select chain
  const selectWhereImpl = vi.fn(() => {
    return Promise.resolve(projectRow ? [projectRow] : []);
  });
  const selectFromImpl = vi.fn(() => ({ where: selectWhereImpl }));
  const selectImpl = vi.fn(() => ({ from: selectFromImpl }));

  const mockDb = {
    select: selectImpl,
    delete: vi.fn((table: unknown) => {
      // Route by table reference identity (schema.settings vs schema.projects).
      // We distinguish by the table object passed.
      const t = table as { _isSettings?: boolean };
      if (t._isSettings) return { where: settingsWhereImpl };
      return { where: projectsWhereImpl };
    }),
  };

  return {
    getDb: vi.fn(() => mockDb),
    schema: {
      projects: { id: 'id', _isSettings: false },
      settings: { projectId: 'projectId', _isSettings: true },
    },
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
});
