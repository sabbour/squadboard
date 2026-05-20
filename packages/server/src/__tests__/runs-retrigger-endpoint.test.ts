/**
 * runs-retrigger-endpoint.test.ts — failed run retrigger regression.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

type SourceRun = {
  id: string;
  issueId: string;
  agentId: string;
  kind: string;
  status: string;
  workspaceStrategy: string;
  workspacePath: string | null;
  inputContext: string | null;
  agentName: string;
  agentStatus: string;
} | null;

let sourceRun: SourceRun = {
  id: 'run-1',
  issueId: 'issue-1',
  agentId: 'agent-1',
  kind: 'agent_run',
  status: 'failed',
  workspaceStrategy: 'scratch',
  workspacePath: null,
  inputContext: null,
  agentName: 'Kujan',
  agentStatus: 'active',
};
let activeRows: Array<{ id: string }> = [];
let selectCall = 0;
let insertedValues: Record<string, unknown> | null = null;

const emittedRunEvent = vi.hoisted(() => vi.fn());
const mockSelect = vi.hoisted(() => vi.fn());
const mockInsert = vi.hoisted(() => vi.fn());

function makeSelectChain(rows: unknown[]) {
  const chain = {
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    then: (onfulfilled: (value: unknown[]) => unknown) => Promise.resolve(rows).then(onfulfilled),
  };
  return chain;
}

function resetDbMocks() {
  selectCall = 0;
  mockSelect.mockClear();
  mockInsert.mockClear();
  mockSelect.mockImplementation(() => {
    selectCall += 1;
    if (selectCall === 1) return makeSelectChain(sourceRun ? [sourceRun] : []);
    return makeSelectChain(activeRows);
  });
  mockInsert.mockReturnValue({
    values: vi.fn((values: Record<string, unknown>) => {
      insertedValues = values;
      return {
        returning: vi.fn(async () => [{
          id: 'run-2',
          issueId: 'issue-1',
          agentId: values.agentId,
          status: 'pending',
          workspaceStrategy: values.workspaceStrategy,
        }]),
      };
    }),
  });
}

vi.mock('../db/index.js', () => ({
  getDb: () => ({ select: mockSelect, insert: mockInsert }),
  schema: {
    issueRuns: {
      id: 'issue_runs.id',
      issueId: 'issue_runs.issue_id',
      agentId: 'issue_runs.agent_id',
      kind: 'issue_runs.kind',
      status: 'issue_runs.status',
      workspaceStrategy: 'issue_runs.workspace_strategy',
      workspacePath: 'issue_runs.workspace_path',
      inputContext: 'issue_runs.input_context',
      createdAt: 'issue_runs.created_at',
    },
    issues: {
      id: 'issues.id',
      projectId: 'issues.project_id',
      status: 'issues.status',
    },
    agents: {
      id: 'agents.id',
      name: 'agents.name',
      status: 'agents.status',
      projectId: 'agents.project_id',
      role: 'agents.role',
    },
    issueRunEvents: {
      id: 'issue_run_events.id',
      runId: 'issue_run_events.run_id',
      seq: 'issue_run_events.seq',
      eventType: 'issue_run_events.event_type',
      payload: 'issue_run_events.payload',
      createdAt: 'issue_run_events.created_at',
    },
    projects: { id: 'projects.id', name: 'projects.name', description: 'projects.description' },
    labels: { name: 'labels.name', id: 'labels.id' },
    issueLabels: { issueId: 'issue_labels.issue_id', labelId: 'issue_labels.label_id' },
    agentKeywords: { agentId: 'agent_keywords.agent_id', keywords: 'agent_keywords.keywords', focusAreas: 'agent_keywords.focus_areas' },
    issueLinks: { parentIssueId: 'issue_links.parent_issue_id', childIssueId: 'issue_links.child_issue_id', linkType: 'issue_links.link_type' },
    routingRules: { projectId: 'routing_rules.project_id', rawRule: 'routing_rules.raw_rule', priority: 'routing_rules.priority' },
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
    emitRunEvent: emittedRunEvent,
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
  buildRunLifecycleMetadata: vi.fn(() => ({ model: 'squadboard.lifecycle.v1' })),
  resolveWorktreeExists: vi.fn(),
}));

import { issueRunsRouter } from '../routes/runs.js';

type RouteLayer = {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: (req: Request, res: Response, next: NextFunction) => void }>;
  };
};

function findHandler(path: string, method: 'get' | 'post') {
  const stack = (issueRunsRouter as unknown as { stack: RouteLayer[] }).stack;
  for (const layer of stack) {
    if (layer.route?.path === path && layer.route.methods[method]) {
      return layer.route.stack[0]?.handle;
    }
  }
  return null;
}

function makeReq() {
  return {
    params: { projectId: 'project-1', issueId: 'issue-1', runId: 'run-1' },
    query: {},
    body: {},
  };
}

function makeRes() {
  const res = {
    _status: 200,
    _body: null as unknown,
    status(code: number) {
      this._status = code;
      return this;
    },
    json(body: unknown) {
      this._body = body;
      return this;
    },
  };
  return res;
}

describe('POST /:runId/retrigger', () => {
  beforeEach(() => {
    sourceRun = {
      id: 'run-1',
      issueId: 'issue-1',
      agentId: 'agent-1',
      kind: 'agent_run',
      status: 'failed',
      workspaceStrategy: 'scratch',
      workspacePath: '/tmp/squadboard-run-run-1',
      inputContext: null,
      agentName: 'Kujan',
      agentStatus: 'active',
    };
    activeRows = [];
    insertedValues = null;
    emittedRunEvent.mockReset();
    resetDbMocks();
  });

  it('creates a fresh pending run from a failed run', async () => {
    const handler = findHandler('/:runId/retrigger', 'post');
    expect(handler).toBeDefined();
    const req = makeReq();
    const res = makeRes();

    await handler!(req as unknown as Request, res as unknown as Response, vi.fn() as NextFunction);

    expect(res._status).toBe(201);
    expect(insertedValues).toMatchObject({
      issueId: 'issue-1',
      agentId: 'agent-1',
      kind: 'agent_run',
      status: 'pending',
      workspaceStrategy: 'scratch',
      workspacePath: null,
    });
    expect((res._body as { id: string; retriggeredFromRunId: string }).id).toBe('run-2');
    expect((res._body as { retriggeredFromRunId: string }).retriggeredFromRunId).toBe('run-1');
    expect(emittedRunEvent).toHaveBeenCalledWith(
      'run.started',
      'project-1',
      expect.objectContaining({ retriggeredFromRunId: 'run-1' }),
    );
  });

  it('rejects retriggering a running run', async () => {
    sourceRun = { ...sourceRun!, status: 'running' };
    resetDbMocks();
    const handler = findHandler('/:runId/retrigger', 'post');
    const req = makeReq();
    const res = makeRes();

    await handler!(req as unknown as Request, res as unknown as Response, vi.fn() as NextFunction);

    expect(res._status).toBe(409);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('rejects when the card already has an active run', async () => {
    activeRows = [{ id: 'active-run' }];
    resetDbMocks();
    const handler = findHandler('/:runId/retrigger', 'post');
    const req = makeReq();
    const res = makeRes();

    await handler!(req as unknown as Request, res as unknown as Response, vi.fn() as NextFunction);

    expect(res._status).toBe(409);
    expect((res._body as { error: string }).error).toMatch(/already has/i);
  });
});
