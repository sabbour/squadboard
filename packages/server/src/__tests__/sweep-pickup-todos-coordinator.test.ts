/**
 * sweep-pickup-todos-coordinator.test.ts — W29 MC-7
 *
 * Tests for coordinator dispatch integration in the pickup-todos sweep.
 *
 * Priority order under test:
 *   1. Tier-1: coordinator dispatch (COORDINATOR_DISPATCH_ENABLED=true, default)
 *   2. Tier-2: keyword scoring fallback (skip / ambiguous / error / flag-off)
 *   3. Tier-3: least-loaded final fallback (unchanged)
 *
 * Scenarios:
 *   1. Coordinator dispatches → uses decided agent (tier 1)
 *   2. Coordinator skips → no run inserted
 *   3. Coordinator ambiguous → falls through to tier-2 keyword
 *   4. Coordinator throws → falls through to tier-2 keyword
 *   5. Feature flag OFF → never calls coordinator, uses tier-2
 *   6. Circuit breaker still trips after coordinator dispatches to same agent 3x
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — declared before any module imports so vitest hoisting works
// ---------------------------------------------------------------------------

const mockInsertValues = vi.fn();
const mockInsert = vi.fn();
const mockSelect = vi.fn();
const mockDb = { select: mockSelect, insert: mockInsert };

vi.mock('../db/index.js', () => ({
  getDb: () => mockDb,
  schema: {
    issues:    { __table: 'issues' },
    issueRuns: { __table: 'issue_runs' },
    agents:    { __table: 'agents' },
    projects:  { __table: 'projects' },
  },
}));

const mockResolveRouteTier2 = vi.fn();
vi.mock('../engine/router.js', () => ({
  resolveRouteTier2: (...args: unknown[]) => mockResolveRouteTier2(...args),
}));

const mockDispatchViaCoordinator = vi.fn();
vi.mock('../coordinator/index.js', () => ({
  dispatchViaCoordinator: (...args: unknown[]) => mockDispatchViaCoordinator(...args),
}));

const mockIsCoordinatorDispatchEnabled = vi.fn();
vi.mock('../config/coordinator-env.js', () => ({
  isCoordinatorDispatchEnabled: () => mockIsCoordinatorDispatchEnabled(),
}));

vi.mock('drizzle-orm', () => ({
  eq:      (col: unknown, val: unknown)              => ({ __eq: [col, val] }),
  and:     (...args: unknown[])                      => ({ __and: args }),
  sql:     Object.assign(
    (strings: TemplateStringsArray, ...vals: unknown[]) => ({ __sql: { strings, vals } }),
    { __brand: 'sql' },
  ),
  asc:     (col: unknown)                            => ({ __asc: col }),
  inArray: (col: unknown, vals: unknown)             => ({ __inArray: [col, vals] }),
  gte:     (col: unknown, val: unknown)              => ({ __gte: [col, val] }),
}));

import { pickupTodosSweep } from '../engine/sweeps/pickup-todos.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a fluent DB select chain that resolves to `rows`.
 * Supports both: `await chain` (direct resolution) and `await chain.limit(n)`.
 */
function sel(rows: unknown[]) {
  const p = Promise.resolve(rows);
  const chain: Record<string, unknown> = {
    from:    vi.fn(() => chain),
    where:   vi.fn(() => chain),
    orderBy: vi.fn(() => chain),
    limit:   vi.fn().mockResolvedValue(rows),
    then:    p.then.bind(p),
    catch:   p.catch.bind(p),
    finally: p.finally.bind(p),
  };
  return chain;
}

const NOW = new Date('2025-01-15T12:00:00Z');

const ISSUE_1 = {
  id: '11111111-0000-0000-0000-000000000001',
  projectId: 'proj-1111-0000-0000-0000-000000000001',
  title: 'Fix the login bug',
  body: 'Users cannot log in with email',
  status: 'todo',
  createdAt: NOW,
};

const AGENT_VERBAL = {
  id: 'aaaa0000-0000-0000-0000-000000000001',
  name: 'verbal',
  role: 'implementer',
  charterContent: '# Verbal\n\nImplements features.',
  charterHash: 'deadbeef',
};

const AGENT_FENSTER = {
  id: 'aaaa0000-0000-0000-0000-000000000002',
  name: 'fenster',
  role: 'reviewer',
  charterContent: '# Fenster\n\nReviews code.',
  charterHash: 'cafebabe',
};

const PROJECT_ROW = [{ id: ISSUE_1.projectId, name: 'Squadboard' }];

/**
 * Wires up a standard "coordinator-enabled, single issue, single project" scenario.
 * Returns the mockSelect chain to allow custom overrides via mockReturnValueOnce.
 *
 * DB call order (coordinator enabled):
 *   0: todoIssues
 *   1: coveredRunRows (pending/running check)
 *   2: activeAgents
 *   3: projectRow (with .limit)
 *   4: busyAgentRows
 *   5: recentRunRows (for coordinator, with .limit)
 *   ... then coordinator is called ...
 *   6: circuitBreakerFailures (if targetAgentId resolved)
 *   [insert if not tripped]
 */
function setupStandardMocks(opts: {
  todoIssues?: unknown[];
  coveredRuns?: unknown[];
  activeAgents?: unknown[];
  projectRow?: unknown[];
  busyAgents?: unknown[];
  recentRuns?: unknown[];
  circuitBreakerFailures?: unknown[];
} = {}) {
  mockSelect
    .mockReturnValueOnce(sel(opts.todoIssues   ?? [ISSUE_1]))
    .mockReturnValueOnce(sel(opts.coveredRuns  ?? []))
    .mockReturnValueOnce(sel(opts.activeAgents ?? [AGENT_VERBAL]))
    .mockReturnValueOnce(sel(opts.projectRow   ?? PROJECT_ROW))
    .mockReturnValueOnce(sel(opts.busyAgents   ?? []))
    .mockReturnValueOnce(sel(opts.recentRuns   ?? []))
    .mockReturnValueOnce(sel(opts.circuitBreakerFailures ?? []));
}

function makeDispatchResult(decision: object) {
  return {
    decision,
    meta: {
      model: 'claude-haiku-4.5',
      promptTokens: 100,
      completionTokens: 50,
      durationMs: 150,
      cacheHit: false,
      inputHash: 'abc123def456',
    },
    cacheHit: false,
  };
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  // resetAllMocks clears the once-queue AND implementations — prevents stale
  // mock returns from one test polluting the next (clearAllMocks does not
  // clear the mockReturnValueOnce queue).
  vi.resetAllMocks();
  mockIsCoordinatorDispatchEnabled.mockReturnValue(true);
  mockResolveRouteTier2.mockResolvedValue(null);
  mockInsert.mockReturnValue({ values: mockInsertValues });
  mockInsertValues.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('pickup-todos sweep — coordinator dispatch (W29 MC-7)', () => {

  // -----------------------------------------------------------------------
  // 1. Coordinator dispatches → tier 1 used
  // -----------------------------------------------------------------------
  it('1. coordinator dispatch → inserts run with tier=1 and coordinator agentId', async () => {
    setupStandardMocks();
    mockDispatchViaCoordinator.mockResolvedValue(
      makeDispatchResult({ kind: 'dispatch', agent: 'verbal', rationale: 'best match for login', confidence: 0.92 }),
    );

    const result = await pickupTodosSweep.run();

    expect(result.acted).toBe(1);
    expect(result.errors).toBe(0);

    expect(mockDispatchViaCoordinator).toHaveBeenCalledOnce();
    const [coordinatorInput] = mockDispatchViaCoordinator.mock.calls[0] as [Record<string, unknown>];
    expect(coordinatorInput.issue).toMatchObject({ id: ISSUE_1.id, title: ISSUE_1.title });
    expect(coordinatorInput.project).toMatchObject({ name: 'Squadboard' });

    expect(mockInsert).toHaveBeenCalledOnce();
    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        issueId: ISSUE_1.id,
        agentId: AGENT_VERBAL.id,
        routingTier: 1,
        routingReasoning: 'best match for login',
      }),
    );
    // Tier-2 keyword scoring should NOT have been called
    expect(mockResolveRouteTier2).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // 2. Coordinator skips → no run inserted
  // -----------------------------------------------------------------------
  it('2. coordinator skip → no run inserted, acted=0', async () => {
    // Skip path does NOT make the circuit-breaker DB call — only 6 selects.
    mockSelect
      .mockReturnValueOnce(sel([ISSUE_1]))
      .mockReturnValueOnce(sel([]))
      .mockReturnValueOnce(sel([AGENT_VERBAL]))
      .mockReturnValueOnce(sel(PROJECT_ROW))
      .mockReturnValueOnce(sel([]))
      .mockReturnValueOnce(sel([]));  // recentRuns for coordinator

    mockDispatchViaCoordinator.mockResolvedValue(
      makeDispatchResult({ kind: 'skip', reason: 'duplicate effort — already handled in PR #42' }),
    );

    const result = await pickupTodosSweep.run();

    expect(result.acted).toBe(0);
    expect(result.errors).toBe(0);
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockResolveRouteTier2).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // 3. Coordinator ambiguous → falls through to tier-2
  // -----------------------------------------------------------------------
  it('3. coordinator ambiguous → falls through to tier-2, inserts tier=2 run', async () => {
    // Need extra select call for circuit breaker after tier-2 resolves
    mockSelect
      .mockReturnValueOnce(sel([ISSUE_1]))           // todoIssues
      .mockReturnValueOnce(sel([]))                  // coveredRuns
      .mockReturnValueOnce(sel([AGENT_VERBAL]))      // activeAgents
      .mockReturnValueOnce(sel(PROJECT_ROW))         // projectRow
      .mockReturnValueOnce(sel([]))                  // busyAgents
      .mockReturnValueOnce(sel([]))                  // recentRuns (coordinator)
      .mockReturnValueOnce(sel([]));                 // circuit breaker (after tier-2)

    mockDispatchViaCoordinator.mockResolvedValue(
      makeDispatchResult({ kind: 'ambiguous', suggestedAgents: ['verbal', 'fenster'], question: 'Who owns login?' }),
    );
    mockResolveRouteTier2.mockResolvedValue({
      agentId: AGENT_VERBAL.id,
      score: 7,
      reasoning: 'keyword: login matched verbal',
    });

    const result = await pickupTodosSweep.run();

    expect(result.acted).toBe(1);
    expect(mockDispatchViaCoordinator).toHaveBeenCalledOnce();
    expect(mockResolveRouteTier2).toHaveBeenCalledOnce();
    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: AGENT_VERBAL.id,
        routingTier: 2,
        routingReasoning: 'keyword: login matched verbal',
      }),
    );
  });

  // -----------------------------------------------------------------------
  // 4. Coordinator throws → falls through to tier-2
  // -----------------------------------------------------------------------
  it('4. coordinator throws → falls through to tier-2, inserts tier=2 run', async () => {
    mockSelect
      .mockReturnValueOnce(sel([ISSUE_1]))
      .mockReturnValueOnce(sel([]))
      .mockReturnValueOnce(sel([AGENT_VERBAL]))
      .mockReturnValueOnce(sel(PROJECT_ROW))
      .mockReturnValueOnce(sel([]))
      .mockReturnValueOnce(sel([]))
      .mockReturnValueOnce(sel([]));   // circuit breaker

    mockDispatchViaCoordinator.mockRejectedValue(new Error('LLM timeout'));
    mockResolveRouteTier2.mockResolvedValue({
      agentId: AGENT_VERBAL.id,
      score: 4,
      reasoning: 'keyword fallback after coordinator error',
    });

    const result = await pickupTodosSweep.run();

    expect(result.acted).toBe(1);
    expect(result.errors).toBe(0); // coordinator error is non-fatal
    expect(mockDispatchViaCoordinator).toHaveBeenCalledOnce();
    expect(mockResolveRouteTier2).toHaveBeenCalledOnce();
    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: AGENT_VERBAL.id,
        routingTier: 2,
      }),
    );
  });

  // -----------------------------------------------------------------------
  // 5. Feature flag OFF → coordinator never called, tier-2 used directly
  // -----------------------------------------------------------------------
  it('5. feature flag OFF → coordinator not called, tier-2 runs directly', async () => {
    mockIsCoordinatorDispatchEnabled.mockReturnValue(false);

    // With flag OFF: no recentRuns query, no coordinator call
    // DB calls: todoIssues, coveredRuns, activeAgents, projectRow, busyAgents,
    //           circuit breaker (after tier-2)
    mockSelect
      .mockReturnValueOnce(sel([ISSUE_1]))
      .mockReturnValueOnce(sel([]))
      .mockReturnValueOnce(sel([AGENT_VERBAL]))
      .mockReturnValueOnce(sel(PROJECT_ROW))
      .mockReturnValueOnce(sel([]))
      .mockReturnValueOnce(sel([]));   // circuit breaker

    mockResolveRouteTier2.mockResolvedValue({
      agentId: AGENT_VERBAL.id,
      score: 6,
      reasoning: 'keyword: bug matched verbal',
    });

    const result = await pickupTodosSweep.run();

    expect(result.acted).toBe(1);
    expect(mockDispatchViaCoordinator).not.toHaveBeenCalled();
    expect(mockResolveRouteTier2).toHaveBeenCalledOnce();
    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: AGENT_VERBAL.id,
        routingTier: 2,
      }),
    );
  });

  // -----------------------------------------------------------------------
  // 6. Circuit breaker trips even after coordinator-decided agent (tier 1)
  // -----------------------------------------------------------------------
  it('6. circuit breaker trips after coordinator dispatches to same agent 3x (tier=1 → blocked)', async () => {
    const failedRun1 = { id: 'run-fail-1' };
    const failedRun2 = { id: 'run-fail-2' };
    const failedRun3 = { id: 'run-fail-3' };

    setupStandardMocks({
      circuitBreakerFailures: [failedRun1, failedRun2, failedRun3],
    });

    mockDispatchViaCoordinator.mockResolvedValue(
      makeDispatchResult({ kind: 'dispatch', agent: 'verbal', rationale: 'best match', confidence: 0.88 }),
    );

    const result = await pickupTodosSweep.run();

    // Circuit breaker should have tripped — no run inserted
    expect(result.acted).toBe(0);
    expect(result.errors).toBe(0);
    expect(mockDispatchViaCoordinator).toHaveBeenCalledOnce();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Additional: coordinator returns unknown agent → falls through to tier-2
  // -----------------------------------------------------------------------
  it('coordinator returns unknown agent name → falls through to tier-2', async () => {
    mockSelect
      .mockReturnValueOnce(sel([ISSUE_1]))
      .mockReturnValueOnce(sel([]))
      .mockReturnValueOnce(sel([AGENT_VERBAL]))
      .mockReturnValueOnce(sel(PROJECT_ROW))
      .mockReturnValueOnce(sel([]))
      .mockReturnValueOnce(sel([]))
      .mockReturnValueOnce(sel([]));   // circuit breaker

    mockDispatchViaCoordinator.mockResolvedValue(
      makeDispatchResult({ kind: 'dispatch', agent: 'ghost-agent', rationale: 'reason', confidence: 0.5 }),
    );
    mockResolveRouteTier2.mockResolvedValue({
      agentId: AGENT_VERBAL.id,
      score: 3,
      reasoning: 'keyword fallback',
    });

    const result = await pickupTodosSweep.run();

    expect(result.acted).toBe(1);
    expect(mockResolveRouteTier2).toHaveBeenCalledOnce();
    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({ routingTier: 2, agentId: AGENT_VERBAL.id }),
    );
  });

  // -----------------------------------------------------------------------
  // Additional: no todo issues → short-circuit, acted=0
  // -----------------------------------------------------------------------
  it('no todo issues → returns immediately with acted=0', async () => {
    mockSelect.mockReturnValueOnce(sel([])); // todoIssues empty

    const result = await pickupTodosSweep.run();

    expect(result.acted).toBe(0);
    expect(result.errors).toBe(0);
    expect(mockDispatchViaCoordinator).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Additional: coordinator dispatch with empty charterContent (early bootstrap)
  // -----------------------------------------------------------------------
  it('coordinator called with empty charterContent (tolerant bootstrap path)', async () => {
    const agentNoCharter = { ...AGENT_VERBAL, charterContent: '', charterHash: null };
    mockSelect
      .mockReturnValueOnce(sel([ISSUE_1]))
      .mockReturnValueOnce(sel([]))
      .mockReturnValueOnce(sel([agentNoCharter]))
      .mockReturnValueOnce(sel(PROJECT_ROW))
      .mockReturnValueOnce(sel([]))
      .mockReturnValueOnce(sel([]))
      .mockReturnValueOnce(sel([]));

    mockDispatchViaCoordinator.mockResolvedValue(
      makeDispatchResult({ kind: 'dispatch', agent: 'verbal', rationale: 'coordinator ok with empty charter', confidence: 0.7 }),
    );

    const result = await pickupTodosSweep.run();

    expect(result.acted).toBe(1);
    const [input] = mockDispatchViaCoordinator.mock.calls[0] as [{ candidateAgents: Array<{ charterContent: string; charterHash: string }> }];
    expect(input.candidateAgents[0].charterContent).toBe('');
    expect(input.candidateAgents[0].charterHash).toBe('');
    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({ routingTier: 1 }),
    );
  });

  // -----------------------------------------------------------------------
  // Additional: all issues already covered → short-circuit, no dispatch
  // -----------------------------------------------------------------------
  it('all todo issues already covered by pending/running runs → no dispatch', async () => {
    mockSelect
      .mockReturnValueOnce(sel([ISSUE_1]))                         // todoIssues
      .mockReturnValueOnce(sel([{ issueId: ISSUE_1.id }]));       // coveredRuns

    const result = await pickupTodosSweep.run();

    expect(result.acted).toBe(0);
    expect(mockDispatchViaCoordinator).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });
});
