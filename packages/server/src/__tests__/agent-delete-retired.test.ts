/**
 * agent-delete-retired.test.ts
 *
 * Focused regression tests for the retired-agent lifecycle
 * ("delete retired agents" feature, Wave 10 Danger Zone extension):
 *
 *   DELETE ?permanent=true
 *   ─────────────────────
 *   1. Succeeds (200) for a retired project (squad) agent — DB row removed.
 *   2. Rejects an active agent with 400 ("Only retired agents can…").
 *   3. Rejects a disabled agent with 400 (same guard).
 *   4. Rejects a virtual/read-only Copilot agent with 403.
 *   5. Returns 404 when the agent does not exist.
 *   6. Falls back to soft-disable (no delete) when permanent param is absent.
 *
 *   POST / (create / re-cast with same name)
 *   ─────────────────────────────────────────
 *   7. Reactivates a retired project agent (HTTP 200) — no 409, no new insert.
 *   8. Returns 409 when the existing same-name agent is active.
 *   9. Returns 409 when the existing same-name agent is disabled.
 *  10. Does NOT reactivate a retired Copilot agent — returns 409.
 *
 * Pattern: route-handler-as-pure-function (same style as
 * patch-project-fields.test.ts and delete-project.test.ts).
 * No HTTP server, no real DB, no real filesystem.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Shared vi.fn() stubs — must be declared with vi.hoisted() so they are
// available inside vi.mock() factory closures after hoisting.
// ---------------------------------------------------------------------------

const {
  mockSelectFn,
  mockDeleteFn,
  mockUpdateFn,
  mockInsertFn,
  mockFsAccess,
  mockFsReadFile,
  mockFsMkdir,
  mockFsWriteFile,
  mockWriteCharter,
  mockComputeCharterHash,
} = vi.hoisted(() => ({
  mockSelectFn: vi.fn(),
  mockDeleteFn: vi.fn(),
  mockUpdateFn: vi.fn(),
  mockInsertFn: vi.fn(),
  mockFsAccess: vi.fn(),
  mockFsReadFile: vi.fn(),
  mockFsMkdir: vi.fn(),
  mockFsWriteFile: vi.fn(),
  mockWriteCharter: vi.fn(),
  mockComputeCharterHash: vi.fn(),
}));

// ---------------------------------------------------------------------------
// DB mock
// ---------------------------------------------------------------------------

vi.mock('../db/index.js', () => ({
  getDb: () => ({
    select: mockSelectFn,
    delete: mockDeleteFn,
    update: mockUpdateFn,
    insert: mockInsertFn,
  }),
  schema: {
    agents: {
      id: 'agents.id',
      projectId: 'agents.project_id',
      name: 'agents.name',
      status: 'agents.status',
      agentKind: 'agents.agent_kind',
      role: 'agents.role',
      model: 'agents.model',
      charterPath: 'agents.charter_path',
      historyPath: 'agents.history_path',
      charterHash: 'agents.charter_hash',
      charterContent: 'agents.charter_content',
    },
    projects: {
      id: 'projects.id',
      path: 'projects.path',
    },
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: (a: unknown, b: unknown) => ({ __eq: [a, b] }),
  and: (...args: unknown[]) => ({ __and: args }),
}));

// ---------------------------------------------------------------------------
// File system mock
// ---------------------------------------------------------------------------

vi.mock('node:fs/promises', () => ({
  default: {
    access: (...args: unknown[]) => mockFsAccess(...args),
    readFile: (...args: unknown[]) => mockFsReadFile(...args),
    mkdir: (...args: unknown[]) => mockFsMkdir(...args),
    writeFile: (...args: unknown[]) => mockFsWriteFile(...args),
  },
}));

// ---------------------------------------------------------------------------
// Service mocks — only charter helpers matter for the POST reactivation path;
// the rest are stubs to satisfy static imports.
// ---------------------------------------------------------------------------

vi.mock('../services/charter-compiler.js', () => ({
  parseCharter: vi.fn().mockResolvedValue({ role: 'Architect', model: null }),
  writeCharter: (...args: unknown[]) => mockWriteCharter(...args),
  computeCharterHash: (...args: unknown[]) => mockComputeCharterHash(...args),
}));

vi.mock('../services/agent-sync.js', () => ({
  syncAgentsFromDisk: vi.fn().mockResolvedValue({ added: 0, updated: 0, removed: 0 }),
}));

vi.mock('../services/hire-formulator.js', () => ({
  formulateAgentDraft: vi.fn(),
  formulateTeamDraft: vi.fn(),
}));

vi.mock('../services/casting-engine.js', () => ({
  castTeam: vi.fn().mockReturnValue([]),
  buildPersonaSection: vi.fn().mockReturnValue(''),
}));

vi.mock('../services/curated-roles.js', () => ({
  generateCharter: vi.fn().mockReturnValue('# mock-charter\n'),
}));

// ---------------------------------------------------------------------------
// Express Router stub — captures handlers by method + path
// ---------------------------------------------------------------------------

const handlers: Record<string, Record<string, Function>> = {};

vi.mock('express', () => {
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
  return { Router: vi.fn(() => router) };
});

// Importing the route module registers all handlers via the mocked Router (side-effect).
await import('../routes/agents.js');

const deleteHandler = handlers['DELETE']?.['/:id'];
const postHandler = handlers['POST']?.['/'];
const hireTeamConfirmHandler = handlers['POST']?.['/hire-team/confirm'];

if (!deleteHandler) throw new Error('DELETE /:id handler not registered — check agents route');
if (!postHandler) throw new Error('POST / handler not registered — check agents route');
if (!hireTeamConfirmHandler) throw new Error('POST /hire-team/confirm handler not registered — check agents route');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Minimal Express req/res pair. `query` carries URL query-string values
 * (e.g. `{ permanent: 'true' }`).
 */
function makeReqRes(
  params: Record<string, string>,
  body: Record<string, unknown> = {},
  query: Record<string, string> = {},
) {
  const req = { params, body, query };
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
  };

  return {
    req,
    res,
    getStatus: () => statusCode,
    getBody: () => jsonBody as Record<string, unknown>,
  };
}

function makeSelectChain(rows: unknown[]) {
  const p = Promise.resolve(rows);
  const chain: Record<string, unknown> = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    limit: vi.fn().mockResolvedValue(rows),
    then: p.then.bind(p),
    catch: p.catch.bind(p),
    finally: p.finally.bind(p),
  };
  return chain;
}

/** Queue a series of select return values (one per select() call in order). */
function queueSelects(...rowArrays: unknown[][]) {
  const queue = [...rowArrays];
  mockSelectFn.mockImplementation(() => makeSelectChain(queue.shift() ?? []));
}

function makeAgent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'agent-001',
    projectId: 'project-001',
    name: 'cosmo-kramer',
    role: 'Architect',
    model: null,
    status: 'active' as 'active' | 'disabled' | 'retired',
    agentKind: 'squad' as 'squad' | 'copilot',
    charterPath: '/workspace/.squad/agents/cosmo-kramer/charter.md',
    historyPath: '/workspace/.squad/agents/cosmo-kramer/history.md',
    charterHash: 'abc123',
    charterContent: '',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const PROJECT_ROW = { id: 'project-001', path: '/workspace/.squad' };

// ---------------------------------------------------------------------------
// beforeEach — reset stubs and install sensible defaults
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();

  // Default delete chain
  mockDeleteFn.mockReturnValue({
    where: vi.fn().mockResolvedValue([]),
  });

  // Default update chain (soft-disable path)
  mockUpdateFn.mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([makeAgent({ status: 'disabled' })]),
      }),
    }),
  });

  // Default insert chain
  mockInsertFn.mockReturnValue({
    values: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([makeAgent()]),
    }),
  });

  // Default fs stubs: folder does not exist (safe default for POST path)
  mockFsAccess.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
  mockFsMkdir.mockResolvedValue(undefined);
  mockFsWriteFile.mockResolvedValue(undefined);
  mockFsReadFile.mockResolvedValue('# cosmo-kramer\n\n## Role\n\nArchitect\n');
  mockWriteCharter.mockResolvedValue(undefined);
  mockComputeCharterHash.mockResolvedValue('new-hash');
});

// ===========================================================================
// Suite 1: DELETE /:id?permanent=true — permanent hard-delete
// ===========================================================================

describe('DELETE /:id?permanent=true — permanent hard-delete', () => {
  it('1. succeeds (200, deleted:true) for a retired project agent', async () => {
    const agent = makeAgent({ status: 'retired', agentKind: 'squad' });
    queueSelects([agent]);

    const { req, res, getStatus, getBody } = makeReqRes(
      { projectId: 'project-001', id: 'agent-001' },
      {},
      { permanent: 'true' },
    );

    await deleteHandler(req, res);

    expect(getStatus()).toBe(200);
    expect(getBody().ok).toBe(true);
    expect(getBody().data).toMatchObject({ deleted: true, id: 'agent-001' });
    expect(mockDeleteFn).toHaveBeenCalledOnce();
    expect(mockUpdateFn).not.toHaveBeenCalled();
  });

  it('2. rejects an active project agent with 400', async () => {
    const agent = makeAgent({ status: 'active', agentKind: 'squad' });
    queueSelects([agent]);

    const { req, res, getStatus, getBody } = makeReqRes(
      { projectId: 'project-001', id: 'agent-001' },
      {},
      { permanent: 'true' },
    );

    await deleteHandler(req, res);

    expect(getStatus()).toBe(400);
    expect(getBody().ok).toBe(false);
    expect(getBody().error as string).toMatch(/retired/i);
    expect(mockDeleteFn).not.toHaveBeenCalled();
  });

  it('3. rejects a disabled project agent with 400', async () => {
    const agent = makeAgent({ status: 'disabled', agentKind: 'squad' });
    queueSelects([agent]);

    const { req, res, getStatus, getBody } = makeReqRes(
      { projectId: 'project-001', id: 'agent-001' },
      {},
      { permanent: 'true' },
    );

    await deleteHandler(req, res);

    expect(getStatus()).toBe(400);
    expect(getBody().ok).toBe(false);
    expect(getBody().error as string).toMatch(/retired/i);
    expect(mockDeleteFn).not.toHaveBeenCalled();
  });

  it('4. rejects a virtual Copilot agent with 403', async () => {
    // Copilot agents are read-only regardless of their status value.
    const agent = makeAgent({ status: 'retired', agentKind: 'copilot' });
    queueSelects([agent]);

    const { req, res, getStatus, getBody } = makeReqRes(
      { projectId: 'project-001', id: 'agent-001' },
      {},
      { permanent: 'true' },
    );

    await deleteHandler(req, res);

    expect(getStatus()).toBe(403);
    expect(getBody().ok).toBe(false);
    expect(getBody().error as string).toMatch(/read-only/i);
    expect(mockDeleteFn).not.toHaveBeenCalled();
  });

  it('5. returns 404 when the agent row does not exist', async () => {
    queueSelects([]); // empty result — agent not found

    const { req, res, getStatus, getBody } = makeReqRes(
      { projectId: 'project-001', id: 'nonexistent' },
      {},
      { permanent: 'true' },
    );

    await deleteHandler(req, res);

    expect(getStatus()).toBe(404);
    expect(getBody().ok).toBe(false);
    expect(mockDeleteFn).not.toHaveBeenCalled();
  });

  it('6. falls back to soft-disable (update, no delete) when permanent param is absent', async () => {
    const agent = makeAgent({ status: 'active', agentKind: 'squad' });
    queueSelects([agent]);

    const { req, res, getStatus } = makeReqRes({
      projectId: 'project-001',
      id: 'agent-001',
    });

    await deleteHandler(req, res);

    expect(getStatus()).toBe(200);
    expect(mockDeleteFn).not.toHaveBeenCalled();
    expect(mockUpdateFn).toHaveBeenCalledOnce();
    const setFn = mockUpdateFn.mock.results[0]?.value?.set as ReturnType<typeof vi.fn>;
    expect(setFn).toHaveBeenCalledWith(expect.objectContaining({ status: 'disabled' }));
  });
});

// ===========================================================================
// Suite 2: POST / — retired-agent name collision → reactivation (no 409)
// ===========================================================================

describe('POST / — same-name collision with a retired agent', () => {
  it('7. reactivates a retired project agent (HTTP 200, no insert)', async () => {
    const retiredAgent = makeAgent({ status: 'retired', agentKind: 'squad' });

    // First select: projects table (resolveSquadPath)
    // Second select: agents table (collision check)
    queueSelects([PROJECT_ROW], [retiredAgent]);

    const reactivatedAgent = makeAgent({ status: 'active' });
    const setFn = vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([reactivatedAgent]),
      }),
    });
    mockUpdateFn.mockReturnValue({ set: setFn });

    const { req, res, getStatus, getBody } = makeReqRes(
      { projectId: 'project-001' },
      { name: 'cosmo-kramer', role: 'Architect' },
    );

    await postHandler(req, res);

    expect(getStatus()).toBe(200);
    expect(getBody().ok).toBe(true);
    // Reactivation path uses update(), not insert()
    expect(mockInsertFn).not.toHaveBeenCalled();
    expect(setFn).toHaveBeenCalledWith(expect.objectContaining({ status: 'active' }));
  });

  it('8. returns 409 when the same-name agent is active', async () => {
    const activeAgent = makeAgent({ status: 'active', agentKind: 'squad' });
    queueSelects([PROJECT_ROW], [activeAgent]);

    const { req, res, getStatus, getBody } = makeReqRes(
      { projectId: 'project-001' },
      { name: 'cosmo-kramer', role: 'Architect' },
    );

    await postHandler(req, res);

    expect(getStatus()).toBe(409);
    expect(getBody().ok).toBe(false);
    expect(mockInsertFn).not.toHaveBeenCalled();
    expect(mockUpdateFn).not.toHaveBeenCalled();
  });

  it('9. returns 409 when the same-name agent is disabled', async () => {
    const disabledAgent = makeAgent({ status: 'disabled', agentKind: 'squad' });
    queueSelects([PROJECT_ROW], [disabledAgent]);

    const { req, res, getStatus, getBody } = makeReqRes(
      { projectId: 'project-001' },
      { name: 'cosmo-kramer', role: 'Architect' },
    );

    await postHandler(req, res);

    expect(getStatus()).toBe(409);
    expect(getBody().ok).toBe(false);
    expect(mockInsertFn).not.toHaveBeenCalled();
    expect(mockUpdateFn).not.toHaveBeenCalled();
  });

  it('10. does NOT reactivate a retired Copilot agent — returns 409', async () => {
    // Copilot agents are read-only; the reactivation path checks agentKind !== 'copilot'.
    const retiredCopilot = makeAgent({ status: 'retired', agentKind: 'copilot' });
    queueSelects([PROJECT_ROW], [retiredCopilot]);

    const { req, res, getStatus, getBody } = makeReqRes(
      { projectId: 'project-001' },
      { name: 'cosmo-kramer', role: 'Architect' },
    );

    await postHandler(req, res);

    expect(getStatus()).toBe(409);
    expect(getBody().ok).toBe(false);
    expect(mockInsertFn).not.toHaveBeenCalled();
    expect(mockUpdateFn).not.toHaveBeenCalled();
  });
});

describe('POST /hire-team/confirm — same-name collision with a retired agent', () => {
  it('reactivates a retired project agent instead of reporting a name conflict', async () => {
    const retiredAgent = makeAgent({ status: 'retired', agentKind: 'squad' });
    queueSelects([PROJECT_ROW], [retiredAgent]);

    const reactivatedAgent = makeAgent({ status: 'active' });
    const setFn = vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([reactivatedAgent]),
      }),
    });
    mockUpdateFn.mockReturnValue({ set: setFn });

    const { req, res, getStatus, getBody } = makeReqRes(
      { projectId: 'project-001' },
      {
        members: [{
          agentName: 'cosmo-kramer',
          role: 'developer',
          suggestedRoleId: 'developer',
        }],
      },
    );

    await hireTeamConfirmHandler(req, res);

    expect(getStatus()).toBe(200);
    expect((getBody().data as { errors: unknown[] }).errors).toEqual([]);
    expect((getBody().data as { created: unknown[] }).created).toHaveLength(1);
    expect(mockInsertFn).not.toHaveBeenCalled();
    expect(setFn).toHaveBeenCalledWith(expect.objectContaining({ status: 'active' }));
  });

  it('keeps active same-name agents as hire-team conflicts', async () => {
    const activeAgent = makeAgent({ status: 'active', agentKind: 'squad' });
    queueSelects([PROJECT_ROW], [activeAgent]);

    const { req, res, getStatus, getBody } = makeReqRes(
      { projectId: 'project-001' },
      {
        members: [{
          agentName: 'cosmo-kramer',
          role: 'developer',
          suggestedRoleId: 'developer',
        }],
      },
    );

    await hireTeamConfirmHandler(req, res);

    expect(getStatus()).toBe(200);
    expect((getBody().data as { created: unknown[] }).created).toEqual([]);
    expect((getBody().data as { errors: Array<{ error: string }> }).errors[0]?.error).toMatch(/already exists/i);
    expect(mockUpdateFn).not.toHaveBeenCalled();
  });
});
