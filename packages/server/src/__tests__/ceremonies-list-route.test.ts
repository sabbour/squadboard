/**
 * ceremonies-list-route.test.ts — focused regressions for the ceremony list API.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

let selectQueue: unknown[][] = [];

function pushSelect(rows: unknown[]): void {
  selectQueue.push(rows);
}

function makeChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  chain.from = vi.fn(() => chain);
  chain.innerJoin = vi.fn(() => chain);
  chain.leftJoin = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.orderBy = vi.fn(() => chain);
  chain.limit = vi.fn(() => chain);
  chain.then = (
    onfulfilled: (value: unknown[]) => unknown,
    onrejected?: (reason: unknown) => unknown,
  ) => Promise.resolve(rows).then(onfulfilled, onrejected);
  return chain;
}

vi.mock('../db/index.js', () => {
  const schema = {
    workflows: {
      id: 'workflows.id',
      projectId: 'workflows.project_id',
      name: 'workflows.name',
      slug: 'workflows.slug',
      description: 'workflows.description',
      triggerKind: 'workflows.trigger_kind',
      triggerConfig: 'workflows.trigger_config',
      kind: 'workflows.kind',
      status: 'workflows.status',
      parentNarrativeId: 'workflows.parent_narrative_id',
      createdAt: 'workflows.created_at',
      updatedAt: 'workflows.updated_at',
    },
    workflowVersions: {
      id: 'workflow_versions.id',
      workflowId: 'workflow_versions.workflow_id',
      version: 'workflow_versions.version',
      yamlContent: 'workflow_versions.yaml_content',
      jsonSchema: 'workflow_versions.json_schema',
      isActive: 'workflow_versions.is_active',
      createdAt: 'workflow_versions.created_at',
    },
    workflowRuns: {
      id: 'workflow_runs.id',
      status: 'workflow_runs.status',
      createdAt: 'workflow_runs.created_at',
      updatedAt: 'workflow_runs.updated_at',
    },
    stepRuns: {
      workflowRunId: 'step_runs.workflow_run_id',
      issueRunId: 'step_runs.issue_run_id',
      updatedAt: 'step_runs.updated_at',
    },
    issueRuns: {
      id: 'issue_runs.id',
      status: 'issue_runs.status',
      workspaceStrategy: 'issue_runs.workspace_strategy',
      workspacePath: 'issue_runs.workspace_path',
      gitBranch: 'issue_runs.git_branch',
      startedAt: 'issue_runs.started_at',
      completedAt: 'issue_runs.completed_at',
      createdAt: 'issue_runs.created_at',
      updatedAt: 'issue_runs.updated_at',
    },
    projects: { id: 'projects.id' },
    ceremonySchedules: { workflowId: 'ceremony_schedules.workflow_id', id: 'ceremony_schedules.id' },
    agents: { projectId: 'agents.project_id', name: 'agents.name', role: 'agents.role' },
  };

  return {
    getDb: () => ({
      select: vi.fn(() => makeChain(selectQueue.shift() ?? [])),
      insert: vi.fn(() => makeChain([])),
      update: vi.fn(() => makeChain([])),
      delete: vi.fn(() => makeChain([])),
    }),
    schema,
  };
});

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((a, b) => ({ eq: [a, b] })),
  and: vi.fn((...args) => ({ and: args })),
  inArray: vi.fn((a, b) => ({ inArray: [a, b] })),
  desc: vi.fn((a) => ({ desc: a })),
  asc: vi.fn((a) => ({ asc: a })),
  gte: vi.fn((a, b) => ({ gte: [a, b] })),
  count: vi.fn(() => ({ count: true })),
  isNotNull: vi.fn((a) => ({ isNotNull: a })),
  sql: Object.assign(vi.fn(), { raw: vi.fn() }),
}));

vi.mock('../services/workflow-parser.js', () => ({
  parseWorkflowYaml: vi.fn(async () => ({ name: 'test', description: null, outputSchema: null })),
  validateWorkflowYaml: vi.fn(() => ({ valid: true, errors: [] })),
}));
vi.mock('../services/ceremony-origin.js', () => ({ deriveOrigin: vi.fn(() => 'yaml-import') }));
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
  TranslatorError: class TranslatorError extends Error {},
  TranslatorThrottledError: class TranslatorThrottledError extends Error {},
}));
vi.mock('../workflows/templates/index.js', () => ({ getBuiltinTemplates: vi.fn(() => []) }));
vi.mock('../services/ceremony-yaml-export.js', () => ({ exportCeremonyAsYaml: vi.fn() }));
vi.mock('../services/ceremony-yaml-import.js', () => ({ importCeremonyFromYaml: vi.fn() }));
vi.mock('../services/worktree-lifecycle.js', () => ({
  buildRunLifecycleMetadata: vi.fn(() => ({ model: 'squadboard.lifecycle.v1' })),
  resolveWorktreeExists: vi.fn(async () => false),
}));

type RouteHandler = (req: Record<string, unknown>, res: Record<string, unknown>) => unknown;

const handlers: Record<string, Record<string, RouteHandler>> = {};

vi.mock('express', () => ({
  Router: vi.fn(() => ({
    get: vi.fn((path: string, ...fns: RouteHandler[]) => {
      handlers.GET ??= {};
      handlers.GET[path] = fns[fns.length - 1]!;
    }),
    post: vi.fn((path: string, ...fns: RouteHandler[]) => {
      handlers.POST ??= {};
      handlers.POST[path] = fns[fns.length - 1]!;
    }),
    patch: vi.fn((path: string, ...fns: RouteHandler[]) => {
      handlers.PATCH ??= {};
      handlers.PATCH[path] = fns[fns.length - 1]!;
    }),
    delete: vi.fn((path: string, ...fns: RouteHandler[]) => {
      handlers.DELETE ??= {};
      handlers.DELETE[path] = fns[fns.length - 1]!;
    }),
  })),
}));

await import('../routes/ceremonies.js');

function makeReqRes() {
  const req = {
    params: { projectId: 'project-123' },
    query: {},
    body: {},
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
    getStatus: () => statusCode,
    getJson: () => jsonBody,
  };
  return { req, res };
}

function coreBuiltInRow(slug: 'work-pickup' | 'scribe-close-out', name: string) {
  const now = new Date('2026-05-20T13:00:00.000Z');
  return {
    id: `ceremony-${slug}`,
    projectId: 'project-123',
    name,
    slug,
    description: `${name} description`,
    triggerKind: slug === 'work-pickup' ? 'agent-signal' : 'manual',
    triggerConfig: {
      sourceYamlPath: `import:built-in/${slug}`,
      category: 'core',
      tags: ['core'],
    },
    kind: 'ceremony',
    status: 'active',
    parentNarrativeId: null,
    createdAt: now,
    updatedAt: now,
  };
}

describe('GET / ceremonies list', () => {
  beforeEach(() => {
    selectQueue = [];
  });

  it('returns core category and tags for Work Pickup and Scribe Close-Out', async () => {
    const handler = handlers.GET?.['/'];
    expect(handler).toBeDefined();

    pushSelect([
      coreBuiltInRow('work-pickup', 'Work Pickup'),
      coreBuiltInRow('scribe-close-out', 'Scribe Close-Out'),
    ]);
    pushSelect([]);
    pushSelect([
      { workflowId: 'ceremony-work-pickup', id: 'version-work-pickup' },
      { workflowId: 'ceremony-scribe-close-out', id: 'version-scribe-close-out' },
    ]);

    const { req, res } = makeReqRes();
    await handler(req, res);

    expect(res.getStatus()).toBe(200);
    const ceremonies = res.getJson() as Array<{
      slug: string;
      category?: string | null;
      tags?: string[];
    }>;
    const bySlug = new Map(ceremonies.map((ceremony) => [ceremony.slug, ceremony]));

    expect(bySlug.get('work-pickup')).toEqual(expect.objectContaining({
      category: 'core',
      tags: ['core'],
    }));
    expect(bySlug.get('scribe-close-out')).toEqual(expect.objectContaining({
      category: 'core',
      tags: ['core'],
    }));
  });
});
