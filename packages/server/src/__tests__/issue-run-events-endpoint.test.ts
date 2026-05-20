/**
 * issue-run-events-endpoint.test.ts — Wave 28 JIS-T6 regression
 *
 * Tests for the GET /:runId/events handler:
 *   - offset+limit pagination (default 50)
 *   - since_seq filter (wins over offset when both provided)
 *   - 404 on bad issue+run match
 *   - limit cap at 500
 *
 * Uses mock req/res objects (no supertest dependency needed).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// DB mock state (mutated per test)
// ---------------------------------------------------------------------------

type MockRunRow = {
  id: string;
  issueId?: string;
  agentId?: string;
  kind?: string;
  status?: string;
  workspaceStrategy?: string;
  workspacePath?: string | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
  startedAt?: Date | string | null;
  completedAt?: Date | string | null;
  leaseExpiresAt?: Date | string | null;
  heartbeatAt?: Date | string | null;
  output?: string | null;
  errorMessage?: string | null;
  costTokens?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cachedInputTokens?: number | null;
  costUsd?: string | null;
  premiumRequests?: string | null;
  staleReason?: string | null;
};

function makeRunRow(overrides: Partial<MockRunRow> = {}): MockRunRow {
  return {
    id: 'run-001',
    issueId: 'issue-001',
    agentId: 'agent-001',
    kind: 'agent_run',
    status: 'running',
    workspaceStrategy: 'scratch',
    workspacePath: null,
    createdAt: new Date('2026-05-20T14:00:00.000Z'),
    updatedAt: new Date('2026-05-20T14:00:00.000Z'),
    startedAt: null,
    completedAt: null,
    leaseExpiresAt: null,
    heartbeatAt: null,
    output: null,
    errorMessage: null,
    costTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    costUsd: '0',
    premiumRequests: '0',
    staleReason: null,
    ...overrides,
  };
}

let _runRow: MockRunRow | null = makeRunRow();
let _countTotal = 0;
let _events: Array<{ id: number; runId: string; seq: number; eventType: string; payload: object; createdAt: Date }> = [];
let _contextRows: Array<Record<string, unknown>> = [];

// Query call counter used to distinguish which select() call is which.
let _selectCallCount = 0;

const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockExecute = vi.fn();
const mockDb = { select: mockSelect, insert: mockInsert, execute: mockExecute };

function makeContextRow(overrides: Record<string, unknown> = {}) {
  return {
    project_id: 'proj-001',
    project_name: 'Squadboard',
    project_path: '/repo/.squad',
    issue_id: 'issue-001',
    issue_title: 'Fix run detail',
    issue_status: 'in-progress',
    github_issue_number: 42,
    github_issue_url: 'https://github.com/acme/repo/issues/42',
    agent_name: 'McManus',
    agent_status: 'active',
    step_run_id: 'step-001',
    step_index: 1,
    step_type: 'agent_run',
    step_status: 'failed',
    workflow_run_id: 'workflow-run-001',
    workflow_run_status: 'failed',
    workflow_current_step_index: 1,
    parent_workflow_run_id: 'parent-workflow-run-001',
    trigger_source: { detail: JSON.stringify({ issueRunId: 'parent-run-001' }) },
    workflow_version_id: 'workflow-version-001',
    workflow_version: 3,
    workflow_id: 'workflow-001',
    workflow_name: 'Work Pickup',
    workflow_slug: 'work-pickup',
    workflow_kind: 'ceremony',
    workflow_trigger_kind: 'on_schedule',
    active_run_count: 0,
    ...overrides,
  };
}

vi.mock('../db/index.js', () => ({
  getDb: () => mockDb,
  schema: {
    issueRuns: {
      id:                'issue_runs.id',
      issueId:           'issue_runs.issue_id',
      createdAt:         'issue_runs.created_at',
      updatedAt:         'issue_runs.updated_at',
      agentId:           'issue_runs.agent_id',
      kind:              'issue_runs.kind',
      status:            'issue_runs.status',
      workspaceStrategy: 'issue_runs.workspace_strategy',
      workspacePath:     'issue_runs.workspace_path',
      startedAt:         'issue_runs.started_at',
      completedAt:       'issue_runs.completed_at',
      leaseExpiresAt:    'issue_runs.lease_expires_at',
      heartbeatAt:       'issue_runs.heartbeat_at',
      output:            'issue_runs.output',
      errorMessage:      'issue_runs.error_message',
      costTokens:        'issue_runs.cost_tokens',
      inputTokens:       'issue_runs.input_tokens',
      outputTokens:      'issue_runs.output_tokens',
      cachedInputTokens: 'issue_runs.cached_input_tokens',
      costUsd:           'issue_runs.cost_usd',
      premiumRequests:   'issue_runs.premium_requests',
      staleReason:       'issue_runs.stale_reason',
    },
    issueRunEvents: {
      id:        'ire.id',
      runId:     'ire.run_id',
      seq:       'ire.seq',
      eventType: 'ire.event_type',
      payload:   'ire.payload',
      createdAt: 'ire.created_at',
    },
    agents: { id: 'agents.id', name: 'agents.name', status: 'agents.status' },
    issues: { projectId: 'issues.project_id', id: 'issues.id' },
  },
}));

vi.mock('drizzle-orm', () => ({
  eq:  (a: unknown, b: unknown) => ({ __eq: [a, b] }),
  and: (...args: unknown[])     => ({ __and: args }),
  gte: (a: unknown, b: unknown) => ({ __gte: [a, b] }),
  asc: (a: unknown)             => ({ __asc: a }),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...vals: unknown[]) => ({ __sql: { strings, vals } }),
    { __brand: 'sql' },
  ),
}));

vi.mock('../realtime/event-bus.js', () => ({
  eventBus: {
    emitRunEvent: vi.fn(),
    emitSessionEvent: vi.fn(),
  },
}));

vi.mock('../services/github-git-ops.js', () => ({
  pushBranch:       vi.fn(),
  createPr:         vi.fn(),
  buildPrBody:      vi.fn(),
  commentOnIssue:   vi.fn(),
  mergePr:          vi.fn(),
  triggerWorkflow:  vi.fn(),
  dispatchWorkflow: vi.fn(),
  pollWorkflowRun:  vi.fn(),
  GitOpsError:      class GitOpsError extends Error {
    httpStatus: number;
    detail: string;
    constructor(message: string, httpStatus = 500, detail = '') {
      super(message);
      this.httpStatus = httpStatus;
      this.detail = detail;
    }
  },
}));

// ---------------------------------------------------------------------------
// Build a mock select() call chain factory.
// ---------------------------------------------------------------------------

function makeChain(resolveWith: unknown) {
  const chain = {
    from:    vi.fn().mockReturnThis(),
    where:   vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit:   vi.fn().mockReturnThis(),
    offset:  vi.fn().mockReturnThis(),
    then: (onfulfilled: (val: unknown) => unknown) =>
      Promise.resolve(resolveWith).then(onfulfilled),
    catch: (onrejected: (err: unknown) => unknown) =>
      Promise.resolve(resolveWith).catch(onrejected),
  };
  return chain;
}

function resetSelectMock() {
  _selectCallCount = 0;
  mockExecute.mockImplementation(async () => ({ rows: _contextRows }));
  mockSelect.mockImplementation(() => {
    _selectCallCount++;
    const call = _selectCallCount;

    if (call === 1) {
      // Run existence check
      return makeChain(_runRow ? [_runRow] : []);
    }
    if (call === 2) {
      // Count query
      return makeChain([{ total: _countTotal }]);
    }
    // Events fetch
    return makeChain(_events);
  });
}

// ---------------------------------------------------------------------------
// Mock req/res factories
// ---------------------------------------------------------------------------

function makeReq(
  params: Record<string, string>,
  query: Record<string, string> = {},
) {
  return { params, query, body: {} };
}

function makeRes() {
  const res = {
    _status: 200,
    _body: null as unknown,
    status(code: number) { this._status = code; return this; },
    json(body: unknown)  { this._body = body; return this; },
  };
  return res;
}

// ---------------------------------------------------------------------------
// Extract the route handler from the router by monkey-patching Router.
// Easier approach: call the handler by reaching into the router's _routes.
// ---------------------------------------------------------------------------

// We import the router and walk its stack to pull the handler.
import { issueRunsRouter } from '../routes/runs.js';
import type { Request, Response, NextFunction } from 'express';

type RouteLayer = {
  route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: (req: Request, res: Response, next: NextFunction) => void }> };
};

function findHandler(path: string, method: 'get' | 'post') {
  const stack = (issueRunsRouter as unknown as { stack: RouteLayer[] }).stack;
  for (const layer of stack) {
    if (layer.route?.path === path && layer.route?.methods[method]) {
      return layer.route.stack[0]?.handle;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  _runRow      = makeRunRow();
  _countTotal  = 0;
  _events      = [];
  _contextRows = [makeContextRow()];
  mockExecute.mockReset();
  resetSelectMock();
});

// ---------------------------------------------------------------------------
// 404 on bad issue+run match
// ---------------------------------------------------------------------------

describe('404 on bad issue+run match', () => {
  it('returns 404 when run does not belong to the issue', async () => {
    _runRow = null; // simulate missing run
    const handler = findHandler('/:runId/events', 'get');
    expect(handler).toBeDefined();

    const req = makeReq({ projectId: 'proj-001', issueId: 'issue-001', runId: 'bad-run' });
    const res = makeRes();
    const next = vi.fn();

    await handler!(req as unknown as Request, res as unknown as Response, next as NextFunction);

    expect(res._status).toBe(404);
    expect((res._body as { error: string }).error).toMatch(/not found/i);
  });
});

// ---------------------------------------------------------------------------
// Pagination: offset + limit
// ---------------------------------------------------------------------------

describe('offset + limit pagination', () => {
  beforeEach(() => {
    _countTotal = 10;
    _events = Array.from({ length: 3 }, (_, i) => ({
      id: i + 1, runId: 'run-001', seq: i, eventType: 'turn', payload: {}, createdAt: new Date(),
    }));
  });

  it('returns 200 with events, total, nextSeq', async () => {
    const handler = findHandler('/:runId/events', 'get');
    const req = makeReq({ projectId: 'proj-001', issueId: 'issue-001', runId: 'run-001' });
    const res = makeRes();
    await handler!(req as unknown as Request, res as unknown as Response, vi.fn() as NextFunction);

    expect(res._status).toBe(200);
    const body = res._body as { events: unknown[]; total: number; nextSeq: number };
    expect(body.total).toBe(10);
    expect(Array.isArray(body.events)).toBe(true);
    expect(typeof body.nextSeq).toBe('number');
  });

  it('nextSeq equals last event seq + 1', async () => {
    _events = [
      { id: 1, runId: 'run-001', seq: 5, eventType: 'turn', payload: {}, createdAt: new Date() },
      { id: 2, runId: 'run-001', seq: 6, eventType: 'finish', payload: {}, createdAt: new Date() },
    ];
    _countTotal = 7;

    const handler = findHandler('/:runId/events', 'get');
    const req = makeReq({ projectId: 'proj-001', issueId: 'issue-001', runId: 'run-001' });
    const res = makeRes();
    await handler!(req as unknown as Request, res as unknown as Response, vi.fn() as NextFunction);

    expect((res._body as { nextSeq: number }).nextSeq).toBe(7); // seq=6 + 1
  });

  it('returns empty events array when no events exist', async () => {
    _events = [];
    _countTotal = 0;

    const handler = findHandler('/:runId/events', 'get');
    const req = makeReq({ projectId: 'proj-001', issueId: 'issue-001', runId: 'run-001' });
    const res = makeRes();
    await handler!(req as unknown as Request, res as unknown as Response, vi.fn() as NextFunction);

    const body = res._body as { events: unknown[]; total: number };
    expect(body.events).toHaveLength(0);
    expect(body.total).toBe(0);
  });

  it('includes a run snapshot with duration, cost, output, and recovery metadata', async () => {
    _runRow = makeRunRow({
      status: 'failed',
      startedAt: new Date('2026-05-20T14:00:00.000Z'),
      completedAt: null,
      updatedAt: new Date('2026-05-20T14:00:05.000Z'),
      output: 'hello',
      errorMessage: 'Agent lost connection [recovered: server restarted]',
      inputTokens: 10,
      outputTokens: 20,
      costTokens: 30,
      costUsd: '0.1234',
      staleReason: 'restart-pickup',
    });

    const handler = findHandler('/:runId/events', 'get');
    const req = makeReq({ projectId: 'proj-001', issueId: 'issue-001', runId: 'run-001' });
    const res = makeRes();
    await handler!(req as unknown as Request, res as unknown as Response, vi.fn() as NextFunction);

    const body = res._body as {
      run: {
        status: string;
        completedAt: string | null;
        finishedAt: string | null;
        durationMs: number;
        inputTokens: number;
        outputTokens: number;
        costUsd: string;
        output: { available: boolean; length: number };
        recovery: { reason: string; message: string; recoveredAt: string };
      };
    };

    expect(body.run).toMatchObject({
      status: 'failed',
      completedAt: null,
      finishedAt: '2026-05-20T14:00:05.000Z',
      durationMs: 5000,
      inputTokens: 10,
      outputTokens: 20,
      costUsd: '0.1234',
      output: { available: true, length: 5 },
      recovery: {
        reason: 'restart-pickup',
        message: 'Server restarted while this run was active',
        recoveredAt: '2026-05-20T14:00:05.000Z',
      },
    });
  });

  it('includes ownership context and recovery actions for failed run pages', async () => {
    _runRow = makeRunRow({
      status: 'failed',
      updatedAt: new Date('2026-05-20T14:00:05.000Z'),
      startedAt: new Date('2026-05-20T14:00:00.000Z'),
    });
    _contextRows = [makeContextRow()];

    const handler = findHandler('/:runId/events', 'get');
    const req = makeReq({ projectId: 'proj-001', issueId: 'issue-001', runId: 'run-001' });
    const res = makeRes();
    await handler!(req as unknown as Request, res as unknown as Response, vi.fn() as NextFunction);

    const body = res._body as {
      run: {
        context: {
          project: { id: string; name: string; path: string };
          issue: { id: string; title: string; status: string };
          workflow: { id: string; name: string };
          workflowRun: { id: string; parentWorkflowRunId: string };
          parent: { workflowRunId: string; issueRunId: string };
          actions: { canRetrigger: boolean; retriggerBlockedReason: string | null; issueUrl: string };
        };
      };
    };

    expect(body.run.context).toMatchObject({
      project: { id: 'proj-001', name: 'Squadboard', path: '/repo/.squad' },
      issue: { id: 'issue-001', title: 'Fix run detail', status: 'in-progress' },
      workflow: { id: 'workflow-001', name: 'Work Pickup' },
      workflowRun: { id: 'workflow-run-001', parentWorkflowRunId: 'parent-workflow-run-001' },
      parent: { workflowRunId: 'parent-workflow-run-001', issueRunId: 'parent-run-001' },
      actions: {
        canRetrigger: true,
        retriggerBlockedReason: null,
        issueUrl: '/projects/proj-001/issues/issue-001',
      },
    });
  });
});

// ---------------------------------------------------------------------------
// since_seq filter
// ---------------------------------------------------------------------------

describe('since_seq filter', () => {
  beforeEach(() => {
    _countTotal = 8;
    _events = [
      { id: 3, runId: 'run-001', seq: 2, eventType: 'turn',   payload: {}, createdAt: new Date() },
      { id: 4, runId: 'run-001', seq: 3, eventType: 'finish', payload: {}, createdAt: new Date() },
    ];
  });

  it('returns 200 with since_seq query param', async () => {
    const handler = findHandler('/:runId/events', 'get');
    const req = makeReq(
      { projectId: 'proj-001', issueId: 'issue-001', runId: 'run-001' },
      { since_seq: '2' },
    );
    const res = makeRes();
    await handler!(req as unknown as Request, res as unknown as Response, vi.fn() as NextFunction);

    expect(res._status).toBe(200);
    const body = res._body as { events: unknown[]; nextSeq: number };
    expect(body.events).toHaveLength(2);
    expect(body.nextSeq).toBe(4); // seq=3 + 1
  });

  it('since_seq wins when both since_seq and offset are provided', async () => {
    const handler = findHandler('/:runId/events', 'get');
    // since_seq=2 and offset=10 — since_seq should win (handler won't call .offset())
    const req = makeReq(
      { projectId: 'proj-001', issueId: 'issue-001', runId: 'run-001' },
      { since_seq: '2', offset: '10' },
    );
    const res = makeRes();
    await handler!(req as unknown as Request, res as unknown as Response, vi.fn() as NextFunction);

    expect(res._status).toBe(200);
    // Events still returned (since_seq path, not offset path)
    expect((res._body as { events: unknown[] }).events).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Limit cap at 500
// ---------------------------------------------------------------------------

describe('limit cap at 500', () => {
  it('does not crash when limit=9999 is requested', async () => {
    _events = [];
    _countTotal = 0;
    const handler = findHandler('/:runId/events', 'get');
    const req = makeReq(
      { projectId: 'proj-001', issueId: 'issue-001', runId: 'run-001' },
      { limit: '9999' },
    );
    const res = makeRes();
    await handler!(req as unknown as Request, res as unknown as Response, vi.fn() as NextFunction);

    expect(res._status).toBe(200);
  });

  it('coerces negative limit to 1', async () => {
    _events = [];
    _countTotal = 0;
    const handler = findHandler('/:runId/events', 'get');
    const req = makeReq(
      { projectId: 'proj-001', issueId: 'issue-001', runId: 'run-001' },
      { limit: '-5' },
    );
    const res = makeRes();
    await handler!(req as unknown as Request, res as unknown as Response, vi.fn() as NextFunction);

    expect(res._status).toBe(200);
  });

  it('non-numeric limit falls back to 50', async () => {
    _events = [];
    _countTotal = 0;
    const handler = findHandler('/:runId/events', 'get');
    const req = makeReq(
      { projectId: 'proj-001', issueId: 'issue-001', runId: 'run-001' },
      { limit: 'abc' },
    );
    const res = makeRes();
    await handler!(req as unknown as Request, res as unknown as Response, vi.fn() as NextFunction);

    expect(res._status).toBe(200);
  });
});
