/**
 * runs-coordinator-dispatch.test.ts — W29 MC-8 regression
 *
 * Tests for the POST /api/projects/:projectId/issues/:issueId/runs handler:
 *
 *   1. POST with agentId → existing behavior (unchanged)
 *   2. POST without agentId, flag enabled, coordinator dispatches → 201
 *   3. POST without agentId, flag DISABLED → 400 with helpful error
 *   4. POST without agentId, coordinator skips → 422
 *   5. POST without agentId, coordinator ambiguous → 409 with candidates
 *   6. POST without agentId, coordinator throws → 503
 *   7. POST with model + no agentId → model passed to dispatchViaCoordinator
 *   8. POST with agentId AND model → agentId wins, model ignored (warn logged)
 *
 * Uses vi.mock for coordinator and config so no real LLM calls are made.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Coordinator mocks — set up BEFORE importing the route
// ---------------------------------------------------------------------------

const mockDispatchViaCoordinator = vi.fn();
vi.mock('../coordinator/index.js', () => ({
  dispatchViaCoordinator: (...args: unknown[]) => mockDispatchViaCoordinator(...args),
  buildCoordinatorInput: (params: {
    issue: { id: string; title: string; body?: string | null; status: string; createdAt: Date };
    labels: string[];
    project: { id: string; name: string; description?: string | null };
    agents: Array<{ id: string; name: string; role: string; charterHash?: string | null; charterContent: string }>;
    busyAgentIds?: Set<string>;
    recentRuns?: unknown[];
    parentIssueIds?: string[];
    blockedParentIssueIds?: string[];
    projectRules?: string;
  }) => ({
    issue: {
      id: params.issue.id,
      title: params.issue.title,
      body: params.issue.body ?? null,
      labels: params.labels,
      column: params.issue.status,
      parentId: params.parentIssueIds?.[0] ?? null,
      blockedParentIds: params.blockedParentIssueIds ?? [],
      priority: null,
      createdAt: params.issue.createdAt.toISOString(),
    },
    candidateAgents: params.agents.map((agent) => ({
      name: agent.name,
      role: agent.role,
      charterHash: agent.charterHash ?? '',
      charterContent: agent.charterContent,
      capabilities: [],
      available: !params.busyAgentIds?.has(agent.id),
    })),
    project: { id: params.project.id, name: params.project.name, rules: params.projectRules ?? '' },
    recentRuns: params.recentRuns ?? [],
  }),
  capabilityMapFromAgentKeywords: () => new Map(),
  filterBlockedAgents: (input: { candidateAgents: Array<{ name: string }> }, blocked: Set<string>) => {
    const candidateAgents = input.candidateAgents.filter((agent) => !blocked.has(agent.name));
    if (candidateAgents.length === 0 && input.candidateAgents.length > 0) {
      return { input, decision: { kind: 'skip', reason: 'blocked' } };
    }
    return { input: { ...input, candidateAgents }, decision: null };
  },
  applyDeterministicPrefilters: () => null,
  buildDeterministicCoordinatorMeta: () => ({
    model: 'deterministic-prefilter',
    promptTokens: 0,
    completionTokens: 0,
    durationMs: 0,
    cacheHit: false,
    inputHash: 'a'.repeat(64),
  }),
}));

let _coordinatorEnabled = true;
vi.mock('../config/coordinator-env.js', () => ({
  isCoordinatorDispatchEnabled: () => _coordinatorEnabled,
}));

// ---------------------------------------------------------------------------
// DB mock state
// ---------------------------------------------------------------------------

// Select call counter — incremented on each .select() invocation in a test.
let _selectCallCount = 0;
const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockDb = { select: mockSelect, insert: mockInsert };

vi.mock('../db/index.js', () => ({
  getDb: () => mockDb,
  schema: {
    agents: {
      id:             'agents.id',
      name:           'agents.name',
      role:           'agents.role',
      status:         'agents.status',
      charterHash:    'agents.charter_hash',
      charterContent: 'agents.charter_content',
      projectId:      'agents.project_id',
    },
    issues: {
      id:        'issues.id',
      projectId: 'issues.project_id',
      title:     'issues.title',
      body:      'issues.body',
      status:    'issues.status',
      createdAt: 'issues.created_at',
      archived:  'issues.archived',
    },
    projects: {
      id:          'projects.id',
      name:        'projects.name',
      description: 'projects.description',
    },
    issueRuns: {
      id:               'issue_runs.id',
      issueId:          'issue_runs.issue_id',
      agentId:          'issue_runs.agent_id',
      status:           'issue_runs.status',
      createdAt:        'issue_runs.created_at',
      startedAt:        'issue_runs.started_at',
      completedAt:      'issue_runs.completed_at',
    },
    issueLabels: {
      issueId: 'issue_labels.issue_id',
      labelId: 'issue_labels.label_id',
    },
    labels: {
      id:   'labels.id',
      name: 'labels.name',
    },
    agentKeywords: {
      agentId:    'agent_keywords.agent_id',
      keywords:   'agent_keywords.keywords',
      focusAreas: 'agent_keywords.focus_areas',
    },
    issueLinks: {
      childIssueId:  'issue_links.child_issue_id',
      parentIssueId: 'issue_links.parent_issue_id',
      linkType:      'issue_links.link_type',
    },
    routingRules: {
      projectId: 'routing_rules.project_id',
      rawRule:   'routing_rules.raw_rule',
      priority:  'routing_rules.priority',
    },
  },
}));

vi.mock('drizzle-orm', () => ({
  eq:  (a: unknown, b: unknown) => ({ __eq: [a, b] }),
  and: (...args: unknown[])     => ({ __and: args }),
  inArray: (a: unknown, b: unknown[]) => ({ __inArray: [a, b] }),
  gte: (a: unknown, b: unknown) => ({ __gte: [a, b] }),
  asc: (a: unknown)             => ({ __asc: a }),
  max: (a: unknown)             => ({ __max: a }),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...vals: unknown[]) => ({ __sql: { strings, vals } }),
    { __brand: 'sql' },
  ),
}));

vi.mock('../realtime/event-bus.js', () => ({
  eventBus: { emitRunEvent: vi.fn(), emitSessionEvent: vi.fn() },
}));

vi.mock('../engine/active-issue-sessions.js', () => ({
  getSession: vi.fn().mockReturnValue(null),
}));

vi.mock('../services/github-git-ops.js', () => ({
  pushBranch: vi.fn(), createPr: vi.fn(), buildPrBody: vi.fn(),
  commentOnIssue: vi.fn(), mergePr: vi.fn(), triggerWorkflow: vi.fn(),
  dispatchWorkflow: vi.fn(), pollWorkflowRun: vi.fn(),
  GitOpsError: class GitOpsError extends Error {
    httpStatus: number; detail: string;
    constructor(message: string, httpStatus = 500, detail = '') {
      super(message); this.httpStatus = httpStatus; this.detail = detail;
    }
  },
}));

// MC-10: mock the decision-log service — the route calls it fire-and-forget.
vi.mock('../services/coordinator-decision-log.js', () => ({
  persistCoordinatorDecision: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../services/coordinator-routing-log.js', () => ({
  persistCoordinatorRoutingDecision: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Import router AFTER mocks
// ---------------------------------------------------------------------------

import { issueRunsRouter } from '../routes/runs.js';
import type { Request, Response, NextFunction } from 'express';

// ---------------------------------------------------------------------------
// Router introspection helpers
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
  query: Record<string, string> = {},
) {
  return { params, query, body };
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

// ---------------------------------------------------------------------------
// Standard fixture data
// ---------------------------------------------------------------------------

const ISSUE_ID   = 'issue-abc';
const PROJECT_ID = 'proj-xyz';
const AGENT_ID   = 'agent-verbal';
const AGENT_NAME = 'verbal';

const ISSUE_ROW = {
  id: ISSUE_ID, projectId: PROJECT_ID,
  title: 'Implement feature X', body: 'Do the thing',
  status: 'Ready', createdAt: new Date('2026-01-01T00:00:00Z'),
};
const PROJECT_ROW = { id: PROJECT_ID, name: 'Squadboard', description: 'Ship fast' };
const AGENT_ROW   = {
  id: AGENT_ID, name: AGENT_NAME, role: 'implementer', status: 'active',
  charterHash: 'abc12345', charterContent: '# Verbal\nImplements features.',
  projectId: PROJECT_ID,
};
const RUN_ROW = {
  id: 'run-001', issueId: ISSUE_ID, agentId: AGENT_ID,
  status: 'pending', createdAt: new Date(),
};

// ---------------------------------------------------------------------------
// Select mock builder helpers
// ---------------------------------------------------------------------------

/** Chainable drizzle-like select chain that resolves with `rows` */
function makeChain(rows: unknown[]) {
    const chain = {
      from:    vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      where:   vi.fn().mockReturnThis(),
    limit:   vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    offset:  vi.fn().mockReturnThis(),
    then:    (onfulfilled: (v: unknown) => unknown) => Promise.resolve(rows).then(onfulfilled),
    catch:   (onrejected: (e: unknown) => unknown) => Promise.resolve(rows).catch(onrejected),
  };
  return chain;
}

/** Reset select mock for Path A (agentId provided).
 *  select calls: 1=agent lookup, 2=issue lookup (for event bus)
 */
function setupSelectForPathA(agentRow: object | null, issueRow: object | null) {
  _selectCallCount = 0;
  mockSelect.mockImplementation(() => {
    const call = ++_selectCallCount;
    if (call === 1) return makeChain(agentRow ? [agentRow] : []);
    return makeChain(issueRow ? [issueRow] : []);
  });
}

/**
 * Reset select mock for Path B (no agentId — coordinator path).
 * select calls:
 *   1  = issue row
 *   2  = project row
 *   3  = issue labels
 *   4  = active agents
 *   5  = busy run rows
 *   6  = cached agent keywords
 *   7  = recent run rows for this issue
 *   8  = issue parent links
 *   9  = routing rules
 *   10 = recent failure rows for circuit breaker
 */
function setupSelectForPathB(overrides: {
  issueRow?: object | null;
  projectRow?: object | null;
  issueLabelRows?: object[];
  agentRows?: object[];
  busyRunRows?: object[];
  agentKeywordRows?: object[];
  recentRunRows?: object[];
  parentRows?: object[];
  routingRuleRows?: object[];
  failureRows?: object[];
} = {}) {
  _selectCallCount = 0;
  const {
    issueRow     = ISSUE_ROW,
    projectRow   = PROJECT_ROW,
    issueLabelRows = [],
    agentRows    = [AGENT_ROW],
    busyRunRows  = [],
    agentKeywordRows = [],
    recentRunRows = [],
    parentRows = [],
    routingRuleRows = [],
    failureRows = [],
  } = overrides;

  mockSelect.mockImplementation(() => {
    const call = ++_selectCallCount;
    if (call === 1) return makeChain(issueRow ? [issueRow] : []);
    if (call === 2) return makeChain(projectRow ? [projectRow] : []);
    if (call === 3) return makeChain(issueLabelRows);     // issueLabels
    if (call === 4) return makeChain(agentRows);           // active agents
    if (call === 5) return makeChain(busyRunRows);         // busy agents
    if (call === 6) return makeChain(agentKeywordRows);     // agent keywords
    if (call === 7) return makeChain(recentRunRows);        // recent runs
    if (call === 8) return makeChain(parentRows);           // parent links
    if (call === 9) return makeChain(routingRuleRows);      // routing rules
    return makeChain(failureRows);                         // circuit breaker failures
  });
}

function setupInsert(runRow: object = RUN_ROW) {
  mockInsert.mockReturnValue({
    values: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([runRow]),
    }),
  });
}

// ---------------------------------------------------------------------------
// beforeEach
// ---------------------------------------------------------------------------

beforeEach(() => {
  _coordinatorEnabled = true;
  _selectCallCount = 0;
  mockDispatchViaCoordinator.mockReset();
  mockSelect.mockReset();
  mockInsert.mockReset();
  setupInsert();
});

// ---------------------------------------------------------------------------
// Verify handler is registered
// ---------------------------------------------------------------------------

describe('route registration', () => {
  it('POST / handler is registered on issueRunsRouter', () => {
    const handler = findHandler('/', 'post');
    expect(handler).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Test 1: POST with agentId → existing behavior unchanged
// ---------------------------------------------------------------------------

describe('Path A — agentId provided (existing behavior)', () => {
  it('creates run and returns 201 when agentId is valid and active', async () => {
    setupSelectForPathA(AGENT_ROW, { projectId: PROJECT_ID });

    const handler = findHandler('/', 'post')!;
    const req = makeReq({ issueId: ISSUE_ID }, { agentId: AGENT_ID });
    const res = makeRes();

    await handler(req as unknown as Request, res as unknown as Response, vi.fn());

    expect(res._status).toBe(201);
    expect((res._body as Record<string, unknown>).id).toBe('run-001');
    expect(mockDispatchViaCoordinator).not.toHaveBeenCalled();
  });

  it('returns 404 when agentId does not exist', async () => {
    setupSelectForPathA(null, null);

    const handler = findHandler('/', 'post')!;
    const req = makeReq({ issueId: ISSUE_ID }, { agentId: 'no-such-agent' });
    const res = makeRes();

    await handler(req as unknown as Request, res as unknown as Response, vi.fn());

    expect(res._status).toBe(404);
    expect((res._body as Record<string, unknown>).error).toMatch(/Agent not found/);
  });

  it('returns 422 when agent is disabled', async () => {
    setupSelectForPathA({ ...AGENT_ROW, status: 'disabled' }, null);

    const handler = findHandler('/', 'post')!;
    const req = makeReq({ issueId: ISSUE_ID }, { agentId: AGENT_ID });
    const res = makeRes();

    await handler(req as unknown as Request, res as unknown as Response, vi.fn());

    expect(res._status).toBe(422);
    expect((res._body as Record<string, unknown>).error).toMatch(/disabled/);
  });

  it('Test 8: agentId AND model → agentId wins, coordinator not called', async () => {
    setupSelectForPathA(AGENT_ROW, { projectId: PROJECT_ID });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const handler = findHandler('/', 'post')!;
    const req = makeReq({ issueId: ISSUE_ID }, { agentId: AGENT_ID, model: 'gpt-5' });
    const res = makeRes();

    await handler(req as unknown as Request, res as unknown as Response, vi.fn());

    expect(res._status).toBe(201);
    expect(mockDispatchViaCoordinator).not.toHaveBeenCalled();
    // A warning should be logged about ignoring model
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('ignoring'));

    warnSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Test 3: POST without agentId, flag DISABLED → 400
// ---------------------------------------------------------------------------

describe('Path B — coordinator disabled', () => {
  it('Test 3: returns 400 with helpful error when flag is disabled', async () => {
    _coordinatorEnabled = false;

    const handler = findHandler('/', 'post')!;
    const req = makeReq({ issueId: ISSUE_ID }, {});
    const res = makeRes();

    await handler(req as unknown as Request, res as unknown as Response, vi.fn());

    expect(res._status).toBe(400);
    const body = res._body as Record<string, unknown>;
    expect(body.error).toMatch(/coordinator dispatch is disabled/i);
    expect(body.error).toMatch(/agentId/);
    expect(mockDispatchViaCoordinator).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Test 2: POST without agentId, coordinator dispatches → 201
// ---------------------------------------------------------------------------

describe('Path B — coordinator dispatch (enabled)', () => {
  it('Test 2: returns 201 with run row when coordinator dispatches', async () => {
    setupSelectForPathB();
    mockDispatchViaCoordinator.mockResolvedValue({
      decision: { kind: 'dispatch', agent: AGENT_NAME, rationale: 'Best fit', confidence: 0.95 },
      meta: { model: 'claude-haiku-4.5', promptTokens: 100, completionTokens: 30, durationMs: 200, cacheHit: false, inputHash: 'abc' },
      cacheHit: false,
    });

    const handler = findHandler('/', 'post')!;
    const req = makeReq({ issueId: ISSUE_ID }, {});
    const res = makeRes();

    await handler(req as unknown as Request, res as unknown as Response, vi.fn());

    expect(res._status).toBe(201);
    const body = res._body as Record<string, unknown>;
    expect(body.id).toBe('run-001');
    // coordinator decision included in response
    expect((body._coordinatorDecision as Record<string, unknown>).kind).toBe('dispatch');
    expect(mockDispatchViaCoordinator).toHaveBeenCalledOnce();
  });

  it('Test 4: returns 422 when coordinator decision is skip', async () => {
    setupSelectForPathB();
    mockDispatchViaCoordinator.mockResolvedValue({
      decision: { kind: 'skip', reason: 'Not ready for implementation' },
      meta: {},
      cacheHit: false,
    });

    const handler = findHandler('/', 'post')!;
    const req = makeReq({ issueId: ISSUE_ID }, {});
    const res = makeRes();

    await handler(req as unknown as Request, res as unknown as Response, vi.fn());

    expect(res._status).toBe(422);
    const body = res._body as Record<string, unknown>;
    expect(body.error).toMatch(/skip/i);
    expect(body.reason).toBe('Not ready for implementation');
  });

  it('Test 5: returns 409 with candidates when coordinator is ambiguous', async () => {
    setupSelectForPathB();
    mockDispatchViaCoordinator.mockResolvedValue({
      decision: {
        kind: 'ambiguous',
        suggestedAgents: ['verbal', 'keyser'],
        question: 'Which domain: frontend or backend?',
      },
      meta: {},
      cacheHit: false,
    });

    const handler = findHandler('/', 'post')!;
    const req = makeReq({ issueId: ISSUE_ID }, {});
    const res = makeRes();

    await handler(req as unknown as Request, res as unknown as Response, vi.fn());

    expect(res._status).toBe(409);
    const body = res._body as Record<string, unknown>;
    expect(body.error).toMatch(/pick one/i);
    expect(body.candidates).toEqual(['verbal', 'keyser']);
    expect(body.question).toBe('Which domain: frontend or backend?');
  });

  it('Test 6: returns 503 when coordinator throws', async () => {
    setupSelectForPathB();
    mockDispatchViaCoordinator.mockRejectedValue(new Error('LLM timeout'));

    const handler = findHandler('/', 'post')!;
    const req = makeReq({ issueId: ISSUE_ID }, {});
    const res = makeRes();

    await handler(req as unknown as Request, res as unknown as Response, vi.fn());

    expect(res._status).toBe(503);
    const body = res._body as Record<string, unknown>;
    expect(body.error).toMatch(/Coordinator dispatch failed/i);
    expect(body.detail).toBe('LLM timeout');
  });

  it('Test 7: model field passed to dispatchViaCoordinator when no agentId', async () => {
    setupSelectForPathB();
    mockDispatchViaCoordinator.mockResolvedValue({
      decision: { kind: 'dispatch', agent: AGENT_NAME, rationale: 'Best fit', confidence: 0.9 },
      meta: {},
      cacheHit: false,
    });

    const handler = findHandler('/', 'post')!;
    const req = makeReq({ issueId: ISSUE_ID }, { model: 'gpt-5.4-mini' });
    const res = makeRes();

    await handler(req as unknown as Request, res as unknown as Response, vi.fn());

    expect(res._status).toBe(201);
    // Verify model was forwarded to dispatchViaCoordinator opts
    expect(mockDispatchViaCoordinator).toHaveBeenCalledWith(
      expect.objectContaining({ issue: expect.objectContaining({ id: ISSUE_ID }) }),
      expect.objectContaining({ model: 'gpt-5.4-mini' }),
    );
  });

  it('returns 404 when issue is not found (coordinator path)', async () => {
    setupSelectForPathB({ issueRow: null });

    const handler = findHandler('/', 'post')!;
    const req = makeReq({ issueId: 'no-such-issue' }, {});
    const res = makeRes();

    await handler(req as unknown as Request, res as unknown as Response, vi.fn());

    expect(res._status).toBe(404);
    expect((res._body as Record<string, unknown>).error).toMatch(/Issue not found/);
  });

  it('dispatches using decided agentId from coordinator decision', async () => {
    setupSelectForPathB();
    mockDispatchViaCoordinator.mockResolvedValue({
      decision: { kind: 'dispatch', agent: AGENT_NAME, rationale: 'Matches', confidence: 0.88 },
      meta: {},
      cacheHit: false,
    });

    const handler = findHandler('/', 'post')!;
    const req = makeReq({ issueId: ISSUE_ID }, {});
    const res = makeRes();

    await handler(req as unknown as Request, res as unknown as Response, vi.fn());

    // The insert should have been called with the agent id resolved from coordinator agent name
    expect(mockInsert).toHaveBeenCalled();
    const insertValues = mockInsert.mock.results[0].value.values.mock.calls[0][0];
    expect(insertValues.agentId).toBe(AGENT_ID);
  });
});
