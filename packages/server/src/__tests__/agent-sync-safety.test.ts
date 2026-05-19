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

function activeAgent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'agent-1',
    projectId: 'project-1',
    name: 'elaine-benes',
    role: 'Full-Stack Developer',
    model: null,
    status: 'active',
    charterHash: 'old-hash',
    charterContent: '',
    historyPath: null,
    ...overrides,
  };
}

function dirent(name: string) {
  return { name, isDirectory: () => true };
}

describe('agent-sync retirement safety', () => {
  const projectId = 'project-1';
  const squadPath = '/workspace/.squad';
  const charter = '# elaine-benes\n\n## Role\n\nFull-Stack Developer\n';

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAgentsFn.mockResolvedValue({
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn(() => ({ charter: vi.fn().mockRejectedValue(new Error('not found')) })),
    });
    mockFsReaddir.mockResolvedValue([dirent('elaine-benes')]);
    mockFsReadFile.mockResolvedValue(charter);
    mockFsAccess.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    mockParseCharterContent.mockReturnValue({
      role: 'Full-Stack Developer',
      model: undefined,
      expertise: [],
    });
    mockComputeContentHash.mockReturnValue('new-hash');
    mockInsertFn.mockReturnValue({ values: vi.fn().mockResolvedValue([]) });
    setupUpdateRecorder();
  });

  it('uses disk discovery when the SDK cache is stale so hire-team agents stay active', async () => {
    const row = activeAgent();
    queueSelects([row], [row]);
    const { set } = setupUpdateRecorder();

    const result = await syncAgentsFromDisk(projectId, squadPath);

    expect(result).toMatchObject({ added: 0, updated: 1, removed: 0 });
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        charterContent: charter,
        charterHash: 'new-hash',
      }),
    );
    expect(set).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'retired' }));
  });

  it('does not retire an active DB agent when its discovered charter is temporarily unreadable', async () => {
    const row = activeAgent();
    mockFsReadFile.mockRejectedValue(new Error('EBUSY: file is still being written'));
    queueSelects([row]);

    const result = await syncAgentsFromDisk(projectId, squadPath);

    expect(result).toEqual({ added: 0, updated: 0, removed: 0 });
    expect(mockUpdateFn).not.toHaveBeenCalled();
  });

  it('reactivates an agent that was incorrectly retired while its charter is present on disk', async () => {
    const row = activeAgent({
      status: 'retired',
      charterHash: 'new-hash',
      charterContent: charter,
    });
    queueSelects([row], [row]);
    const { set } = setupUpdateRecorder();

    const result = await syncAgentsFromDisk(projectId, squadPath);

    expect(result).toMatchObject({ added: 0, updated: 1, removed: 0 });
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ status: 'active' }));
  });
});
