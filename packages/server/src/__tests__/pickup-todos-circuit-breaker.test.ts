/**
 * pickup-todos-circuit-breaker.test.ts — W27 regression tests
 *
 * Covers the circuit-breaker guard added to pickup-todos.ts:
 *   CB1. 2 prior failures in the window → still dispatches (threshold is 3).
 *   CB2. 3 prior failures in the window → skipped, no insert.
 *   CB3. 3 prior failures but oldest is outside the 30-min window → dispatches.
 *   CB4. 3 prior failures but on a DIFFERENT agent → dispatches (check is per-tuple).
 *
 * Uses vi.useFakeTimers + queue-based drizzle DB mock.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Shared state reset between tests ────────────────────────────────────────

/** Each select() call pops the front of this queue and returns it. */
let dbSelectQueue: unknown[][] = [];
let mockInsertedRuns: Array<Record<string, unknown>> = [];
let mockTier2Result: { agentId: string; agentName: string; score: number; reasoning: string } | null = null;
let queueIdx = 0;

function resetMocks() {
  dbSelectQueue = [];
  mockInsertedRuns = [];
  mockTier2Result = null;
  queueIdx = 0;
}

// ─── DB + drizzle mocks ───────────────────────────────────────────────────────

// MC-7: disable coordinator dispatch so the queue-based DB mock is unaffected by new queries.
vi.mock('../coordinator/index.js', () => ({
  dispatchViaCoordinator: vi.fn(),
}));
vi.mock('../config/coordinator-env.js', () => ({
  isCoordinatorDispatchEnabled: () => false,
}));

vi.mock('../db/index.js', () => {
  const schema = {
    issues: { id: 'id', projectId: 'project_id', status: 'status', archived: 'archived', title: 'title', body: 'body' },
    issueRuns: {
      id: 'id', issueId: 'issue_id', agentId: 'agent_id', status: 'status',
      kind: 'kind', output: 'output', routingTier: 'routing_tier',
      routingReasoning: 'routing_reasoning', createdAt: 'created_at',
    },
    agents: { id: 'id', projectId: 'project_id', status: 'status', name: 'name' },
    projects: { id: 'id', name: 'name' },
  };

  function makeChain(rows: unknown[]) {
    const chain = {
      from: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: () => Promise.resolve(rows),
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(rows).then(resolve, reject),
    };
    return chain;
  }

  const getDb = () => ({
    select: () => {
      const rows = dbSelectQueue[queueIdx++] ?? [];
      return makeChain(rows);
    },
    insert: (_table: unknown) => ({
      values: (row: Record<string, unknown>) => {
        mockInsertedRuns.push(row);
        return Promise.resolve([{ id: 'run-new-' + mockInsertedRuns.length }]);
      },
    }),
  });

  return { getDb, schema };
});

vi.mock('../engine/router.js', () => ({
  resolveRouteTier2: vi.fn(async () => mockTier2Result),
}));

vi.mock('drizzle-orm', () => {
  const asc = (col: unknown) => ({ __asc: col });
  const desc = (col: unknown) => ({ __desc: col });
  const eq = (col: unknown, val: unknown) => ({ __eq: [col, val] });
  const and = (...args: unknown[]) => ({ __and: args });
  const inArray = (col: unknown, vals: unknown) => ({ __inArray: [col, vals] });
  const notInArray = (col: unknown, vals: unknown) => ({ __notInArray: [col, vals] });
  const gte = (col: unknown, val: unknown) => ({ __gte: [col, val] });
  const sql = Object.assign(
    (strings: TemplateStringsArray, ...vals: unknown[]) => ({ __sql: { strings, vals } }),
    { __brand: 'sql', raw: (s: string) => ({ __raw: s }) },
  );
  const count = (col: unknown) => ({ __count: col });
  return { eq, and, asc, desc, inArray, notInArray, gte, sql, count };
});

import { pickupTodosSweep } from '../engine/sweeps/pickup-todos.js';

beforeEach(() => {
  resetMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const ISSUE = { id: 'issue-1', projectId: 'proj-1', title: 'Fix stepper', body: '' };
const AGENT_A = { id: 'agent-hockney', name: 'Hockney' };
const AGENT_B = { id: 'agent-kujan', name: 'Kujan' };

/** A fake "failed" issue_run row. */
const failedRun = (agentId = AGENT_A.id) => ({ id: 'run-' + Math.random(), agentId });

/**
 * Set up the standard DB query sequence for a single-issue, single-project run
 * with Tier-2 routing to AGENT_A, plus a circuit breaker result.
 *
 * Query order (as pickup-todos.ts executes them):
 *   0 — todo issues
 *   1 — covered run ids (pending/running)
 *   2 — active agents
 *   3 — circuit breaker: recent failed runs for (issue, agent) tuple
 *   (no query 4: tier2 is always set in these tests)
 */
function setupQueues(circuitBreakerRows: unknown[]) {
  dbSelectQueue = [
    [ISSUE],               // 0: todo issues
    [],                    // 1: covered run ids (none)
    [AGENT_A],             // 2: active agents
    circuitBreakerRows,    // 3: recent failures for circuit breaker
  ];
  mockTier2Result = { agentId: AGENT_A.id, agentName: AGENT_A.name, score: 0.8, reasoning: 'test' };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('pickup-todos circuit breaker', () => {
  it('CB1: 2 prior failures in window → still dispatches (need 3)', async () => {
    setupQueues([failedRun(), failedRun()]);

    const result = await pickupTodosSweep.run();

    expect(result.acted).toBe(1);
    expect(result.errors).toBe(0);
    expect(mockInsertedRuns).toHaveLength(1);
    expect(mockInsertedRuns[0].issueId).toBe(ISSUE.id);
    expect(mockInsertedRuns[0].agentId).toBe(AGENT_A.id);
  });

  it('CB2: 3 prior failures in window → skipped, no insert', async () => {
    setupQueues([failedRun(), failedRun(), failedRun()]);

    const result = await pickupTodosSweep.run();

    expect(result.acted).toBe(0);
    expect(result.errors).toBe(0);
    expect(mockInsertedRuns).toHaveLength(0);
  });

  it('CB3: 3 prior failures but oldest is outside 30-min window → dispatches', async () => {
    // The DB query is already scoped to the window via gte(createdAt, windowStart).
    // Simulate "only 2 rows returned" because the oldest failure is outside the window.
    setupQueues([failedRun(), failedRun()]);

    const result = await pickupTodosSweep.run();

    expect(result.acted).toBe(1);
    expect(result.errors).toBe(0);
    expect(mockInsertedRuns).toHaveLength(1);
  });

  it('CB4: 3 prior failures on a different agent → dispatches (check is per-tuple)', async () => {
    // The circuit breaker queries (issue, AGENT_A) — returns 0 failures for that tuple.
    // The AGENT_B failures are irrelevant to this (issue, AGENT_A) dispatch.
    dbSelectQueue = [
      [ISSUE],    // 0: todo issues
      [],         // 1: covered run ids
      [AGENT_A],  // 2: active agents
      [],         // 3: circuit breaker for (issue, AGENT_A) → 0 failures
    ];
    mockTier2Result = { agentId: AGENT_A.id, agentName: AGENT_A.name, score: 0.8, reasoning: 'test' };

    const result = await pickupTodosSweep.run();

    expect(result.acted).toBe(1);
    expect(result.errors).toBe(0);
    expect(mockInsertedRuns).toHaveLength(1);
    expect(mockInsertedRuns[0].agentId).toBe(AGENT_A.id);
  });
});
