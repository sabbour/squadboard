/**
 * ceremonies-route-agent-signal.test.ts — W29 CER-6 route follow-up
 *
 * Regression tests for agent-signal triggerKind support in ceremonies API.
 * Ensures that after CER-6's schema expansion, the API validator accepts agent-signal.
 *
 * Uses the same handler-capture pattern as ceremony-yaml-routes.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// 1. Mock database layer
// ---------------------------------------------------------------------------

let selectQueue: unknown[][] = [];

function pushSelect(...rows: unknown[]): void {
  selectQueue.push(rows);
}

vi.mock('../db/index.js', () => {
  const selectChain = () => {
    const chain: Record<string, unknown> = {};
    chain.from = vi.fn(() => chain);
    chain.where = vi.fn(() => chain);
    chain.limit = vi.fn(async () => selectQueue.shift() ?? []);
    chain.select = vi.fn(() => chain);
    
    // For insert/update chains
    const insertChain = Object.assign(chain, {
      insert: vi.fn(() => insertChain),
      update: vi.fn(() => insertChain),
      values: vi.fn((vals: unknown) => {
        insertChain.vals = vals;
        return insertChain;
      }),
      set: vi.fn((data: unknown) => {
        insertChain.data = data;
        return insertChain;
      }),
      returning: vi.fn(async () => [{
        id: 'cem-123',
        projectId: 'proj-1',
        triggerKind: 'agent-signal',
        triggerConfig: { signalName: 'before-batch' },
      }]),
    });
    
    return insertChain;
  };

  return {
    getDb: () => ({ select: vi.fn(selectChain), insert: vi.fn(selectChain), update: vi.fn(selectChain) }),
    schema: {
      workflows: {
        id: 'id',
        projectId: 'project_id',
        slug: 'slug',
        kind: 'kind',
        triggerKind: 'trigger_kind',
        triggerConfig: 'trigger_config',
        status: 'status',
        parentNarrativeId: 'parent_narrative_id',
        description: 'description',
        name: 'name',
      },
      workflowVersions: {
        workflowId: 'workflow_id',
        isActive: 'is_active',
        version: 'version',
        yamlContent: 'yaml_content',
        jsonSchema: 'json_schema',
      },
      projects: { id: 'id' },
      ceremonySchedules: { workflowId: 'workflow_id', id: 'id', enabled: 'enabled', nextFireAt: 'next_fire_at' },
      agents: { projectId: 'project_id', name: 'name', role: 'role' },
      workflowRuns: {
        id: 'id',
        status: 'status',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },
  };
});

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col, val) => ({ col, val })),
  and: vi.fn((...args) => ({ and: args })),
  sql: Object.assign(vi.fn(), { raw: vi.fn() }),
  gte: vi.fn(),
  count: vi.fn(),
  isNotNull: vi.fn(),
  inArray: vi.fn(),
}));

// ---------------------------------------------------------------------------
// 2. Service mocks
// ---------------------------------------------------------------------------

vi.mock('../services/workflow-parser.js', () => ({
  parseWorkflowYaml: vi.fn(async () => ({
    name: 'Test ceremony',
    description: 'Test ceremony',
    steps: [],
    outputSchema: null,
  })),
  validateWorkflowYaml: vi.fn(() => ({ valid: true, errors: [] })),
}));

vi.mock('../services/ceremony-origin.js', () => ({
  deriveOrigin: vi.fn(() => 'user-created'),
}));

vi.mock('../services/ceremony-scheduler.js', () => ({
  spawnCeremonyRun: vi.fn(),
  previewNextFireTimes: vi.fn(),
  computeNextFire: vi.fn(),
}));

vi.mock('../services/ceremony-translator.js', () => ({
  translateNarrative: vi.fn(),
  translateProse: vi.fn(),
  refineProse: vi.fn(),
  invokeBuiltInCeremony: vi.fn(),
  TranslatorError: class extends Error {},
  TranslatorThrottledError: class extends Error {},
}));

vi.mock('../workflows/templates/index.js', () => ({
  getBuiltinTemplates: vi.fn(() => []),
}));

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'test-uuid-123'),
}));

vi.mock('slugify', () => ({
  default: vi.fn((s: string) => s.toLowerCase().replace(/\s+/g, '-')),
}));

// ---------------------------------------------------------------------------
// 3. Mock Express Router to capture route handlers
// ---------------------------------------------------------------------------

const handlers: Record<string, Record<string, Function>> = {};

vi.mock('express', async () => {
  function makeRouter() {
    const router = {
      get: vi.fn((path: string, ...fns: Function[]) => {
        handlers['GET'] ??= {};
        handlers['GET'][path] = fns[fns.length - 1]!;
      }),
      post: vi.fn((path: string, ...fns: Function[]) => {
        handlers['POST'] ??= {};
        handlers['POST'][path] = fns[fns.length - 1]!;
      }),
      patch: vi.fn((path: string, ...fns: Function[]) => {
        handlers['PATCH'] ??= {};
        handlers['PATCH'][path] = fns[fns.length - 1]!;
      }),
      delete: vi.fn((path: string, ...fns: Function[]) => {
        handlers['DELETE'] ??= {};
        handlers['DELETE'][path] = fns[fns.length - 1]!;
      }),
      use: vi.fn(),
    };
    return router;
  }
  return { Router: vi.fn(() => makeRouter()) };
});

// Load the route module — registers all handlers as a side-effect
await import('../routes/ceremonies.js');
const { spawnCeremonyRun } = await import('../services/ceremony-scheduler.js');

// ---------------------------------------------------------------------------
// 4. Helper: build stub req/res
// ---------------------------------------------------------------------------

function makeReqRes(
  params: Record<string, string> = {},
  body: Record<string, unknown> = {},
) {
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
    set() { return res; },
    send() { return res; },
    getStatus: () => statusCode,
    getJson: () => jsonBody,
  };

  return { req, res };
}

// ---------------------------------------------------------------------------
// 5. Tests
// ---------------------------------------------------------------------------

describe('triggerKind validation — agent-signal support', () => {
  beforeEach(() => {
    selectQueue = [];
    vi.mocked(spawnCeremonyRun).mockReset();
  });

  it('POST / with triggerKind=agent-signal passes validation (does not return 400)', async () => {
    const handler = handlers['POST']?.['/'];
    expect(handler).toBeDefined();

    const { req, res } = makeReqRes(
      { projectId: 'proj-1' },
      {
        yamlContent: 'name: Test\nspec: {}',
        triggerKind: 'agent-signal',
        triggerConfig: { signalName: 'before-batch' },
        kind: 'ceremony',
      },
    );

    await handler(req, res);

    expect(res.getStatus()).toBe(201);
  });

  it('POST / with triggerKind=invalid-unknown still rejected with 400', async () => {
    const handler = handlers['POST']?.['/'];

    const { req, res } = makeReqRes(
      { projectId: 'proj-1' },
      {
        yamlContent: 'name: Test\nspec: {}',
        triggerKind: 'invalid-unknown',
        kind: 'ceremony',
      },
    );

    await handler(req, res);

    expect(res.getStatus()).toBe(400);
    const jsonRes = res.getJson() as any;
    expect(jsonRes?.error).toContain('triggerKind must be one of');
  });

  it('PATCH /:id with triggerKind=agent-signal passes validation (does not return 400)', async () => {
    const handler = handlers['PATCH']?.['/:id'];
    expect(handler).toBeDefined();

    // Mock select: ceremony exists
    pushSelect({
      id: 'ceremony-1',
      projectId: 'proj-1',
      triggerKind: 'manual',
      triggerConfig: {},
    });

    // Mock select: no versions
    pushSelect();

    const { req, res } = makeReqRes(
      { projectId: 'proj-1', id: 'ceremony-1' },
      {
        triggerKind: 'agent-signal',
        triggerConfig: { signalName: 'after-batch' },
      },
    );

    await handler(req, res);

    // Should NOT be 400 (validation error)
    const status = res.getStatus();
    expect(status).not.toBe(400);
  });

  it('PATCH /:id with triggerKind=invalid-unknown still rejected with 400', async () => {
    const handler = handlers['PATCH']?.['/:id'];

    const { req, res } = makeReqRes(
      { projectId: 'proj-1', id: 'ceremony-1' },
      {
        triggerKind: 'invalid-unknown',
      },
    );

    await handler(req, res);

    expect(res.getStatus()).toBe(400);
    const jsonRes = res.getJson() as any;
    expect(jsonRes?.error).toContain('triggerKind must be one of');
  });

  it('error message includes agent-signal in the valid list', async () => {
    const handler = handlers['POST']?.['/'];

    const { req, res } = makeReqRes(
      { projectId: 'proj-1' },
      {
        yamlContent: 'name: Test',
        triggerKind: 'bad-value',
      },
    );

    await handler(req, res);

    expect(res.getStatus()).toBe(400);
    const jsonRes = res.getJson() as any;
    const errorMsg = jsonRes?.error ?? '';
    expect(errorMsg).toContain('agent-signal');
  });

  it('POST /:id/run persists reusable manual context in triggerSource', async () => {
    const handler = handlers['POST']?.['/:id/run'];
    expect(handler).toBeDefined();
    vi.mocked(spawnCeremonyRun).mockResolvedValue('run-123');

    pushSelect({ id: 'ceremony-1', projectId: 'proj-1', kind: 'ceremony', status: 'active' });
    pushSelect({
      id: 'run-123',
      status: 'pending',
      createdAt: new Date('2026-05-20T12:00:00.000Z'),
      updatedAt: new Date('2026-05-20T12:00:00.000Z'),
    });

    const context = {
      mode: 'selected-docs',
      selectedDocs: [{ path: 'docs/getting-started.md', blobSha: 'blob-1' }],
    };
    const { req, res } = makeReqRes(
      { projectId: 'proj-1', id: 'ceremony-1' },
      { anchorIssueId: 'issue-1', context },
    );

    await handler(req, res);

    expect(res.getStatus()).toBe(201);
    expect(spawnCeremonyRun).toHaveBeenCalledWith('ceremony-1', {
      trigger: 'manual',
      anchorIssueId: 'issue-1',
      triggerSource: {
        kind: 'manual',
        anchorIssueId: 'issue-1',
        context,
        detail: 'POST /ceremonies/:id/run',
      },
    });
    expect((res.getJson() as { workflowRunId?: string }).workflowRunId).toBe('run-123');
  });
});
