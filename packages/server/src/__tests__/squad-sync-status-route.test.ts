import { access } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildSyncOwnershipStatus } from '../sdk/sync-ownership.js';

const routeSourcePath = fileURLToPath(new URL('../routes/squad-sync.ts', import.meta.url));

const { handlers, getProjectSyncOwnershipStatusMock, poolQueryMock } = vi.hoisted(() => ({
  handlers: {} as Record<string, Record<string, Function>>,
  getProjectSyncOwnershipStatusMock: vi.fn(),
  poolQueryMock: vi.fn(),
}));

vi.mock('express', () => {
  const Router = vi.fn(() => ({
    get: vi.fn((routePath: string, ...fns: Function[]) => {
      handlers['GET'] ??= {};
      handlers['GET'][routePath] = fns[fns.length - 1]!;
    }),
    post: vi.fn((routePath: string, ...fns: Function[]) => {
      handlers['POST'] ??= {};
      handlers['POST'][routePath] = fns[fns.length - 1]!;
    }),
    use: vi.fn(),
  }));

  return {
    Router,
    default: { Router },
  };
});

vi.mock('../services/sdk-state.js', () => ({
  getProjectSyncOwnershipStatus: getProjectSyncOwnershipStatusMock,
}));

vi.mock('../db/index.js', () => ({
  getPool: () => ({ query: poolQueryMock }),
  getDb: vi.fn(),
  schema: {
    projects: { id: 'projects.id' },
  },
}));

type Handler = (req: unknown, res: unknown, next?: unknown) => unknown | Promise<unknown>;

async function loadStatusHandler(): Promise<Handler> {
  try {
    await access(routeSourcePath);
  } catch {
    throw new Error(
      'Missing packages/server/src/routes/squad-sync.ts. Hockney must add GET /api/projects/:projectId/squad-sync/status before this contract can pass.',
    );
  }

  if (!handlers['GET']?.['/status']) {
    await import(pathToFileURL(routeSourcePath).href);
  }

  const handler = handlers['GET']?.['/status'];
  expect(
    handler,
    'routes/squad-sync.ts must register GET /status for /api/projects/:projectId/squad-sync/status',
  ).toBeTypeOf('function');
  return handler as Handler;
}

function makeReqRes(projectId = 'project-1') {
  const req = {
    params: { projectId, id: projectId },
  };
  let statusCode = 200;
  let jsonBody: unknown;
  const res = {
    status(code: number) {
      statusCode = code;
      return res;
    },
    json(body: unknown) {
      jsonBody = body;
      return res;
    },
  };

  return {
    req,
    res,
    getStatus: () => statusCode,
    getBody: () => jsonBody,
  };
}

describe('GET /api/projects/:projectId/squad-sync/status', () => {
  beforeEach(() => {
    getProjectSyncOwnershipStatusMock.mockReset();
    poolQueryMock.mockReset();
    poolQueryMock.mockResolvedValue({ rows: [{ row_count: '0', last_updated_at: null }] });
  });

  it('invariant: status endpoint returns stable sync ownership JSON', async () => {
    const handler = await loadStatusHandler();
    const status = buildSyncOwnershipStatus({
      storageProvider: 'postgresql',
      projectRoot: '/repo',
      squadPath: '/repo/.squad',
      presence: {
        squadDir: true,
        agentsDir: true,
        decisionsInboxDir: true,
        teamMd: true,
        routingMd: true,
        decisionsMd: true,
        ceremoniesMd: true,
        ceremoniesDefaultsPresent: true,
        copilotAgentMd: false,
      },
    });
    getProjectSyncOwnershipStatusMock.mockResolvedValue(status);
    const { req, res, getStatus, getBody } = makeReqRes();

    await handler(req, res);

    expect(getProjectSyncOwnershipStatusMock).toHaveBeenCalledWith('project-1');
    expect(getStatus()).toBe(200);
    const body = getBody() as { ok: boolean; data: Record<string, any> };
    expect(Object.keys(body)).toEqual(['ok', 'data']);
    expect(body.ok).toBe(true);
    expect(body.data).toMatchObject({
      projectId: 'project-1',
      contractVersion: 'squadboard.sdk-sync-ownership.v1',
      authority: {
        sourceOfTruth: 'squad_storage',
        storageMode: 'postgresql',
        continuousSync: false,
      },
      connected: false,
      onboardingSync: {
        mcpConfigPresent: false,
        ceremoniesSeeded: false,
        squadAgentPresent: false,
        inSync: false,
        driftedFields: ['mcpConfigPresent', 'ceremoniesSeeded', 'squadAgentPresent'],
      },
      bootstrap: {
        status: 'ready',
        missingRequired: [],
        missingRecommended: ['copilotAgentMd'],
      },
      projection: {
        projectRoot: '/repo',
        squadPath: '/repo/.squad',
      },
      drift: {
        detected: true,
        level: 'warning',
        continuousSync: false,
      },
      repair: {
        dryRunSupported: true,
      },
    });
    expect(body.data.repair.actions.map((action: Record<string, unknown>) => action.id))
      .toEqual(expect.arrayContaining(['onboard-to-squadboard', 'disconnect-squadboard', 'generate-github-agent']));
    expect(body.data.repair.actions.map((action: Record<string, unknown>) => action.id))
      .not.toEqual(expect.arrayContaining(['seed-ceremony-defaults', 'import-ceremonies-from-md', 'write-mcp-config']));
  });

  it('invariant: status endpoint exposes repair guidance for peer-client drift', async () => {
    const handler = await loadStatusHandler();
    const status = buildSyncOwnershipStatus({
      storageProvider: 'postgresql',
      projectRoot: '/repo',
      squadPath: '/repo/.squad',
      presence: {
        squadDir: true,
        agentsDir: true,
        decisionsInboxDir: true,
        teamMd: true,
        routingMd: true,
        decisionsMd: true,
        ceremoniesMd: true,
        ceremoniesDefaultsPresent: false,
        copilotAgentMd: false,
      },
    });
    getProjectSyncOwnershipStatusMock.mockResolvedValue(status);
    const { req, res, getBody } = makeReqRes();

    await handler(req, res);

    const body = getBody() as { ok: boolean; data: Record<string, any> };
    expect(body.ok).toBe(true);
    expect(body.data.bootstrap).toMatchObject({
      status: 'partial',
      missingRequired: ['ceremoniesDefaultsPresent'],
    });
    expect(body.data.projection.artifacts).toContainEqual(expect.objectContaining({
      path: '.github/agents/squad.agent.md',
      status: 'missing',
    }));
    expect(body.data.projection.artifacts).toContainEqual(expect.objectContaining({
      path: '.squad/ceremonies.md#defaults',
      status: 'missing',
    }));
    expect(body.data.drift.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'ceremony_defaults_missing' }),
      expect.objectContaining({ code: 'recommended_projection_missing' }),
    ]));
    expect(body.data.connected).toBe(false);
    expect(body.data.onboardingSync).toEqual({
      mcpConfigPresent: false,
      ceremoniesSeeded: false,
      squadAgentPresent: false,
      inSync: false,
      driftedFields: ['mcpConfigPresent', 'ceremoniesSeeded', 'squadAgentPresent'],
    });
    expect(body.data.repair.actions.map((action: Record<string, unknown>) => action.id))
      .toEqual(expect.arrayContaining(['onboard-to-squadboard', 'disconnect-squadboard', 'generate-github-agent']));
    expect(body.data.repair.actions.map((action: Record<string, unknown>) => action.id))
      .not.toEqual(expect.arrayContaining(['seed-ceremony-defaults', 'import-ceremonies-from-md', 'write-mcp-config']));
  });

  it('invariant: filesystem-authoritative projects are not labeled as squad_storage backed', async () => {
    const handler = await loadStatusHandler();
    const status = buildSyncOwnershipStatus({
      storageProvider: 'fs',
      projectRoot: '/repo',
      squadPath: '/repo/.squad',
      presence: {
        squadDir: true,
        agentsDir: true,
        decisionsInboxDir: true,
        teamMd: true,
        routingMd: true,
        decisionsMd: true,
        ceremoniesMd: true,
        ceremoniesDefaultsPresent: true,
        copilotAgentMd: true,
      },
    });
    getProjectSyncOwnershipStatusMock.mockResolvedValue(status);
    const { req, res, getBody } = makeReqRes('project-fs');

    await handler(req, res);

    const body = getBody() as { ok: boolean; data: Record<string, any> };
    expect(body.ok).toBe(true);
    expect(body.data.authority).toMatchObject({
      sourceOfTruth: 'filesystem',
      storageMode: 'filesystem',
    });
    expect(body.data.storage.squadStorage).toBeNull();
    expect(body.data.connected).toBe(false);
    expect(poolQueryMock).not.toHaveBeenCalled();
  });
});
