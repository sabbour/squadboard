/**
 * triage-and-heartbeat.test.ts — W26 regression tests
 *
 * Covers:
 *   Bug A — auto-assignment routing (3+ cases):
 *     A1. Short generic words (≤4 chars) like "type" and "icon" do NOT trigger keyword match.
 *     A2. Longer specific words (≥5 chars) in pattern still DO match.
 *     A3. Label rules are unaffected by the keyword word-length change.
 *     A4. catchall rules still match everything.
 *     A5. Word-length boundary: 5-char words ("flows", "color") still match Fenster's rule.
 *
 *   Bug B — pickup-todos sweep (2+ cases):
 *     B1. Sweep creates a pending issue_run for an unattended To Do item (Tier-2 path).
 *     B2. Sweep skips To Do items that already have a pending run (idempotent).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── routing-compiler.ts — matchRule is a pure function (no DB needed) ───────

// Import the routing compiler DIRECTLY (no mocks needed for pure function tests).
import { matchRule } from '../services/routing-compiler.js';

const fensterRule = {
  priority: 5,
  pattern: 'Visual design, UX flows, color/type/icon system, empty states',
  matchType: 'keyword' as const,
  agentName: 'Fenster',
  rawRule: '| Visual design, UX flows, color/type/icon system, empty states | Fenster |',
};

const hockneyRule = {
  priority: 1,
  pattern: 'Engine internals, dispatcher/stepper/spawner, Postgres, sweepers',
  matchType: 'keyword' as const,
  agentName: 'Hockney',
  rawRule: '| Engine internals, dispatcher/stepper/spawner | Hockney |',
};

describe('Bug A — matchRule keyword routing: word-length filter (> 4 chars)', () => {
  it('A1a: "type" (4 chars) does NOT match Fenster keyword rule', () => {
    // "Fix TypeScript type error" — "type" was previously matching Fenster due to
    // the old > 3 char filter. With > 4, "type" (4 chars) is excluded.
    const issue = { title: 'Fix TypeScript type error in generic handler', labels: [], body: '' };
    expect(matchRule(fensterRule, issue)).toBe(false);
  });

  it('A1b: "icon" (4 chars) does NOT match Fenster keyword rule', () => {
    const issue = { title: 'Add icon to the main view', labels: [], body: '' };
    expect(matchRule(fensterRule, issue)).toBe(false);
  });

  it('A2: "design" (6 chars) still matches Fenster keyword rule', () => {
    const issue = { title: 'Redesign the onboarding flow', labels: [], body: '' };
    expect(matchRule(fensterRule, issue)).toBe(true);
  });

  it('A3: label rules are unaffected — exact label match still works', () => {
    const labelRule = {
      priority: 0,
      // Note: patterns are stored after cleanCell() strips backticks, so the
      // actual stored pattern is 'squad:fenster' (no backtick wrappers).
      pattern: 'squad:fenster',
      matchType: 'label' as const,
      agentName: 'Fenster',
      rawRule: '| `squad:fenster` | Fenster |',
    };
    const issue = { title: 'Any title', labels: ['squad:fenster'], body: '' };
    expect(matchRule(labelRule, issue)).toBe(true);
  });

  it('A4: catchall rule always matches regardless of title', () => {
    const catchallRule = {
      priority: 99,
      pattern: '*',
      matchType: 'catchall' as const,
      agentName: 'Fenster',
      rawRule: '| * | Fenster |',
    };
    const issue = { title: 'Completely unrelated', labels: [], body: '' };
    expect(matchRule(catchallRule, issue)).toBe(true);
  });

  it('A5: "flows" and "color" (5 chars each) still match Fenster rule', () => {
    // These are ≥ 5 chars, so they should still match after the fix.
    const issueFlows = { title: 'Improve color flows in the animation system', labels: [], body: '' };
    expect(matchRule(fensterRule, issueFlows)).toBe(true);
  });

  it('A6: Hockney-specific words still route to Hockney correctly', () => {
    // "stepper" (7 chars), "sweepers" (8 chars) — well above the threshold.
    const issue = { title: 'Fix stepper claim logic in sweepers', labels: [], body: '' };
    expect(matchRule(hockneyRule, issue)).toBe(true);
  });

  it('A7: issue with only short words returns no match (stays unassigned in Tier-1)', () => {
    // "bug" (3), "the" (3), "run" (3), "type" (4), "icon" (4) — all excluded.
    const issue = { title: 'bug in the run icon type view', labels: [], body: '' };
    expect(matchRule(fensterRule, issue)).toBe(false);
    expect(matchRule(hockneyRule, issue)).toBe(false);
  });
});

// ─── Bug B — pickupTodosSweep ────────────────────────────────────────────────
// These tests use vi.mock() to stub the DB and router tiers.

// DB mock state (shared, reset per test)
let mockTodoIssues: Array<{ id: string; projectId: string; title: string; body: string }> = [];
let mockCoveredRunIds: string[] = [];
let mockActiveAgents: Array<{ id: string; name: string }> = [];
let mockLeastLoadedAgent: { id: string; name: string } | null = null;
let mockTier2Result: { agentId: string; agentName: string; score: number; reasoning: string } | null = null;
let mockInsertedRuns: Array<Record<string, unknown>> = [];

// MC-7: disable coordinator dispatch so the counter-based DB mock is unaffected by new queries.
vi.mock('../coordinator/index.js', () => ({
  dispatchViaCoordinator: vi.fn(),
}));
vi.mock('../config/coordinator-env.js', () => ({
  isCoordinatorDispatchEnabled: () => false,
}));

vi.mock('../db/index.js', () => {
  const schema = {
    issues: {
      id: 'id',
      projectId: 'project_id',
      status: 'status',
      archived: 'archived',
      title: 'title',
      body: 'body',
    },
    issueRuns: {
      id: 'id',
      issueId: 'issue_id',
      agentId: 'agent_id',
      status: 'status',
      kind: 'kind',
      output: 'output',
      routingTier: 'routing_tier',
      routingReasoning: 'routing_reasoning',
    },
    agents: {
      id: 'id',
      projectId: 'project_id',
      status: 'status',
      name: 'name',
    },
    projects: { id: 'id', name: 'name' },
  };

  // Fluent DB mock: chain of .from().where().orderBy().limit() all return arrays.
  function makeChain(getter: () => unknown[]) {
    const chain = {
      from: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: () => Promise.resolve(getter()),
      then: (resolve2: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(getter()).then(resolve2, reject),
    };
    return chain;
  }

  let callCount = 0;

  const getDb = () => ({
    select: () => {
      const idx = callCount++;
      if (idx === 0) return makeChain(() => mockTodoIssues);          // todo issues
      if (idx === 1) return makeChain(() =>                            // covered run ids
        mockCoveredRunIds.map((id) => ({ issueId: id })));
      if (idx === 2) return makeChain(() => mockActiveAgents);         // active agents per project
      return makeChain(() => (mockLeastLoadedAgent ? [mockLeastLoadedAgent] : [])); // fallback
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

// drizzle-orm stubs needed by the sweep.
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
  const avg = (col: unknown) => ({ __avg: col });
  return { eq, and, asc, desc, inArray, notInArray, gte, sql, count, avg };
});

import { pickupTodosSweep } from '../engine/sweeps/pickup-todos.js';

beforeEach(() => {
  mockTodoIssues = [];
  mockCoveredRunIds = [];
  mockActiveAgents = [];
  mockLeastLoadedAgent = null;
  mockTier2Result = null;
  mockInsertedRuns = [];
  // Reset the call-count closure by reassigning; vitest re-executes module per test anyway.
});

describe('Bug B — pickupTodosSweep dispatches unattended To Do items', () => {
  it('B1: creates a pending issue_run for unattended todo (Tier-2 match)', async () => {
    mockTodoIssues = [{ id: 'issue-todo-1', projectId: 'project-1', title: 'Fix engine dispatcher', body: '' }];
    mockCoveredRunIds = [];  // not covered
    mockActiveAgents = [{ id: 'agent-hockney', name: 'Hockney' }];
    mockTier2Result = { agentId: 'agent-hockney', agentName: 'Hockney', score: 0.42, reasoning: 'tier2' };

    const result = await pickupTodosSweep.run();

    expect(result.errors).toBe(0);
    expect(result.acted).toBe(1);
    expect(mockInsertedRuns).toHaveLength(1);
    expect(mockInsertedRuns[0].issueId).toBe('issue-todo-1');
    expect(mockInsertedRuns[0].agentId).toBe('agent-hockney');
    expect(mockInsertedRuns[0].status).toBe('pending');
    expect(mockInsertedRuns[0].routingTier).toBe(2);
  });

  it('B2: skips todo items that already have a pending run (idempotent)', async () => {
    mockTodoIssues = [{ id: 'issue-covered', projectId: 'project-1', title: 'Already handled', body: '' }];
    mockCoveredRunIds = ['issue-covered'];  // already has a pending run

    const result = await pickupTodosSweep.run();

    expect(result.acted).toBe(0);
    expect(mockInsertedRuns).toHaveLength(0);
  });

  it('B3: uses least-loaded fallback when Tier-2 returns null (no keyword match)', async () => {
    mockTodoIssues = [{ id: 'issue-todo-2', projectId: 'project-2', title: 'Vague task', body: '' }];
    mockCoveredRunIds = [];
    mockActiveAgents = [{ id: 'agent-kujan', name: 'Kujan' }];
    mockLeastLoadedAgent = { id: 'agent-kujan', name: 'Kujan' };
    mockTier2Result = null;

    const result = await pickupTodosSweep.run();

    expect(result.errors).toBe(0);
    expect(result.acted).toBe(1);
    expect(mockInsertedRuns[0].agentId).toBe('agent-kujan');
    // Fallback: least-loaded is now tier 3 (MC-7 — was null in old code, now explicit).
    expect(mockInsertedRuns[0].routingTier).toBe(3);
  });
});
