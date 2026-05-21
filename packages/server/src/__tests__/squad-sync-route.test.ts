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
  mockFsUnlink,
  mockFsReaddir,
  mockSeedBuiltInCeremonies,
  mockSyncCeremoniesFromDisk,
  mockRunFormulator,
  mockImportCeremonyFromYaml,
  mockRebuildCeremoniesMd,
} = vi.hoisted(() => ({
  handlers: {} as Record<string, Record<string, Function>>,
  mockGetProjectSyncOwnershipStatus: vi.fn(),
  mockPoolQuery: vi.fn(),
  mockSelectFn: vi.fn(),
  mockFsLstat: vi.fn(),
  mockFsReadFile: vi.fn(),
  mockFsWriteFile: vi.fn(),
  mockFsMkdir: vi.fn(),
  mockFsUnlink: vi.fn(),
  mockFsReaddir: vi.fn(),
  mockSeedBuiltInCeremonies: vi.fn(),
  mockSyncCeremoniesFromDisk: vi.fn(),
  mockRunFormulator: vi.fn(),
  mockImportCeremonyFromYaml: vi.fn(),
  mockRebuildCeremoniesMd: vi.fn(),
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
    unlink: (...args: unknown[]) => mockFsUnlink(...args),
    readdir: (...args: unknown[]) => mockFsReaddir(...args),
  },
}));

vi.mock('../ceremonies/seed-built-in.js', () => ({
  seedBuiltInCeremonies: (...args: unknown[]) => mockSeedBuiltInCeremonies(...args),
}));

vi.mock('../services/squad-writeback.js', () => ({
  syncCeremoniesFromDisk: (...args: unknown[]) => mockSyncCeremoniesFromDisk(...args),
  rebuildCeremoniesMd: (...args: unknown[]) => mockRebuildCeremoniesMd(...args),
}));

vi.mock('../services/formulator.js', () => ({
  runFormulator: (...args: unknown[]) => mockRunFormulator(...args),
}));

vi.mock('../services/ceremony-yaml-import.js', () => ({
  importCeremonyFromYaml: (...args: unknown[]) => mockImportCeremonyFromYaml(...args),
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
      { id: 'import-ceremonies-from-md', owner: 'Hockney', reason: 'Import ceremonies.' },
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
    mockFsUnlink.mockResolvedValue(undefined);
    mockFsReaddir.mockResolvedValue([]);
    mockSeedBuiltInCeremonies.mockResolvedValue({
      projectId: 'project-1',
      seeded: [
        { name: 'design-review', ceremonyId: 'wf-1', created: true },
        { name: 'retrospective', ceremonyId: 'wf-2', created: false },
      ],
      errors: [],
    });
    mockSyncCeremoniesFromDisk.mockResolvedValue({ imported: 1, skipped: 0, errors: 0 });
    mockRunFormulator.mockResolvedValue({
      raw: ['apiVersion: squad.io/v1', 'kind: Ceremony', 'metadata:', '  name: release-review', '  displayName: Release Review', 'spec:', '  trigger:', '    type: manual', '  steps:', '    - id: review-release', '      kind: agent-task', '      label: Review release', '      agent: "@lead"', '      prompt: "Review the release."'].join('\n'),
      modelUsed: { model: 'claude-haiku-4.5', via: 'fallback' },
    });
    mockImportCeremonyFromYaml.mockResolvedValue({ ceremonyId: 'wf-release', created: true });
    mockRebuildCeremoniesMd.mockResolvedValue(undefined);
  });

  it('GET /status adapts SDK ownership into a client envelope', async () => {
    const handler = handlers['GET']?.['/status'];
    if (!handler) throw new Error('GET /status handler not registered');
    mockFsLstat.mockImplementation(async (targetPath: string) => {
      if (
        targetPath === '/workspace/project'
        || targetPath === '/workspace/project/.squad'
        || targetPath === '/workspace/project/.mcp.json'
        || targetPath === '/workspace/project/.copilot/squad.agent.md'
        || targetPath === '/workspace/project/.squadboard/.connected'
        || targetPath.endsWith('ceremonies.md')
      ) {
        return targetPath === '/workspace/project' || targetPath === '/workspace/project/.squad'
          ? dirStat()
          : fileStat();
      }
      throw enoent();
    });
    mockFsReadFile.mockImplementation(async (targetPath: string) => {
      if (targetPath === '/workspace/project/.mcp.json') {
        return JSON.stringify({
          mcpServers: {
            squadboard: {
              url: 'http://localhost:3000/mcp',
            },
          },
        });
      }
      return '# Ceremonies\n\nProject ceremonies will be listed here.\n';
    });
    mockFsReaddir.mockResolvedValue([
      { name: 'design-review.yaml', isFile: () => true },
      { name: 'retrospective.yaml', isFile: () => true },
      { name: 'retro-enforcement.yaml', isFile: () => true },
      { name: 'sprint-planning.yaml', isFile: () => true },
      { name: 'sprint-retro.yaml', isFile: () => true },
      { name: 'scribe-close-out.yaml', isFile: () => true },
      { name: 'work-pickup.yaml', isFile: () => true },
    ]);

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
    expect(body.data.connected).toBe(true);
    expect(body.data.onboardingSync).toMatchObject({
      mcpConfigPresent: true,
      ceremoniesSeeded: true,
      squadAgentPresent: true,
      inSync: true,
      driftedFields: [],
      checkedFiles: [
        { label: 'MCP config', path: '.mcp.json', present: true },
        { label: 'Built-in ceremonies', path: '.squadboard/ceremonies/', present: true, count: 7 },
        { label: 'Squad agent instructions', path: '.squad/squad.agent.md', present: true },
      ],
      lastCheckedAt: expect.any(String),
    });
    expect(body.data.drift).toMatchObject({
      detected: true,
      level: 'error',
      continuousSync: false,
    });
    const actionIds = body.data.repair.actions.map((action: Record<string, unknown>) => action.id);
    expect(actionIds[0]).toBe('onboard-to-squadboard');
    expect(actionIds).toContain('generate-github-agent');
    expect(actionIds).toContain('disconnect-squadboard');
    expect(actionIds).not.toContain('seed-ceremony-defaults');
    expect(actionIds).not.toContain('import-ceremonies-from-md');
    expect(actionIds).not.toContain('write-mcp-config');
    expect(actionIds).not.toContain('expose-sync-status-api');
    expect(body.data.repair.actions).toContainEqual(expect.objectContaining({
      id: 'onboard-to-squadboard',
      reason: 'Write .mcp.json, seed built-in ceremonies, import custom ceremonies.md entries, then rebuild ceremonies.md once.',
      required: false,
      mode: 'manual',
    }));
    expect(body.data.repair.actions).toContainEqual(expect.objectContaining({
      id: 'disconnect-squadboard',
      available: true,
      mode: 'manual',
    }));
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
        expect.objectContaining({
          path: 'design-review',
          operation: 'seed-db',
          status: 'dry-run',
        }),
      ]),
    );
    expect(mockSeedBuiltInCeremonies).not.toHaveBeenCalled();
    expect(mockSyncCeremoniesFromDisk).not.toHaveBeenCalled();
    expect(mockFsWriteFile).not.toHaveBeenCalled();
    expect(body.data.statusAfter).toBeUndefined();
  });

  it('POST /repair seeds the DB even when ceremonies.md already has custom content', async () => {
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
      status: 'applied',
      reason: 'changes_applied',
    });
    expect(body.data.results[0].changes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: '/workspace/project/.squad/ceremonies.md',
        status: 'skipped',
        reason: 'custom_ceremonies_present',
      }),
      expect.objectContaining({
        path: 'design-review',
        operation: 'seed-db',
        status: 'applied',
      }),
      expect.objectContaining({
        path: '.squadboard/ceremonies/*.yaml',
        operation: 'seed-db',
        status: 'applied',
      }),
    ]));
    expect(mockSeedBuiltInCeremonies).toHaveBeenCalledWith('project-1');
    expect(mockSyncCeremoniesFromDisk).toHaveBeenCalledWith('project-1', '/workspace/project/.squadboard');
    expect(mockFsWriteFile).not.toHaveBeenCalled();
  });

  it('POST /repair dry-runs markdown ceremony import for custom sections only', async () => {
    const handler = handlers['POST']?.['/repair'];
    if (!handler) throw new Error('POST /repair handler not registered');
    mockFsReadFile.mockResolvedValue([
      '# Ceremonies',
      '',
      '## Design Review',
      '',
      'Built-in section.',
      '',
      '## Release Review',
      '',
      'Custom release checklist.',
    ].join('\n'));

    const { req, res, getStatus, getBody } = makeReqRes(
      { projectId: 'project-1' },
      { actions: ['import-ceremonies-from-md'], dryRun: true },
    );
    await handler(req, res);

    expect(getStatus()).toBe(200);
    const body = getBody() as Record<string, any>;
    expect(body.data.results[0]).toMatchObject({
      action: 'import-ceremonies-from-md',
      status: 'dry-run',
    });
    expect(body.data.results[0].changes).toEqual([
      expect.objectContaining({
        path: 'Release Review',
        operation: 'seed-db',
        status: 'dry-run',
      }),
    ]);
    expect(mockRunFormulator).not.toHaveBeenCalled();
    expect(mockImportCeremonyFromYaml).not.toHaveBeenCalled();
  });

  it('POST /repair converts custom ceremonies.md sections into workflow YAML', async () => {
    const handler = handlers['POST']?.['/repair'];
    if (!handler) throw new Error('POST /repair handler not registered');
    mockFsReadFile.mockResolvedValue([
      '# Ceremonies',
      '',
      '## Design Review',
      '',
      'Built-in section.',
      '',
      '## Release Review',
      '',
      'Custom release checklist.',
    ].join('\n'));

    const { req, res, getStatus, getBody } = makeReqRes(
      { projectId: 'project-1' },
      { actions: ['import-ceremonies-from-md'], dryRun: false },
    );
    await handler(req, res);

    expect(getStatus()).toBe(200);
    const body = getBody() as Record<string, any>;
    expect(body.data.results[0]).toMatchObject({
      action: 'import-ceremonies-from-md',
      status: 'applied',
      reason: 'changes_applied',
    });
    expect(mockRunFormulator).toHaveBeenCalledOnce();
    expect(mockImportCeremonyFromYaml).toHaveBeenCalledWith(
      expect.stringContaining('metadata:'),
      'project-1',
      expect.objectContaining({ sourceMarker: 'markdown:release-review' }),
    );
    expect(body.data.results[0].changes).toEqual([
      expect.objectContaining({
        path: 'Release Review',
        operation: 'seed-db',
        status: 'applied',
      }),
    ]);
  });

  it('POST /repair writes .mcp.json for the current project', async () => {
    const handler = handlers['POST']?.['/repair'];
    if (!handler) throw new Error('POST /repair handler not registered');

    const { req, res, getStatus, getBody } = makeReqRes(
      { projectId: 'project-1' },
      { actions: ['write-mcp-config'], dryRun: false },
    );
    await handler(req, res);

    expect(getStatus()).toBe(200);
    const body = getBody() as Record<string, any>;
    expect(body.data.results[0]).toMatchObject({
      action: 'write-mcp-config',
      status: 'applied',
    });
    expect(body.data.results[0].changes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: '.mcp.json',
        operation: 'write-file',
        status: 'applied',
        message: 'wrote squadboard MCP server entry',
      }),
    ]));
    expect(mockFsMkdir).not.toHaveBeenCalled();
    expect(mockFsWriteFile).toHaveBeenCalledWith(
      '/workspace/project/.mcp.json',
      `${JSON.stringify({
        mcpServers: {
          squadboard: {
            url: 'http://localhost:3000/mcp',
          },
        },
      }, null, 2)}\n`,
      'utf-8',
    );
  });

  it('POST /repair onboard-to-squadboard writes the connected marker on success', async () => {
    const handler = handlers['POST']?.['/repair'];
    if (!handler) throw new Error('POST /repair handler not registered');
    mockFsReadFile.mockResolvedValue([
      '# Ceremonies',
      '',
      '## Design Review',
      '',
      'Built-in section.',
      '',
      '## Release Review',
      '',
      'Custom release checklist.',
    ].join('\n'));

    const { req, res, getStatus, getBody } = makeReqRes(
      { projectId: 'project-1' },
      { actions: ['onboard-to-squadboard'], dryRun: false },
    );
    await handler(req, res);

    expect(getStatus()).toBe(200);
    const body = getBody() as Record<string, any>;
    expect(body.data.results[0]).toMatchObject({
      action: 'onboard-to-squadboard',
      status: 'applied',
    });
    expect(body.data.results[0].changes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: '/workspace/project/.squadboard/.connected',
        operation: 'write-file',
        status: 'applied',
      }),
    ]));
    expect(mockFsWriteFile).toHaveBeenCalledWith(
      '/workspace/project/.squadboard/.connected',
      expect.stringContaining('"version": 1'),
      'utf-8',
    );
  });

  it('POST /repair onboard-to-squadboard continues after a sub-step failure and rebuilds once', async () => {
    const handler = handlers['POST']?.['/repair'];
    if (!handler) throw new Error('POST /repair handler not registered');
    mockFsReadFile.mockResolvedValue([
      '# Ceremonies',
      '',
      '## Design Review',
      '',
      'Built-in section.',
      '',
      '## Release Review',
      '',
      'Custom release checklist.',
    ].join('\n'));
    mockRunFormulator.mockRejectedValue(new Error('formulator boom'));

    const { req, res, getStatus, getBody } = makeReqRes(
      { projectId: 'project-1' },
      { actions: ['onboard-to-squadboard'], dryRun: false },
    );
    await handler(req, res);

    expect(getStatus()).toBe(200);
    const body = getBody() as Record<string, any>;
    expect(body.data.results[0]).toMatchObject({
      action: 'onboard-to-squadboard',
      status: 'failed',
    });
    expect(body.data.results[0].changes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: '.mcp.json',
        operation: 'write-file',
        status: 'applied',
      }),
      expect.objectContaining({
        path: 'Release Review',
        operation: 'seed-db',
        status: 'failed',
        reason: 'ceremony_markdown_import_failed',
      }),
      expect.objectContaining({
        path: '/workspace/project/.squad/ceremonies.md',
        operation: 'write-file',
        status: 'applied',
        reason: 'ceremonies_md_rebuilt',
      }),
    ]));
    expect(body.data.results[0].changes).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: '/workspace/project/.squadboard/.connected',
      }),
    ]));
    expect(mockSeedBuiltInCeremonies).toHaveBeenCalledWith('project-1');
    expect(mockSyncCeremoniesFromDisk).toHaveBeenCalledWith('project-1', '/workspace/project/.squadboard');
    expect(mockRebuildCeremoniesMd).toHaveBeenCalledWith('project-1', '/workspace/project/.squad');
  });

  it('POST /repair disconnect-squadboard removes the connected marker and only the squadboard MCP entry', async () => {
    const handler = handlers['POST']?.['/repair'];
    if (!handler) throw new Error('POST /repair handler not registered');
    mockFsLstat.mockImplementation(async (targetPath: string) => {
      if (
        targetPath === '/workspace/project'
        || targetPath === '/workspace/project/.squad'
        || targetPath === '/workspace/project/.mcp.json'
        || targetPath === '/workspace/project/.squadboard/.connected'
      ) {
        return targetPath === '/workspace/project' || targetPath === '/workspace/project/.squad'
          ? dirStat()
          : fileStat();
      }
      throw enoent();
    });
    mockFsReadFile.mockImplementation(async (targetPath: string) => {
      if (targetPath === '/workspace/project/.mcp.json') {
        return JSON.stringify({
          theme: 'dark',
          mcpServers: {
            squadboard: {
              url: 'http://localhost:3000/mcp',
            },
            other: {
              command: 'other-mcp',
            },
          },
        });
      }
      return '# Ceremonies\n\nProject ceremonies will be listed here.\n';
    });

    const { req, res, getStatus, getBody } = makeReqRes(
      { projectId: 'project-1' },
      { actions: ['disconnect-squadboard'], dryRun: false },
    );
    await handler(req, res);

    expect(getStatus()).toBe(200);
    const body = getBody() as Record<string, any>;
    expect(body.data.results[0]).toMatchObject({
      action: 'disconnect-squadboard',
      status: 'applied',
    });
    expect(mockFsWriteFile).toHaveBeenCalledWith(
      '/workspace/project/.mcp.json',
      `${JSON.stringify({
        theme: 'dark',
        mcpServers: {
          other: {
            command: 'other-mcp',
          },
        },
      }, null, 2)}\n`,
      'utf-8',
    );
    expect(mockFsUnlink).toHaveBeenCalledWith('/workspace/project/.squadboard/.connected');
  });

  it('POST /repair merges write-mcp-config with existing MCP servers', async () => {
    const handler = handlers['POST']?.['/repair'];
    if (!handler) throw new Error('POST /repair handler not registered');
    mockFsLstat.mockImplementation(async (targetPath: string) => {
      if (
        targetPath === '/workspace/project'
        || targetPath === '/workspace/project/.squad'
      ) {
        return dirStat();
      }
      if (
        targetPath.endsWith('ceremonies.md')
        || targetPath === '/workspace/project/.mcp.json'
      ) {
        return fileStat();
      }
      throw enoent();
    });
    mockFsReadFile.mockImplementation(async (targetPath: string) => {
      if (targetPath === '/workspace/project/.mcp.json') {
        return JSON.stringify({
          theme: 'dark',
          mcpServers: {
            other: {
              command: 'other-mcp',
              args: ['serve'],
            },
            squadboard: {
              command: 'node',
              args: ['/stale/path.js'],
              env: {
                SQUADBOARD_SQUAD_STORAGE_PROVIDER: 'postgresql',
                SQUADBOARD_DEFAULT_PROJECT_ID: 'old-project',
              },
            },
          },
        });
      }
      return '# Ceremonies\n\nProject ceremonies will be listed here.\n';
    });

    const { req, res, getStatus } = makeReqRes(
      { projectId: 'project-1' },
      { actions: ['write-mcp-config'], dryRun: false },
    );
    await handler(req, res);

    expect(getStatus()).toBe(200);
    expect(mockFsWriteFile).toHaveBeenCalledWith(
      '/workspace/project/.mcp.json',
      `${JSON.stringify({
        theme: 'dark',
        mcpServers: {
          other: {
            command: 'other-mcp',
            args: ['serve'],
          },
          squadboard: {
            url: 'http://localhost:3000/mcp',
          },
        },
      }, null, 2)}\n`,
      'utf-8',
    );
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
