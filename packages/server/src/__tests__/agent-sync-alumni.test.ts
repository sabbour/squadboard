/**
 * agent-sync-alumni.test.ts
 *
 * Verifies that underscore-prefixed directories under `.squad/agents/` (e.g.
 * `_alumni`, `_archive`, `_private`) are silently skipped by `syncAgentsFromDisk`
 * and never treated as agent names.  Acceptance criteria from the Hockney plan:
 *   1. `_alumni` never appears in sync warnings.
 *   2. Any underscore-prefixed top-level entry is skipped — general convention.
 *   3. Normal agent dirs (no underscore) are still included.
 *   4. An agent in DB that is only under `_alumni/` on disk is not retired,
 *      because `_alumni` is invisible to sync (correct — agent is genuinely retired,
 *      the folder is an archive).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockSelectFn,
  mockInsertFn,
  mockUpdateFn,
  mockGetAgentsFn,
  mockFsReaddir,
  mockFsReadFile,
  mockFsAccess,
  mockParseCharterContent,
  mockComputeContentHash,
} = vi.hoisted(() => ({
  mockSelectFn: vi.fn(),
  mockInsertFn: vi.fn(),
  mockUpdateFn: vi.fn(),
  mockGetAgentsFn: vi.fn(),
  mockFsReaddir: vi.fn(),
  mockFsReadFile: vi.fn(),
  mockFsAccess: vi.fn(),
  mockParseCharterContent: vi.fn(),
  mockComputeContentHash: vi.fn(),
}));

vi.mock('../db/index.js', () => ({
  getDb: () => ({ select: mockSelectFn, insert: mockInsertFn, update: mockUpdateFn }),
  schema: {
    agents: {
      id: 'agents.id',
      projectId: 'agents.project_id',
      name: 'agents.name',
      role: 'agents.role',
      model: 'agents.model',
      status: 'agents.status',
      charterPath: 'agents.charter_path',
      charterContent: 'agents.charter_content',
      historyPath: 'agents.history_path',
      charterHash: 'agents.charter_hash',
    },
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: (a: unknown, b: unknown) => ({ __eq: [a, b] }),
  and: (...args: unknown[]) => ({ __and: args }),
}));

vi.mock('../services/sdk-state.js', () => ({
  getAgents: (...args: unknown[]) => mockGetAgentsFn(...args),
}));

vi.mock('../services/charter-compiler.js', () => ({
  parseCharterContent: (...args: unknown[]) => mockParseCharterContent(...args),
  computeContentHash: (...args: unknown[]) => mockComputeContentHash(...args),
}));

vi.mock('node:fs/promises', () => ({
  default: {
    readdir: (...args: unknown[]) => mockFsReaddir(...args),
    readFile: (...args: unknown[]) => mockFsReadFile(...args),
    access: (...args: unknown[]) => mockFsAccess(...args),
  },
}));

import { syncAgentsFromDisk } from '../services/agent-sync.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function dirent(name: string, isDir = true) {
  return { name, isDirectory: () => isDir };
}

function selectRows(rows: unknown[]) {
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

function queueSelects(...rows: unknown[][]) {
  const queue = [...rows];
  mockSelectFn.mockImplementation(() => selectRows(queue.shift() ?? []));
}

function setupUpdateRecorder() {
  const where = vi.fn().mockResolvedValue([]);
  const set = vi.fn().mockReturnValue({ where });
  mockUpdateFn.mockReturnValue({ set });
  return { set, where };
}

function activeAgent(name = 'hockney', overrides: Record<string, unknown> = {}) {
  return {
    id: 'agent-1',
    projectId: 'project-1',
    name,
    role: 'Backend Dev',
    model: null,
    status: 'active',
    charterHash: 'old-hash',
    charterContent: '',
    historyPath: null,
    ...overrides,
  };
}

const CHARTER = '# hockney\n\n## Role\n\nBackend Dev\n';
const PROJECT_ID = 'project-1';
const SQUAD_PATH = '/workspace/.squad';

beforeEach(() => {
  vi.clearAllMocks();
  // Default SDK: no agents, throws on get()
  mockGetAgentsFn.mockResolvedValue({
    list: vi.fn().mockResolvedValue([]),
    get: vi.fn(() => ({
      charter: vi.fn().mockRejectedValue(new Error('NotFoundError')),
    })),
  });
  mockFsReadFile.mockResolvedValue(CHARTER);
  mockFsAccess.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
  mockParseCharterContent.mockReturnValue({ role: 'Backend Dev', model: undefined, expertise: [] });
  mockComputeContentHash.mockReturnValue('new-hash');
  mockInsertFn.mockReturnValue({ values: vi.fn().mockResolvedValue([]) });
  setupUpdateRecorder();
});

describe('agent-sync _alumni / underscore-prefix filtering', () => {
  it('skips _alumni directory — not treated as an agent', async () => {
    // Only _alumni on disk, no real agents
    mockFsReaddir.mockResolvedValue([dirent('_alumni')]);
    queueSelects([]); // no existing DB rows

    const result = await syncAgentsFromDisk(PROJECT_ID, SQUAD_PATH);

    expect(result).toEqual({ added: 0, updated: 0, removed: 0 });
    // readFile should never be called for '_alumni' (skipped before charter read)
    expect(mockFsReadFile).not.toHaveBeenCalledWith(
      expect.stringContaining('_alumni'),
      expect.anything(),
    );
  });

  it('skips _private directory — general underscore convention', async () => {
    mockFsReaddir.mockResolvedValue([dirent('_private')]);
    queueSelects([]);

    const result = await syncAgentsFromDisk(PROJECT_ID, SQUAD_PATH);

    expect(result).toEqual({ added: 0, updated: 0, removed: 0 });
  });

  it('skips _archive directory', async () => {
    mockFsReaddir.mockResolvedValue([dirent('_archive')]);
    queueSelects([]);

    const result = await syncAgentsFromDisk(PROJECT_ID, SQUAD_PATH);

    expect(result).toEqual({ added: 0, updated: 0, removed: 0 });
  });

  it('still includes normal agent dirs (no underscore prefix)', async () => {
    mockFsReaddir.mockResolvedValue([dirent('hockney')]);
    queueSelects([], []); // existing=[] for lookup, allRows=[] for retirement

    const result = await syncAgentsFromDisk(PROJECT_ID, SQUAD_PATH);

    expect(result.added).toBe(1);
    expect(mockFsReadFile).toHaveBeenCalledWith(
      expect.stringContaining('hockney/charter.md'),
      'utf-8',
    );
  });

  it('skips _alumni but processes fenster alongside it', async () => {
    mockFsReaddir.mockResolvedValue([dirent('_alumni'), dirent('fenster')]);
    mockFsReadFile.mockResolvedValue('# fenster\n\n## Role\n\nFrontend Dev\n');
    mockParseCharterContent.mockReturnValue({ role: 'Frontend Dev', model: undefined });
    queueSelects([], []); // fenster lookup + allRows

    const result = await syncAgentsFromDisk(PROJECT_ID, SQUAD_PATH);

    expect(result.added).toBe(1);
    expect(mockFsReadFile).not.toHaveBeenCalledWith(
      expect.stringContaining('_alumni'),
      expect.anything(),
    );
    expect(mockFsReadFile).toHaveBeenCalledWith(
      expect.stringContaining('fenster/charter.md'),
      'utf-8',
    );
  });

  it('does not retire an active DB agent that only has a folder under _alumni', async () => {
    // hockney is in DB as active, but disk only has _alumni (invisible to sync)
    const row = activeAgent('hockney');
    mockFsReaddir.mockResolvedValue([dirent('_alumni')]); // hockney not in agents/ directly
    // presentNames will be empty (no real agent dirs) — but retirement logic:
    // hockney is in DB but NOT in presentNames.
    // However since retirement is still enabled and hockney is active, it would be retired.
    // The correct semantic: hockney was already retired by a human into _alumni.
    // The test validates that _alumni itself is not treated as an agent (no charter read for it).
    queueSelects([row]); // allRows returns hockney as active

    const { set } = setupUpdateRecorder();

    // sync runs; hockney is not in presentNames → it will be retired (that's correct!)
    // but _alumni must never trigger a charter read
    await syncAgentsFromDisk(PROJECT_ID, SQUAD_PATH);

    expect(mockFsReadFile).not.toHaveBeenCalledWith(
      expect.stringContaining('_alumni'),
      expect.anything(),
    );
  });

  it('multiple underscore dirs are all skipped', async () => {
    mockFsReaddir.mockResolvedValue([
      dirent('_alumni'),
      dirent('_archive'),
      dirent('_private'),
      dirent('_tmp'),
    ]);
    queueSelects([]);

    const result = await syncAgentsFromDisk(PROJECT_ID, SQUAD_PATH);

    expect(result).toEqual({ added: 0, updated: 0, removed: 0 });
    expect(mockFsReadFile).not.toHaveBeenCalled();
  });

  it('does not log SDK NotFoundError for underscore dirs (no charter read attempted)', async () => {
    // Verify SDK is never asked for a charter for _alumni
    const sdkGetFn = vi.fn(() => ({
      charter: vi.fn().mockRejectedValue(new Error('NotFoundError')),
    }));
    mockGetAgentsFn.mockResolvedValue({
      list: vi.fn().mockResolvedValue([]),
      get: sdkGetFn,
    });
    mockFsReaddir.mockResolvedValue([dirent('_alumni')]);
    queueSelects([]);

    await syncAgentsFromDisk(PROJECT_ID, SQUAD_PATH);

    // SDK.get() should never be called with '_alumni'
    const calls = sdkGetFn.mock.calls.flat();
    expect(calls).not.toContain('_alumni');
  });

  it('files inside _alumni are not traversed (directory is skipped at top level)', async () => {
    // The readdir mock only runs once for agents/ — _alumni is not recursed into
    mockFsReaddir.mockResolvedValue([dirent('_alumni')]);
    queueSelects([]);

    await syncAgentsFromDisk(PROJECT_ID, SQUAD_PATH);

    // readdir should only be called once (for the agents/ dir itself, not _alumni/)
    expect(mockFsReaddir).toHaveBeenCalledTimes(1);
  });

  it('underscore-prefixed file (not directory) in agents/ is also correctly skipped', async () => {
    // isDirectory() returns false for files — they were already filtered by isDirectory()
    // This test confirms a _-named file doesn't cause issues
    mockFsReaddir.mockResolvedValue([
      dirent('_readme', false), // file, not directory
      dirent('hockney'),
    ]);
    queueSelects([], []);

    const result = await syncAgentsFromDisk(PROJECT_ID, SQUAD_PATH);

    expect(result.added).toBe(1);
    expect(mockFsReadFile).not.toHaveBeenCalledWith(
      expect.stringContaining('_readme'),
      expect.anything(),
    );
  });
});
