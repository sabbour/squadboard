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
 *   Bug B — pickup-ready sweep (2+ cases):
 *     B1. Sweep creates a pending issue_run for an unattended Ready item (Tier-2 path).
 *     B2. Sweep skips Ready items that already have a pending run (idempotent).
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

// ─── Bug B — pickupReadySweep ────────────────────────────────────────────────
// These tests use vi.mock() to stub the DB and router tiers.

// DB mock state (shared, reset per test)
let mockReadyIssues: Array<{ id: string; projectId: string; title: string; body: string; status: string; createdAt: Date }> = [];
let mockCoveredRunIds: string[] = [];
let mockActiveAgents: Array<{ id: string; name: string; role?: string; charterContent?: string; charterHash?: string | null }> = [];
let mockLeastLoadedAgent: { id: string; name: string } | null = null;
let mockTier2Result: { agentId: string; agentName: string; score: number; reasoning: string } | null = null;
let mockInsertedRuns: Array<Record<string, unknown>> = [];

// MC-7: disable coordinator dispatch so the counter-based DB mock is unaffected by new queries.
vi.mock('../coordinator/index.js', () => ({
  dispatchViaCoordinator: vi.fn(),
  buildCoordinatorInput: (params: {
    issue: { id: string; title: string; body?: string | null; status: string; createdAt: Date };
    labels: string[];
    project: { id: string; name: string; description?: string | null };
    agents: Array<{ id: string; name: string; role?: string; charterHash?: string | null; charterContent?: string }>;
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
      role: agent.role ?? 'implementer',
      charterHash: agent.charterHash ?? '',
      charterContent: agent.charterContent ?? '',
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
vi.mock('../config/coordinator-env.js', () => ({
  isCoordinatorDispatchEnabled: () => false,
}));
// MC-10: mock decision-log so persistCoordinatorDecision is a no-op here.
vi.mock('../services/coordinator-decision-log.js', () => ({
  persistCoordinatorDecision: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../services/coordinator-routing-log.js', () => ({
  persistCoordinatorRoutingDecision: vi.fn().mockResolvedValue(undefined),
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
      createdAt: 'created_at',
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
      role: 'role',
      charterContent: 'charter_content',
      charterHash: 'charter_hash',
    },
    projects: { id: 'id', name: 'name', description: 'description' },
    issueLabels: { issueId: 'issue_id', labelId: 'label_id' },
    labels: { id: 'id', name: 'name' },
    agentKeywords: { agentId: 'agent_id', keywords: 'keywords', focusAreas: 'focus_areas' },
    issueLinks: { childIssueId: 'child_issue_id', parentIssueId: 'parent_issue_id', linkType: 'link_type' },
    routingRules: { projectId: 'project_id', rawRule: 'raw_rule', priority: 'priority' },
  };

  // Fluent DB mock: chain of .from().where().orderBy().limit() all return arrays.
  function makeChain(getter: () => unknown[]) {
    const chain = {
      from: () => chain,
      innerJoin: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: () => Promise.resolve(getter()),
      then: (resolve2: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(getter()).then(resolve2, reject),
    };
    return chain;
  }

  const getDb = () => ({
    select: () => {
      const key = '__triageHeartbeatSelectCallCount';
      const state = globalThis as typeof globalThis & Record<string, number | undefined>;
      const idx = state[key] ?? 0;
      state[key] = idx + 1;
      if (idx === 0) return makeChain(() => mockReadyIssues);          // ready issues
      if (idx === 1) return makeChain(() =>                            // covered run ids
        mockCoveredRunIds.map((id) => ({ issueId: id })));
      if (idx === 2) return makeChain(() => mockActiveAgents);         // active agents per project
      if (idx === 3) return makeChain(() => [{ id: 'project-1', name: 'Project', description: '' }]);
      if (idx >= 4 && idx <= 9) return makeChain(() => []);
      return makeChain(() => (mockLeastLoadedAgent ? [mockLeastLoadedAgent] : [])); // fallback
    },
    insert: (_table: unknown) => ({
      values: (row: Record<string, unknown>) => {
        mockInsertedRuns.push(row);
        return { returning: () => Promise.resolve([{ id: 'run-new-' + mockInsertedRuns.length }]) };
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

import { pickupReadySweep } from '../engine/sweeps/pickup-ready.js';

beforeEach(() => {
  mockReadyIssues = [];
  mockCoveredRunIds = [];
  mockActiveAgents = [];
  mockLeastLoadedAgent = null;
  mockTier2Result = null;
  mockInsertedRuns = [];
  (globalThis as typeof globalThis & Record<string, number | undefined>).__triageHeartbeatSelectCallCount = 0;
});

describe('Bug B — pickupReadySweep dispatches unattended Ready items', () => {
  it('B1: creates a pending issue_run for unattended Ready item (Tier-2 match)', async () => {
    mockReadyIssues = [{ id: 'issue-ready-1', projectId: 'project-1', title: 'Fix engine dispatcher', body: 'Details', status: 'ready', createdAt: new Date('2026-01-01T00:00:00Z') }];
    mockCoveredRunIds = [];  // not covered
    mockActiveAgents = [{ id: 'agent-hockney', name: 'Hockney', role: 'implementer', charterContent: '', charterHash: null }];
    mockTier2Result = { agentId: 'agent-hockney', agentName: 'Hockney', score: 0.42, reasoning: 'tier2' };

    const result = await pickupReadySweep.run();

    expect(result.errors).toBe(0);
    expect(result.acted).toBe(1);
    expect(mockInsertedRuns).toHaveLength(1);
    expect(mockInsertedRuns[0].issueId).toBe('issue-ready-1');
    expect(mockInsertedRuns[0].agentId).toBe('agent-hockney');
    expect(mockInsertedRuns[0].status).toBe('pending');
    expect(mockInsertedRuns[0].routingTier).toBe(2);
  });

  it('B2: skips Ready items that already have a pending run (idempotent)', async () => {
    mockReadyIssues = [{ id: 'issue-covered', projectId: 'project-1', title: 'Already handled', body: 'Details', status: 'ready', createdAt: new Date('2026-01-01T00:00:00Z') }];
    mockCoveredRunIds = ['issue-covered'];  // already has a pending run

    const result = await pickupReadySweep.run();

    expect(result.acted).toBe(0);
    expect(mockInsertedRuns).toHaveLength(0);
  });

  it('B3: uses least-loaded fallback when Tier-2 returns null (no keyword match)', async () => {
    mockReadyIssues = [{ id: 'issue-ready-2', projectId: 'project-2', title: 'Vague task', body: 'Details', status: 'ready', createdAt: new Date('2026-01-01T00:00:00Z') }];
    mockCoveredRunIds = [];
    mockActiveAgents = [{ id: 'agent-kujan', name: 'Kujan', role: 'implementer', charterContent: '', charterHash: null }];
    mockLeastLoadedAgent = { id: 'agent-kujan', name: 'Kujan' };
    mockTier2Result = null;

    const result = await pickupReadySweep.run();

    expect(result.errors).toBe(0);
    expect(result.acted).toBe(1);
    expect(mockInsertedRuns[0].agentId).toBe('agent-kujan');
    // Fallback: least-loaded is now tier 3 (MC-7 — was null in old code, now explicit).
    expect(mockInsertedRuns[0].routingTier).toBe(3);
  });
});
