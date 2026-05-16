/**
 * ceremony-yaml-routes.test.ts — CER-3: route-level tests for
 *   GET  /:id/yaml
 *   POST /import-yaml
 *
 * Uses the same handler-capture pattern as patch-project-fields.test.ts:
 * mocks Express Router to capture registered handlers, then invokes them
 * directly with stub req/res objects.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// 1. Queue-based DB mock (pop rows in order per select call)
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
    chain.limit = vi.fn(async () => {
      return selectQueue.shift() ?? [];
    });
    return chain;
  };

  return {
    getDb: () => ({ select: vi.fn(selectChain) }),
    schema: {
      workflows: { id: 'id', projectId: 'project_id', slug: 'slug', kind: 'kind', triggerKind: 'trigger_kind', status: 'status', parentNarrativeId: 'parent_narrative_id' },
      workflowVersions: { workflowId: 'workflow_id', isActive: 'is_active', version: 'version' },
      projects: { id: 'id' },
      ceremonySchedules: { workflowId: 'workflow_id', id: 'id', enabled: 'enabled', nextFireAt: 'next_fire_at' },
      agents: { projectId: 'project_id', name: 'name', role: 'role' },
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

let exportResult = 'apiVersion: squad.io/v1\nkind: Ceremony\n';
let exportShouldThrow: (Error & { status?: number }) | null = null;
let importResult = { ceremonyId: 'ceremony-1', created: true };
let importShouldThrow: Error | null = null;

vi.mock('../services/ceremony-yaml-export.js', () => ({
  exportCeremonyAsYaml: vi.fn(async () => {
    if (exportShouldThrow) throw exportShouldThrow;
    return exportResult;
  }),
  ceremonyRowToWorkflowYaml: vi.fn(() => ({})),
}));

vi.mock('../services/ceremony-yaml-import.js', () => ({
  importCeremonyFromYaml: vi.fn(async () => {
    if (importShouldThrow) throw importShouldThrow;
    return importResult;
  }),
}));

vi.mock('../services/workflow-parser.js', () => ({
  parseWorkflowYaml: vi.fn(async () => ({ name: 'test', description: null })),
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
  let sentBody: unknown;
  const headers: Record<string, string> = {};

  const res = {
    status(code: number) { statusCode = code; return res; },
    json(data: unknown) { jsonBody = data; return res; },
    set(key: string, val: string) { headers[key] = val; return res; },
    send(data: unknown) { sentBody = data; return res; },
    getStatus: () => statusCode,
    getJson: () => jsonBody,
    getSent: () => sentBody,
    getHeader: (key: string) => headers[key],
  };

  return { req, res };
}

// ---------------------------------------------------------------------------
// 5. Tests
// ---------------------------------------------------------------------------

describe('GET /:id/yaml', () => {
  beforeEach(() => {
    selectQueue = [];
    exportShouldThrow = null;
    exportResult = 'apiVersion: squad.io/v1\nkind: Ceremony\n';
  });

  it('returns 200 with text/yaml content-type', async () => {
    const handler = handlers['GET']?.['/:id/yaml'];
    expect(handler).toBeDefined();

    // First select: ceremony ownership check → found
    pushSelect({ id: 'ceremony-1', projectId: 'proj-1' });

    const { req, res } = makeReqRes({ projectId: 'proj-1', id: 'ceremony-1' });
    await handler(req, res);

    expect(res.getStatus()).toBe(200);
    expect(res.getHeader('Content-Type')).toContain('text/yaml');
    expect(res.getSent()).toContain('squad.io/v1');
  });

  it('returns 404 for missing ceremony', async () => {
    const handler = handlers['GET']?.['/:id/yaml'];

    // First select: ceremony ownership check → not found
    pushSelect(); // empty array

    const { req, res } = makeReqRes({ projectId: 'proj-1', id: 'non-existent' });
    await handler(req, res);

    expect(res.getStatus()).toBe(404);
  });
});

describe('POST /import-yaml', () => {
  beforeEach(() => {
    selectQueue = [];
    importResult = { ceremonyId: 'ceremony-1', created: true };
    importShouldThrow = null;
  });

  it('valid yaml body → 200 + {ceremonyId, created}', async () => {
    const handler = handlers['POST']?.['/import-yaml'];
    expect(handler).toBeDefined();

    // Project check → found
    pushSelect({ id: 'proj-1' });

    const { req, res } = makeReqRes(
      { projectId: 'proj-1' },
      { yaml: 'apiVersion: squad.io/v1\nkind: Ceremony\n' },
    );
    await handler(req, res);

    expect(res.getStatus()).toBe(200);
    expect(res.getJson()).toEqual({ ceremonyId: 'ceremony-1', created: true });
  });

  it('invalid YAML → 400 with {error: {path, message}}', async () => {
    importShouldThrow = new Error(
      'Invalid workflow YAML at spec.trigger.type: Invalid enum value',
    );

    // Project check → found
    pushSelect({ id: 'proj-1' });

    const handler = handlers['POST']?.['/import-yaml'];
    const { req, res } = makeReqRes(
      { projectId: 'proj-1' },
      { yaml: 'apiVersion: squad.io/v1\nkind: Ceremony\n' },
    );
    await handler(req, res);

    expect(res.getStatus()).toBe(400);
    const body = res.getJson() as { error: { path: string; message: string } };
    expect(body.error.path).toBe('spec.trigger.type');
    expect(body.error.message).toBeTruthy();
  });

  it('missing yaml field → 400', async () => {
    const handler = handlers['POST']?.['/import-yaml'];
    const { req, res } = makeReqRes({ projectId: 'proj-1' }, {});
    await handler(req, res);

    expect(res.getStatus()).toBe(400);
  });

  it('project not found → 403', async () => {
    // Project check → not found
    pushSelect(); // empty

    const handler = handlers['POST']?.['/import-yaml'];
    const { req, res } = makeReqRes(
      { projectId: 'nonexistent-proj' },
      { yaml: 'apiVersion: squad.io/v1\nkind: Ceremony\n' },
    );
    await handler(req, res);

    expect(res.getStatus()).toBe(403);
  });

  it('returns created=false on update', async () => {
    importResult = { ceremonyId: 'existing-ceremony', created: false };
    // Project check → found
    pushSelect({ id: 'proj-1' });

    const handler = handlers['POST']?.['/import-yaml'];
    const { req, res } = makeReqRes(
      { projectId: 'proj-1' },
      { yaml: 'apiVersion: squad.io/v1\nkind: Ceremony\n' },
    );
    await handler(req, res);

    expect(res.getStatus()).toBe(200);
    expect((res.getJson() as { created: boolean }).created).toBe(false);
  });
});
