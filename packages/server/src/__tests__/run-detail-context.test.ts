import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';

const runRow = {
  id: 'run-001',
  issueId: 'issue-001',
  agentId: 'agent-001',
  kind: 'agent_run',
  status: 'failed',
  workspaceStrategy: 'scratch',
  workspacePath: null,
  createdAt: new Date('2026-05-20T14:00:00.000Z'),
  updatedAt: new Date('2026-05-20T14:00:05.000Z'),
  startedAt: new Date('2026-05-20T14:00:00.000Z'),
  completedAt: null,
  leaseExpiresAt: null,
  heartbeatAt: null,
  output: null,
  errorMessage: 'Timeout',
  costTokens: 0,
  inputTokens: 0,
  outputTokens: 0,
  cachedInputTokens: 0,
  costUsd: '0',
  premiumRequests: '0',
  staleReason: null,
};

const contextRow = {
  project_id: 'proj-001',
  project_name: 'Squadboard',
  project_path: '/repo/.squad',
  issue_id: 'issue-001',
  issue_title: 'Recover failed run',
  issue_status: 'in-progress',
  github_issue_number: null,
  github_issue_url: null,
  agent_name: 'McManus',
  agent_status: 'active',
  step_run_id: null,
  step_index: null,
  step_type: null,
  step_status: null,
  workflow_run_id: null,
  workflow_run_status: null,
  workflow_current_step_index: null,
  parent_workflow_run_id: null,
  trigger_source: null,
  workflow_version_id: null,
  workflow_version: null,
  workflow_id: null,
  workflow_name: null,
  workflow_slug: null,
  workflow_kind: null,
  workflow_trigger_kind: null,
  active_run_count: 0,
};

const {
  mockSelect,
  mockExecute,
  mockResolveWorktreeExists,
  mockBuildRunLifecycleMetadata,
} = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockExecute: vi.fn(),
  mockResolveWorktreeExists: vi.fn(),
  mockBuildRunLifecycleMetadata: vi.fn(),
}));

function makeChain(rows: unknown[]) {
  return {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    then: (onfulfilled: (val: unknown[]) => unknown) => Promise.resolve(rows).then(onfulfilled),
  };
}

vi.mock('../db/index.js', () => ({
  getDb: () => ({ select: mockSelect, execute: mockExecute }),
  schema: {
    issueRuns: {
      id: 'issue_runs.id',
      issueId: 'issue_runs.issue_id',
    },
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: (a: unknown, b: unknown) => ({ eq: [a, b] }),
  and: (...args: unknown[]) => ({ and: args }),
  gte: (a: unknown, b: unknown) => ({ gte: [a, b] }),
  asc: (a: unknown) => ({ asc: a }),
  max: (a: unknown) => ({ max: a }),
  inArray: (a: unknown, b: unknown) => ({ inArray: [a, b] }),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...vals: unknown[]) => ({ sql: [strings, vals] }),
    { raw: vi.fn() },
  ),
}));

vi.mock('../realtime/event-bus.js', () => ({
  eventBus: {
    emitRunEvent: vi.fn(),
    emitSessionEvent: vi.fn(),
    emitIssueRunEvent: vi.fn(),
  },
}));

vi.mock('../engine/active-issue-sessions.js', () => ({
  register: vi.fn(),
  unregister: vi.fn(),
  get: vi.fn(),
  list: vi.fn(() => []),
}));

vi.mock('../services/github-git-ops.js', () => ({
  pushBranch: vi.fn(),
  createPr: vi.fn(),
  buildPrBody: vi.fn(),
  commentOnIssue: vi.fn(),
  mergePr: vi.fn(),
  triggerWorkflow: vi.fn(),
  dispatchWorkflow: vi.fn(),
  pollWorkflowRun: vi.fn(),
  GitOpsError: class GitOpsError extends Error {
    httpStatus = 500;
    detail = '';
  },
}));

vi.mock('../config/coordinator-env.js', () => ({ isCoordinatorDispatchEnabled: vi.fn(() => false) }));
vi.mock('../coordinator/index.js', () => ({
  applyDeterministicPrefilters: vi.fn(),
  buildCoordinatorInput: vi.fn(),
  buildDeterministicCoordinatorMeta: vi.fn(),
  capabilityMapFromAgentKeywords: vi.fn(() => new Map()),
  dispatchViaCoordinator: vi.fn(),
  filterBlockedAgents: vi.fn((input) => ({ input })),
}));
vi.mock('../services/coordinator-decision-log.js', () => ({ persistCoordinatorDecision: vi.fn() }));
vi.mock('../services/coordinator-routing-log.js', () => ({ persistCoordinatorRoutingDecision: vi.fn() }));
vi.mock('../services/worktree-lifecycle.js', () => ({
  buildRunLifecycleMetadata: mockBuildRunLifecycleMetadata,
  resolveWorktreeExists: mockResolveWorktreeExists,
}));

import { projectRunsRouter } from '../routes/runs.js';

type RouteLayer = {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: (req: Request, res: Response, next: NextFunction) => void }>;
  };
};

function findHandler(path: string, method: 'get' | 'post') {
  const stack = (projectRunsRouter as unknown as { stack: RouteLayer[] }).stack;
  for (const layer of stack) {
    if (layer.route?.path === path && layer.route.methods[method]) {
      return layer.route.stack[0]?.handle;
    }
  }
  return null;
}

function makeRes() {
  const res = {
    _status: 200,
    _body: null as unknown,
    status(code: number) { this._status = code; return this; },
    json(body: unknown) { this._body = body; return this; },
  };
  return res;
}

describe('GET /:runId run detail context', () => {
  beforeEach(() => {
    mockSelect.mockReset();
    mockSelect.mockReturnValue(makeChain([runRow]));
    mockExecute.mockReset();
    mockExecute.mockResolvedValue({ rows: [contextRow] });
    mockResolveWorktreeExists.mockReset();
    mockResolveWorktreeExists.mockResolvedValue(false);
    mockBuildRunLifecycleMetadata.mockReset();
    mockBuildRunLifecycleMetadata.mockReturnValue({ model: 'squadboard.lifecycle.v1' });
  });

  it('returns ownership context and retrigger eligibility for recovery navigation', async () => {
    const handler = findHandler('/:runId', 'get');
    expect(handler).toBeDefined();

    const req = { params: { projectId: 'proj-001', runId: 'run-001' } };
    const res = makeRes();

    await handler!(req as unknown as Request, res as unknown as Response, vi.fn() as NextFunction);

    expect(res._status).toBe(200);
    expect(res._body).toMatchObject({
      id: 'run-001',
      finishedAt: '2026-05-20T14:00:05.000Z',
      durationMs: 5000,
      context: {
        project: { id: 'proj-001', name: 'Squadboard', path: '/repo/.squad' },
        issue: { id: 'issue-001', title: 'Recover failed run', status: 'in-progress' },
        workflow: null,
        workflowRun: null,
        parent: { workflowRunId: null, issueRunId: null },
        actions: {
          canRetrigger: true,
          retriggerBlockedReason: null,
          retriggerUrl: '/api/projects/proj-001/issues/issue-001/runs/run-001/retrigger',
          issueUrl: '/projects/proj-001/issues/issue-001',
          projectUrl: '/projects/proj-001',
        },
      },
      lifecycle: { model: 'squadboard.lifecycle.v1' },
    });
  });
});
