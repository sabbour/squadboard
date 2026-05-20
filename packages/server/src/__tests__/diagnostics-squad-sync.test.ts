import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getProjectSyncOwnershipStatusMock } = vi.hoisted(() => ({
  getProjectSyncOwnershipStatusMock: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFile: vi.fn((_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null) => void) => cb(null)),
}));

vi.mock('node:fs/promises', () => ({
  access: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue('squadboard-diag'),
  stat: vi.fn().mockResolvedValue({ isDirectory: () => true }),
  unlink: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col, value) => ({ col, value })),
}));

vi.mock('@bradygaster/squad-sdk/client', () => ({
  SquadClient: class {
    connect = vi.fn().mockResolvedValue(undefined);
    disconnect = vi.fn().mockResolvedValue(undefined);
    listModels = vi.fn().mockResolvedValue([{ id: 'model-1' }]);
  },
}));

vi.mock('../db/index.js', () => {
  const selectChain = {
    from: vi.fn(() => selectChain),
    where: vi.fn(() => Promise.resolve([{ path: '/repo/.squad' }])),
  };
  return {
    getDb: () => ({
      select: vi.fn(() => selectChain),
    }),
    getPool: () => ({
      connect: vi.fn().mockResolvedValue({
        query: vi.fn().mockResolvedValue({ rows: [{ ok: 1 }] }),
        release: vi.fn(),
      }),
    }),
    schema: {
      projects: { id: 'projects.id', path: 'projects.path' },
      mcpServers: {
        id: 'mcp_servers.id',
        name: 'mcp_servers.name',
        projectId: 'mcp_servers.project_id',
        url: 'mcp_servers.url',
      },
    },
  };
});

vi.mock('../realtime/ws-server.js', () => ({
  getWebSocketServer: () => ({ readyState: 1, clients: { size: 0 } }),
}));

vi.mock('../services/builtin-bundles.js', () => ({
  getBuiltinBundles: vi.fn().mockResolvedValue([{ bundleId: 'default' }]),
  getBuiltinBundleWarnings: vi.fn(() => []),
  getBuiltinBundleScanError: vi.fn(() => null),
  resetBuiltinBundleCache: vi.fn(),
}));

vi.mock('../services/sdk-state.js', () => {
  class ProjectNotFoundError extends Error {
    readonly projectId: string;
    constructor(projectId: string) {
      super(`Project not found: ${projectId}`);
      this.projectId = projectId;
    }
  }
  return {
    getProjectSyncOwnershipStatus: (...args: unknown[]) => getProjectSyncOwnershipStatusMock(...args),
    ProjectNotFoundError,
  };
});

import { runDiagnostics } from '../services/diagnostics.js';

describe('project diagnostics Squad Sync coverage', () => {
  beforeEach(() => {
    getProjectSyncOwnershipStatusMock.mockReset();
    getProjectSyncOwnershipStatusMock.mockResolvedValue({
      authority: {
        sourceOfTruth: 'filesystem',
        storageMode: 'filesystem',
      },
      bootstrap: {
        missingRequired: [],
        missingRecommended: [],
      },
      clients: {
        squadboard: { client: 'squadboard', status: 'ready' },
        copilotCli: { client: 'copilot-cli', status: 'ready' },
      },
      repairActions: [],
    });
  });

  it('includes Squad Sync health in project-scoped diagnostics', async () => {
    const results = await runDiagnostics({ projectId: 'project-1' });

    expect(getProjectSyncOwnershipStatusMock).toHaveBeenCalledWith('project-1');
    expect(results).toContainEqual(expect.objectContaining({
      id: 'squad_sync.status',
      label: 'Squad Sync projection',
      status: 'ok',
      detail: expect.stringContaining('Authority: filesystem'),
    }));
  });
});
