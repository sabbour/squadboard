/**
 * steer-endpoint.test.ts — Wave 28 JIS-T4 regression
 *
 * Tests for POST /:runId/steer:
 *   - 400 on missing / empty message body
 *   - 404 when run does not belong to the issue
 *   - 404 when issue does not belong to the project
 *   - 409 when run status is not 'running'
 *   - 404 when run is not in the active-session registry
 *   - 200 success path returns { ok: true, eventSeq: N }
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// DB mock state (mutated per test)
// ---------------------------------------------------------------------------

type RunRow  = { id: string; status: string; issueId: string } | null;
type IssueRow = { id: string } | null;

let _runRow: RunRow   = { id: 'run-001', status: 'running', issueId: 'issue-001' };
let _issueRow: IssueRow = { id: 'issue-001' };
let _maxSeq = 3;

let _selectCallCount = 0;
const mockSelect = vi.fn();

// ---------------------------------------------------------------------------
// Chainable query builder factory
// ---------------------------------------------------------------------------

function makeChain(resolveWith: unknown) {
  return {
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
}

function resetSelectMock() {
  _selectCallCount = 0;
  mockSelect.mockImplementation(() => {
    const call = ++_selectCallCount;
    if (call === 1) return makeChain(_runRow  ? [_runRow]  : []);  // run lookup
    if (call === 2) return makeChain(_issueRow ? [_issueRow] : []); // issue lookup
    // call 3: max(seq) query
    return makeChain([{ maxSeq: _maxSeq }]);
  });
}

const mockInsert = vi.fn().mockReturnValue({
  values: vi.fn().mockResolvedValue(undefined),
});

const mockDb = { select: mockSelect, insert: mockInsert };

vi.mock('../db/index.js', () => ({
  getDb: () => mockDb,
  schema: {
    issueRuns: {
      id:      'issue_runs.id',
      issueId: 'issue_runs.issue_id',
      status:  'issue_runs.status',
    },
    issueRunEvents: {
      id:        'ire.id',
      runId:     'ire.run_id',
      seq:       'ire.seq',
      eventType: 'ire.event_type',
      payload:   'ire.payload',
      createdAt: 'ire.created_at',
    },
    issues: {
      id:        'issues.id',
      projectId: 'issues.project_id',
    },
    agents: { id: 'agents.id', name: 'agents.name', status: 'agents.status' },
    projects: { id: 'projects.id', githubOwner: 'projects.github_owner', githubRepo: 'projects.github_repo' },
  },
}));

// ---------------------------------------------------------------------------
// Drizzle-orm mock
// ---------------------------------------------------------------------------

vi.mock('drizzle-orm', () => ({
  eq:  (a: unknown, b: unknown) => ({ __eq: [a, b] }),
  and: (...args: unknown[])     => ({ __and: args }),
  gte: (a: unknown, b: unknown) => ({ __gte: [a, b] }),
  asc: (a: unknown)             => ({ __asc: a }),
  max: (a: unknown)             => ({ __max: a }),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...vals: unknown[]) => ({ __sql: { strings, vals } }),
    { __brand: 'sql' },
  ),
}));

// ---------------------------------------------------------------------------
// Event bus mock
// ---------------------------------------------------------------------------

vi.mock('../realtime/event-bus.js', () => ({
  eventBus: {
    emitRunEvent:       vi.fn(),
    emitSessionEvent:   vi.fn(),
    emitIssueRunEvent:  vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// activeIssueSessions mock — controllable per test
// ---------------------------------------------------------------------------

let _mockSession: { steer: ReturnType<typeof vi.fn> } | null = null;

vi.mock('../engine/active-issue-sessions.js', () => ({
  register:   vi.fn(),
  unregister: vi.fn(),
  get:        vi.fn(() => _mockSession),
  list:       vi.fn(() => []),
}));

// ---------------------------------------------------------------------------
// github-git-ops mock (required by runs.ts)
// ---------------------------------------------------------------------------

vi.mock('../services/github-git-ops.js', () => ({
  pushBranch:       vi.fn(),
  createPr:         vi.fn(),
  buildPrBody:      vi.fn(),
  commentOnIssue:   vi.fn(),
  mergePr:          vi.fn(),
  triggerWorkflow:  vi.fn(),
  dispatchWorkflow: vi.fn(),
  pollWorkflowRun:  vi.fn(),
  GitOpsError: class GitOpsError extends Error {
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
// Import router after mocks
// ---------------------------------------------------------------------------

import { issueRunsRouter } from '../routes/runs.js';
import type { Request, Response, NextFunction } from 'express';

// ---------------------------------------------------------------------------
// Router introspection helpers (mirrors other endpoint tests)
// ---------------------------------------------------------------------------

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
    if (layer.route?.path === path && layer.route?.methods[method]) {
      return layer.route.stack[0]?.handle;
    }
  }
  return null;
}

function makeReq(
  params: Record<string, string>,
  body: Record<string, unknown> = {},
) {
  return { params, query: {}, body };
}

function makeRes() {
  const res = {
    _status: 200,
    _body: null as unknown,
    status(code: number) { this._status = code; return this; },
    json(body: unknown)  { this._body  = body; return this; },
  };
  return res;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  _runRow   = { id: 'run-001', status: 'running', issueId: 'issue-001' };
  _issueRow = { id: 'issue-001' };
  _maxSeq   = 3;
  _mockSession = { steer: vi.fn().mockResolvedValue(undefined) };
  resetSelectMock();
  // Restore insert mock
  mockInsert.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
});

// ---------------------------------------------------------------------------
// Verify the handler is registered
// ---------------------------------------------------------------------------

describe('route registration', () => {
  it('POST /:runId/steer handler is registered', () => {
    const handler = findHandler('/:runId/steer', 'post');
    expect(handler).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 400 — missing / invalid message
// ---------------------------------------------------------------------------

describe('400 — bad request body', () => {
  it('returns 400 when message is missing from body', async () => {
    const handler = findHandler('/:runId/steer', 'post');
    const req = makeReq({ projectId: 'proj-001', issueId: 'issue-001', runId: 'run-001' }, {});
    const res = makeRes();
    await handler!(req as unknown as Request, res as unknown as Response, vi.fn() as NextFunction);
    expect(res._status).toBe(400);
  });

  it('returns 400 when message is an empty string', async () => {
    const handler = findHandler('/:runId/steer', 'post');
    const req = makeReq({ projectId: 'proj-001', issueId: 'issue-001', runId: 'run-001' }, { message: '' });
    const res = makeRes();
    await handler!(req as unknown as Request, res as unknown as Response, vi.fn() as NextFunction);
    expect(res._status).toBe(400);
  });

  it('returns 400 when message is whitespace-only', async () => {
    const handler = findHandler('/:runId/steer', 'post');
    const req = makeReq({ projectId: 'proj-001', issueId: 'issue-001', runId: 'run-001' }, { message: '   ' });
    const res = makeRes();
    await handler!(req as unknown as Request, res as unknown as Response, vi.fn() as NextFunction);
    expect(res._status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// 404 — run not found
// ---------------------------------------------------------------------------

describe('404 — run not found', () => {
  it('returns 404 when run does not belong to the issue', async () => {
    _runRow = null;
    resetSelectMock();
    const handler = findHandler('/:runId/steer', 'post');
    const req = makeReq(
      { projectId: 'proj-001', issueId: 'issue-001', runId: 'bad-run' },
      { message: 'steer me' },
    );
    const res = makeRes();
    await handler!(req as unknown as Request, res as unknown as Response, vi.fn() as NextFunction);
    expect(res._status).toBe(404);
    expect((res._body as { error: string }).error).toMatch(/run not found/i);
  });

  it('returns 404 when issue does not belong to the project', async () => {
    _issueRow = null;
    resetSelectMock();
    const handler = findHandler('/:runId/steer', 'post');
    const req = makeReq(
      { projectId: 'wrong-proj', issueId: 'issue-001', runId: 'run-001' },
      { message: 'steer me' },
    );
    const res = makeRes();
    await handler!(req as unknown as Request, res as unknown as Response, vi.fn() as NextFunction);
    expect(res._status).toBe(404);
    expect((res._body as { error: string }).error).toMatch(/issue not found/i);
  });

  it('returns 404 when run is not in the active session registry', async () => {
    _mockSession = null;
    const handler = findHandler('/:runId/steer', 'post');
    const req = makeReq(
      { projectId: 'proj-001', issueId: 'issue-001', runId: 'run-001' },
      { message: 'steer me' },
    );
    const res = makeRes();
    await handler!(req as unknown as Request, res as unknown as Response, vi.fn() as NextFunction);
    expect(res._status).toBe(404);
    expect((res._body as { error: string }).error).toMatch(/not active/i);
  });
});

// ---------------------------------------------------------------------------
// 409 — run not in 'running' status
// ---------------------------------------------------------------------------

describe('409 — run not running', () => {
  it('returns 409 when run status is completed', async () => {
    _runRow = { id: 'run-001', status: 'completed', issueId: 'issue-001' };
    resetSelectMock();
    const handler = findHandler('/:runId/steer', 'post');
    const req = makeReq(
      { projectId: 'proj-001', issueId: 'issue-001', runId: 'run-001' },
      { message: 'too late' },
    );
    const res = makeRes();
    await handler!(req as unknown as Request, res as unknown as Response, vi.fn() as NextFunction);
    expect(res._status).toBe(409);
    expect((res._body as { error: string }).error).toMatch(/not active/i);
  });

  it('returns 409 when run status is failed', async () => {
    _runRow = { id: 'run-001', status: 'failed', issueId: 'issue-001' };
    resetSelectMock();
    const handler = findHandler('/:runId/steer', 'post');
    const req = makeReq(
      { projectId: 'proj-001', issueId: 'issue-001', runId: 'run-001' },
      { message: 'too late' },
    );
    const res = makeRes();
    await handler!(req as unknown as Request, res as unknown as Response, vi.fn() as NextFunction);
    expect(res._status).toBe(409);
  });

  it('returns 409 when run status is pending', async () => {
    _runRow = { id: 'run-001', status: 'pending', issueId: 'issue-001' };
    resetSelectMock();
    const handler = findHandler('/:runId/steer', 'post');
    const req = makeReq(
      { projectId: 'proj-001', issueId: 'issue-001', runId: 'run-001' },
      { message: 'too early' },
    );
    const res = makeRes();
    await handler!(req as unknown as Request, res as unknown as Response, vi.fn() as NextFunction);
    expect(res._status).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// 200 success
// ---------------------------------------------------------------------------

describe('200 — success path', () => {
  it('returns { ok: true, eventSeq: N } on success', async () => {
    const handler = findHandler('/:runId/steer', 'post');
    const req = makeReq(
      { projectId: 'proj-001', issueId: 'issue-001', runId: 'run-001' },
      { message: 'please summarise' },
    );
    const res = makeRes();
    await handler!(req as unknown as Request, res as unknown as Response, vi.fn() as NextFunction);

    expect(res._status).toBe(200);
    const body = res._body as { ok: boolean; eventSeq: number };
    expect(body.ok).toBe(true);
    expect(typeof body.eventSeq).toBe('number');
  });

  it('calls session.steer() with message and actor', async () => {
    const steerFn = vi.fn().mockResolvedValue(undefined);
    _mockSession = { steer: steerFn };
    const handler = findHandler('/:runId/steer', 'post');
    const req = makeReq(
      { projectId: 'proj-001', issueId: 'issue-001', runId: 'run-001' },
      { message: 'redirect focus', actor: 'pm-bot' },
    );
    const res = makeRes();
    await handler!(req as unknown as Request, res as unknown as Response, vi.fn() as NextFunction);

    expect(steerFn).toHaveBeenCalledWith('redirect focus', 'pm-bot');
  });

  it('returns eventSeq = maxSeq from DB', async () => {
    _maxSeq = 7;
    resetSelectMock();
    const handler = findHandler('/:runId/steer', 'post');
    const req = makeReq(
      { projectId: 'proj-001', issueId: 'issue-001', runId: 'run-001' },
      { message: 'go faster' },
    );
    const res = makeRes();
    await handler!(req as unknown as Request, res as unknown as Response, vi.fn() as NextFunction);
    expect((res._body as { eventSeq: number }).eventSeq).toBe(7);
  });

  it('accepts optional actor field', async () => {
    const steerFn = vi.fn().mockResolvedValue(undefined);
    _mockSession = { steer: steerFn };
    const handler = findHandler('/:runId/steer', 'post');
    const req = makeReq(
      { projectId: 'proj-001', issueId: 'issue-001', runId: 'run-001' },
      { message: 'no actor provided' },
      // no actor
    );
    const res = makeRes();
    await handler!(req as unknown as Request, res as unknown as Response, vi.fn() as NextFunction);
    // actor is undefined; steer is called with undefined actor (which the impl defaults to 'user')
    expect(steerFn).toHaveBeenCalledWith('no actor provided', undefined);
    expect(res._status).toBe(200);
  });
});
