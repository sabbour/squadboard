import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  handlers,
  mockGetProjectSyncOwnershipStatus,
  mockPoolQuery,
  mockSelectFn,
  mockFsLstat,
  mockFsReadFile,
  mockFsWriteFile,
  mockFsMkdir,
} = vi.hoisted(() => ({
  handlers: {} as Record<string, Record<string, Function>>,
  mockGetProjectSyncOwnershipStatus: vi.fn(),
  mockPoolQuery: vi.fn(),
  mockSelectFn: vi.fn(),
  mockFsLstat: vi.fn(),
  mockFsReadFile: vi.fn(),
  mockFsWriteFile: vi.fn(),
  mockFsMkdir: vi.fn(),
}));

vi.mock('express', () => {
  const router = {
    get: vi.fn((routePath: string, ...fns: Function[]) => {
      handlers['GET'] ??= {};
      handlers['GET'][routePath] = fns[fns.length - 1]!;
    }),
    post: vi.fn((routePath: string, ...fns: Function[]) => {
      handlers['POST'] ??= {};
      handlers['POST'][routePath] = fns[fns.length - 1]!;
    }),
  };
  return { Router: () => router };
});

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col, val) => ({ col, val })),
}));

vi.mock('../db/index.js', () => ({
  getDb: () => ({ select: mockSelectFn }),
  getPool: () => ({ query: mockPoolQuery }),
  schema: {
    projects: {
      id: 'projects.id',
    },
  },
}));

vi.mock('../services/sdk-state.js', () => {
  class ProjectNotFoundError extends Error {
    readonly projectId: string;
    constructor(projectId: string) {
      super(`Project not found: ${projectId}`);
      this.name = 'ProjectNotFoundError';
      this.projectId = projectId;
    }
  }
  return {
    getProjectSyncOwnershipStatus: (...args: unknown[]) => mockGetProjectSyncOwnershipStatus(...args),
    ProjectNotFoundError,
  };
});

vi.mock('node:fs/promises', () => ({
  default: {
    lstat: (...args: unknown[]) => mockFsLstat(...args),
    readFile: (...args: unknown[]) => mockFsReadFile(...args),
    writeFile: (...args: unknown[]) => mockFsWriteFile(...args),
    mkdir: (...args: unknown[]) => mockFsMkdir(...args),
  },
}));

await import('../routes/squad-sync.js');

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
  };
  return { req, res, getStatus: () => statusCode, getBody: () => jsonBody };
}

function selectRows(rows: unknown[]) {
  const chain: Record<string, unknown> = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    limit: vi.fn().mockResolvedValue(rows),
  };
  return chain;
}

function dirStat() {
  return {
    isSymbolicLink: () => false,
    isFile: () => false,
    isDirectory: () => true,
  };
}

function fileStat() {
  return {
    isSymbolicLink: () => false,
    isFile: () => true,
    isDirectory: () => false,
  };
}

function enoent() {
  return Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
}

function baseStatus(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: 'squadboard.sdk-sync-ownership.v1',
    storage: {
      rawProvider: null,
      mode: 'postgresql',
      authority: 'squad_storage',
      importBehavior: 'one-time-filesystem-import-when-empty',
      mirrorBehavior: 'none',
      sharedExternalAccess: 'hosted-postgresql-or-squadboard-broker',
    },
    bootstrap: {
      status: 'partial',
      missingRequired: ['ceremoniesDefaultsPresent'],
      missingRecommended: ['copilotAgentMd'],
    },
    projection: {
      projectRoot: '/workspace/project',
      squadPath: '/workspace/project/.squad',
      artifacts: [
        {
          id: 'ceremoniesDefaultsPresent',
          path: '.squad/ceremonies.md#defaults',
          status: 'missing',
          requirement: 'required',
          owner: 'squadboard',
          purpose: 'Seeded ceremony defaults.',
        },
        {
          id: 'copilotAgentMd',
          path: '.github/agents/squad.agent.md',
          status: 'missing',
          requirement: 'recommended',
          owner: 'copilot-cli',
          purpose: 'Copilot projection.',
        },
      ],
    },
    surfaces: [],
    repairActions: [
      { id: 'seed-ceremony-defaults', owner: 'Hockney', reason: 'Seed defaults.' },
      { id: 'project-copilot-agent-file', owner: 'Kobayashi', reason: 'Generate Copilot projection.' },
      { id: 'expose-sync-status-api', owner: 'Hockney', reason: 'Historical SDK-facing reminder.' },
    ],
    ...overrides,
  };
}

describe('squad-sync project routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetProjectSyncOwnershipStatus.mockResolvedValue(baseStatus());
    mockPoolQuery.mockResolvedValue({
      rows: [{ row_count: '3', last_updated_at: '2026-05-19T21:58:16.699-07:00' }],
    });
    mockSelectFn.mockReturnValue(selectRows([{
      id: 'project-1',
      name: 'Test Project',
      description: 'Test description',
      path: '/workspace/project/.squad',
    }]));
    mockFsLstat.mockImplementation(async (targetPath: string) => {
      if (targetPath === '/workspace/project' || targetPath === '/workspace/project/.squad') {
        return dirStat();
      }
      if (targetPath.endsWith('ceremonies.md')) {
        return fileStat();
      }
      throw enoent();
    });
    mockFsReadFile.mockResolvedValue('# Ceremonies\n\nProject ceremonies will be listed here.\n');
    mockFsWriteFile.mockResolvedValue(undefined);
    mockFsMkdir.mockResolvedValue(undefined);
  });

  it('GET /status adapts SDK ownership into a client envelope', async () => {
    const handler = handlers['GET']?.['/status'];
    if (!handler) throw new Error('GET /status handler not registered');

    const { req, res, getStatus, getBody } = makeReqRes({ projectId: 'project-1' });
    await handler(req, res);

    expect(getStatus()).toBe(200);
    const body = getBody() as Record<string, any>;
    expect(body.ok).toBe(true);
    expect(body.data.authority).toMatchObject({
      storageMode: 'postgresql',
      sourceOfTruth: 'squad_storage',
      continuousSync: false,
    });
    expect(body.data.storage.squadStorage).toMatchObject({
      available: true,
      rowCount: 3,
    });
    expect(body.data.drift).toMatchObject({
      detected: true,
      level: 'error',
      continuousSync: false,
    });
    const actionIds = body.data.repair.actions.map((action: Record<string, unknown>) => action.id);
    expect(actionIds).toContain('seed-ceremony-defaults');
    expect(actionIds).toContain('generate-github-agent');
    expect(actionIds).not.toContain('expose-sync-status-api');
  });

  it('POST /repair dry-runs ceremony default seeding without writing files', async () => {
    const handler = handlers['POST']?.['/repair'];
    if (!handler) throw new Error('POST /repair handler not registered');

    const { req, res, getStatus, getBody } = makeReqRes(
      { projectId: 'project-1' },
      { actions: ['seed-ceremony-defaults'], dryRun: true },
    );
    await handler(req, res);

    expect(getStatus()).toBe(200);
    const body = getBody() as Record<string, any>;
    expect(body.data.results[0]).toMatchObject({
      action: 'seed-ceremony-defaults',
      status: 'dry-run',
      reason: 'dry_run_changes_available',
    });
    expect(body.data.results[0].changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: '/workspace/project/.squad/ceremonies.md',
          status: 'would-apply',
        }),
      ]),
    );
    expect(mockFsWriteFile).not.toHaveBeenCalled();
    expect(body.data.statusAfter).toBeUndefined();
  });

  it('POST /repair skips custom ceremony files instead of overwriting them', async () => {
    const handler = handlers['POST']?.['/repair'];
    if (!handler) throw new Error('POST /repair handler not registered');
    mockFsReadFile.mockResolvedValue('# Ceremonies\n\n## Release Review\n\nCustom agenda.\n');

    const { req, res, getStatus, getBody } = makeReqRes(
      { projectId: 'project-1' },
      { actions: ['seed-ceremony-defaults'], dryRun: false },
    );
    await handler(req, res);

    expect(getStatus()).toBe(200);
    const body = getBody() as Record<string, any>;
    expect(body.data.results[0]).toMatchObject({
      action: 'seed-ceremony-defaults',
      status: 'skipped',
      reason: 'custom_ceremonies_present',
    });
    expect(mockFsWriteFile).not.toHaveBeenCalled();
  });

  it('POST /project-squad-to-fs is honest about filesystem-authoritative mode', async () => {
    const handler = handlers['POST']?.['/project-squad-to-fs'];
    if (!handler) throw new Error('POST /project-squad-to-fs handler not registered');
    mockGetProjectSyncOwnershipStatus.mockResolvedValue(baseStatus({
      storage: {
        rawProvider: 'fs',
        mode: 'filesystem',
        authority: 'filesystem',
        importBehavior: 'live-filesystem',
        mirrorBehavior: 'none',
        sharedExternalAccess: 'direct-filesystem-access',
      },
    }));

    const { req, res, getStatus, getBody } = makeReqRes({ projectId: 'project-1' }, {});
    await handler(req, res);

    expect(getStatus()).toBe(200);
    const body = getBody() as Record<string, any>;
    expect(body.data.results[0]).toMatchObject({
      action: 'project-squad-to-fs',
      status: 'skipped',
      reason: 'filesystem_mode_is_authoritative',
    });
    expect(mockPoolQuery).not.toHaveBeenCalledWith(
      expect.stringContaining('SELECT path, content FROM squad_storage'),
      expect.anything(),
    );
  });
});
