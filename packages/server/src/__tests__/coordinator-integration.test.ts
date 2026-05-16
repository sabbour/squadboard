/**
 * coordinator-integration.test.ts — W29 MC-12
 *
 * End-to-end integration tests proving the full coordinator stack works together.
 * The LLM is mocked via injectable LlmCaller or module-level mock; everything
 * else (cache, hash, preamble, Zod parse, schema validation) is REAL code.
 *
 * Organisation:
 *   A. Coordinator stack internals — inject LlmCaller directly into dispatchViaCoordinator
 *   B. Batch coordinator         — inject LlmCaller into dispatchBatchViaCoordinator
 *   C. Sweep integration         — mock DB; real coordinator with injected LlmCaller via module spy
 *   D. Route integration         — mock DB; real coordinator with injected LlmCaller via module spy
 *   E. Cross-cutting             — agent-sync drift, decision-log shape
 *
 * Bugs found and NOT fixed (deferred per lane rules):
 *   BUG-1: resolveCoordinatorModelChain() in coordinator-env.ts defines a
 *           multi-model fallback chain, but dispatchViaCoordinator() and
 *           callCoordinatorLlm() do NOT attempt fallbacks — a single model is
 *           used per call. If the primary model call throws, the error propagates
 *           directly to the caller with no retry. Scenario 7 documents this.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// vi.hoisted — variables shared between mock factories and test code
// ---------------------------------------------------------------------------

const {
  mockSweepLlmCallerCall,
  mockRouteLlmCallerCall,
  mockSelectFn,
  mockInsertFn,
  mockUpdateFn,
  mockResolveRouteTier2Fn,
  mockPersistCoordinatorDecision,
  mockIsCoordinatorEnabled,
  mockGetAgentsFn,
  mockFsReaddir,
  mockFsReadFile,
  mockFsAccess,
  mockParseCharterContent,
  mockComputeContentHash,
} = vi.hoisted(() => ({
  mockSweepLlmCallerCall: vi.fn(),
  mockRouteLlmCallerCall: vi.fn(),
  mockSelectFn: vi.fn(),
  mockInsertFn: vi.fn(),
  mockUpdateFn: vi.fn(),
  mockResolveRouteTier2Fn: vi.fn(),
  mockPersistCoordinatorDecision: vi.fn(),
  mockIsCoordinatorEnabled: vi.fn(() => true),
  mockGetAgentsFn: vi.fn(),
  mockFsReaddir: vi.fn(),
  mockFsReadFile: vi.fn(),
  mockFsAccess: vi.fn(),
  mockParseCharterContent: vi.fn(),
  mockComputeContentHash: vi.fn(),
  mockUpdateFn: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

// Mock coordinator/index.js with a passthrough that injects our fake LlmCaller.
// Used by sweep (Group C) and route (Group D) — direct tests (Groups A/B) import
// from coordinator/dispatch.js and coordinator/batch.ts directly, bypassing this.
vi.mock('../coordinator/index.js', async (importOriginal) => {
  const actual = await importOriginal() as typeof import('../coordinator/index.js');
  return {
    ...actual,
    dispatchViaCoordinator: (input: import('../coordinator/types.js').CoordinatorInput, opts?: import('../coordinator/dispatch.js').DispatchOptions) =>
      // Inject the sweep mock caller when no caller is explicitly provided.
      // Route tests override opts.llmCaller explicitly too.
      actual.dispatchViaCoordinator(input, { ...opts, llmCaller: opts?.llmCaller ?? { call: mockSweepLlmCallerCall } }),
  };
});

vi.mock('../db/index.js', () => ({
  getDb: () => ({ select: mockSelectFn, insert: mockInsertFn, update: mockUpdateFn }),
  schema: {
    issues:    { id: 'issues.id', projectId: 'issues.project_id', title: 'issues.title', body: 'issues.body', status: 'issues.status', createdAt: 'issues.created_at', archived: 'issues.archived' },
    issueRuns: { id: 'issue_runs.id', issueId: 'issue_runs.issue_id', agentId: 'issue_runs.agent_id', status: 'issue_runs.status', startedAt: 'issue_runs.started_at', completedAt: 'issue_runs.completed_at', createdAt: 'issue_runs.created_at' },
    agents:    { id: 'agents.id', name: 'agents.name', role: 'agents.role', status: 'agents.status', projectId: 'agents.project_id', charterContent: 'agents.charter_content', charterHash: 'agents.charter_hash' },
    projects:  { id: 'projects.id', name: 'projects.name', description: 'projects.description' },
    issueLabels: { issueId: 'issue_labels.issue_id', labelId: 'issue_labels.label_id' },
    labels: { id: 'labels.id', name: 'labels.name' },
  },
}));

vi.mock('drizzle-orm', () => ({
  eq:      (a: unknown, b: unknown) => ({ __eq: [a, b] }),
  and:     (...args: unknown[])     => ({ __and: args }),
  asc:     (a: unknown)             => ({ __asc: a }),
  inArray: (a: unknown, b: unknown) => ({ __inArray: [a, b] }),
  gte:     (a: unknown, b: unknown) => ({ __gte: [a, b] }),
  sql:     Object.assign(
    (strings: TemplateStringsArray, ...vals: unknown[]) => ({ __sql: { strings, vals } }),
    { __brand: 'sql' },
  ),
  max: (a: unknown) => ({ __max: a }),
}));

vi.mock('../engine/router.js', () => ({
  resolveRouteTier2: (...args: unknown[]) => mockResolveRouteTier2Fn(...args),
}));

vi.mock('../services/coordinator-decision-log.js', async (importOriginal) => {
  const actual = await importOriginal() as typeof import('../services/coordinator-decision-log.js');
  return {
    ...actual,
    persistCoordinatorDecision: (...args: unknown[]) => mockPersistCoordinatorDecision(...args),
  };
});

vi.mock('../config/coordinator-env.js', async (importOriginal) => {
  const actual = await importOriginal() as typeof import('../config/coordinator-env.js');
  return {
    ...actual,
    isCoordinatorDispatchEnabled: () => mockIsCoordinatorEnabled(),
  };
});

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

vi.mock('../services/sdk-state.js', () => ({
  getAgents: (...args: unknown[]) => mockGetAgentsFn(...args),
}));

vi.mock('../services/charter-compiler.js', () => ({
  parseCharterContent: (...args: unknown[]) => mockParseCharterContent(...args),
  computeContentHash: (...args: unknown[]) => mockComputeContentHash(...args),
}));

vi.mock('node:fs/promises', () => ({
  default: {
    readdir: (...args: unknown[]) => mockFsReaddir(...args),
    readFile: (...args: unknown[]) => mockFsReadFile(...args),
    access:  (...args: unknown[]) => mockFsAccess(...args),
  },
}));

// ---------------------------------------------------------------------------
// Imports — AFTER mocks
// ---------------------------------------------------------------------------

import { dispatchViaCoordinator } from '../coordinator/dispatch.js';
import { dispatchBatchViaCoordinator, BatchDecisionCache, batchDecisionCache } from '../coordinator/batch.js';
import { decisionCache, CoordinatorDecisionCache } from '../coordinator/cache.js';
import { CoordinatorLlmParseError } from '../coordinator/llm-client.js';
import { buildCoordinatorDecisionRecord } from '../services/coordinator-decision-log.js';
import { pickupTodosSweep } from '../engine/sweeps/pickup-todos.js';
import { issueRunsRouter } from '../routes/runs.js';
import { syncAgentsFromDisk } from '../services/agent-sync.js';
import { resolveCoordinatorModelChain } from '../config/coordinator-env.js';
import type { CoordinatorInput, CoordinatorDecision, CoordinatorCallMeta } from '../coordinator/types.js';
import type { LlmCaller } from '../coordinator/llm-client.js';
import type { Request, Response, NextFunction } from 'express';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function makeInput(overrides: Partial<CoordinatorInput['issue']> = {}): CoordinatorInput {
  return {
    issue: {
      id: 'i-test',
      title: 'Fix login bug',
      body: 'Users cannot log in with email',
      labels: ['bug'],
      column: 'To Do',
      parentId: null,
      priority: 1,
      createdAt: '2024-01-01T00:00:00.000Z',
      ...overrides,
    },
    candidateAgents: [
      {
        name: 'verbal',
        role: 'implementer',
        charterHash: 'abcd1234',
        charterContent: '# Verbal\nImplements features.',
        capabilities: ['implement'],
        available: true,
      },
    ],
    project: { id: 'p-1', name: 'TestProject', rules: 'Move fast' },
    recentRuns: [],
  };
}

function makeDispatchDecision(agent = 'verbal'): CoordinatorDecision {
  return { kind: 'dispatch', agent, rationale: 'Best fit', confidence: 0.9 };
}

function makeSkipDecision(): CoordinatorDecision {
  return { kind: 'skip', reason: 'Not ready for implementation' };
}

function makeAmbiguousDecision(): CoordinatorDecision {
  return { kind: 'ambiguous', suggestedAgents: ['verbal', 'fenster'], question: 'Which domain?' };
}

function makeFakeLlmCaller(decision: CoordinatorDecision, delayMs = 0): LlmCaller {
  return {
    call: vi.fn().mockImplementation(async () => {
      if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
      return {
        text: JSON.stringify(decision),
        promptTokens: 100,
        completionTokens: 30,
        model: 'claude-haiku-4.5',
      };
    }),
  };
}

function makeBaseMeta(overrides: Partial<CoordinatorCallMeta> = {}): CoordinatorCallMeta {
  return {
    model: 'claude-haiku-4.5',
    promptTokens: 100,
    completionTokens: 30,
    durationMs: 150,
    cacheHit: false,
    inputHash: 'a'.repeat(64),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Sweep mock helpers (mirroring sweep-pickup-todos-coordinator.test.ts pattern)
// ---------------------------------------------------------------------------

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

function setupSweepMocks(opts: {
  todoIssues?: unknown[];
  coveredRuns?: unknown[];
  activeAgents?: unknown[];
  projectRow?: unknown[];
  busyAgents?: unknown[];
  recentRuns?: unknown[];
  circuitBreakerFailures?: unknown[];
} = {}) {
  mockSelectFn
    .mockReturnValueOnce(sel(opts.todoIssues   ?? [ISSUE_1]))
    .mockReturnValueOnce(sel(opts.coveredRuns  ?? []))
    .mockReturnValueOnce(sel(opts.activeAgents ?? [AGENT_VERBAL]))
    .mockReturnValueOnce(sel(opts.projectRow   ?? PROJECT_ROW))
    .mockReturnValueOnce(sel(opts.busyAgents   ?? []))
    .mockReturnValueOnce(sel(opts.recentRuns   ?? []))
    .mockReturnValueOnce(sel(opts.circuitBreakerFailures ?? []));
}

function setupSweepInsert(runId = 'new-run-id') {
  const mockReturning = vi.fn().mockResolvedValue([{ id: runId }]);
  const mockValues = vi.fn().mockReturnValue({ returning: mockReturning });
  mockInsertFn.mockReturnValue({ values: mockValues });
  return { mockValues, mockReturning };
}

// ---------------------------------------------------------------------------
// Route helpers (mirroring runs-coordinator-dispatch.test.ts pattern)
// ---------------------------------------------------------------------------

const ISSUE_ID   = 'issue-abc';
const PROJECT_ID = 'proj-xyz';
const AGENT_ID   = 'agent-verbal';
const AGENT_NAME = 'verbal';

const ISSUE_ROW = {
  id: ISSUE_ID, projectId: PROJECT_ID,
  title: 'Implement feature X', body: 'Do the thing',
  status: 'To Do', createdAt: new Date('2026-01-01T00:00:00Z'),
};
const PROJ_ROW  = { id: PROJECT_ID, name: 'Squadboard', description: 'Ship fast' };
const AGENT_ROW = {
  id: AGENT_ID, name: AGENT_NAME, role: 'implementer', status: 'active',
  charterHash: 'abc12345', charterContent: '# Verbal\nImplements features.',
  projectId: PROJECT_ID,
};
const RUN_ROW   = { id: 'run-001', issueId: ISSUE_ID, agentId: AGENT_ID, status: 'pending', createdAt: new Date() };

function makeChain(rows: unknown[]) {
  const chain = {
    from:    vi.fn().mockReturnThis(),
    where:   vi.fn().mockReturnThis(),
    limit:   vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    offset:  vi.fn().mockReturnThis(),
    then:    (onfulfilled: (v: unknown) => unknown) => Promise.resolve(rows).then(onfulfilled),
    catch:   (onrejected: (e: unknown) => unknown) => Promise.resolve(rows).catch(onrejected),
  };
  return chain;
}

let _routeSelectCallCount = 0;

function setupRouteSelectForCoordinator(overrides: {
  issueRow?: object | null;
  projectRow?: object | null;
  issueLabelRows?: object[];
  agentRows?: object[];
  busyRunRows?: object[];
  recentRunRows?: object[];
} = {}) {
  _routeSelectCallCount = 0;
  const {
    issueRow      = ISSUE_ROW,
    projectRow    = PROJ_ROW,
    issueLabelRows = [],
    agentRows     = [AGENT_ROW],
    busyRunRows   = [],
    recentRunRows = [],
  } = overrides;

  mockSelectFn.mockImplementation(() => {
    const call = ++_routeSelectCallCount;
    if (call === 1) return makeChain(issueRow ? [issueRow] : []);
    if (call === 2) return makeChain(projectRow ? [projectRow] : []);
    if (call === 3) return makeChain(issueLabelRows);
    if (call === 4) return makeChain(agentRows);
    if (call === 5) return makeChain(busyRunRows);
    return makeChain(recentRunRows);
  });
}

function setupRouteInsert(runRow: object = RUN_ROW) {
  mockInsertFn.mockReturnValue({
    values: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([runRow]),
    }),
  });
}

type RouteLayer = {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: (req: Request, res: Response, next: NextFunction) => void }>;
  };
};

function findRouteHandler(path: string, method: 'post') {
  const stack = (issueRunsRouter as unknown as { stack: RouteLayer[] }).stack;
  for (const layer of stack) {
    if (layer.route?.path === path && layer.route?.methods[method]) {
      return layer.route.stack[0]?.handle;
    }
  }
  return null;
}

function makeReq(params: Record<string, string>, body: Record<string, unknown> = {}) {
  return { params, query: {}, body };
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
// beforeEach / afterEach — isolate singletons and env between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.resetAllMocks();
  decisionCache.clear();
  batchDecisionCache.clear();
  mockIsCoordinatorEnabled.mockReturnValue(true);
  mockResolveRouteTier2Fn.mockResolvedValue(null);
  mockPersistCoordinatorDecision.mockResolvedValue(undefined);
});

afterEach(() => {
  delete process.env.COORDINATOR_MODEL;
  delete process.env.COORDINATOR_DISPATCH_ENABLED;
  delete process.env.COORDINATOR_MODEL_FALLBACKS;
});

// ===========================================================================
// GROUP A — Coordinator stack internals (direct, no DB)
// ===========================================================================

describe('GROUP A — Coordinator stack internals (inject LlmCaller directly)', () => {

  // -------------------------------------------------------------------------
  // Scenario 12: Telemetry — durationMs >= 10 when LLM sleeps
  // -------------------------------------------------------------------------
  describe('Scenario 12 — durationMs telemetry', () => {
    it('meta.durationMs >= 10 when LlmCaller sleeps 10ms', async () => {
      const slowCaller = makeFakeLlmCaller(makeDispatchDecision(), 10);
      const cache = new CoordinatorDecisionCache();

      const result = await dispatchViaCoordinator(makeInput(), {
        llmCaller: slowCaller,
        cache,
        bypassCache: true,
      });

      expect(result.meta.durationMs).toBeGreaterThanOrEqual(10);
      expect(result.decision.kind).toBe('dispatch');
    });

    it('cached result reports durationMs=0', async () => {
      const caller = makeFakeLlmCaller(makeDispatchDecision());
      const cache = new CoordinatorDecisionCache();
      const input = makeInput({ id: 'i-timing' });

      await dispatchViaCoordinator(input, { llmCaller: caller, cache });
      const hit = await dispatchViaCoordinator(input, { llmCaller: caller, cache });

      expect(hit.cacheHit).toBe(true);
      expect(hit.meta.durationMs).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 5: Cache hit — identical issue triggers cache, LLM called once
  // -------------------------------------------------------------------------
  describe('Scenario 5 — cache hit on second identical issue', () => {
    it('second identical call gets cacheHit:true and LLM called only once', async () => {
      const caller = makeFakeLlmCaller(makeDispatchDecision());
      const cache = new CoordinatorDecisionCache();
      const input = makeInput({ id: 'i-cache-test' });

      const first = await dispatchViaCoordinator(input, { llmCaller: caller, cache });
      const second = await dispatchViaCoordinator(input, { llmCaller: caller, cache });

      expect(first.cacheHit).toBe(false);
      expect(second.cacheHit).toBe(true);
      expect(second.meta.cacheHit).toBe(true);
      expect(second.decision).toEqual(makeDispatchDecision());

      // LLM mock was called exactly once
      expect((caller.call as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
    });

    it('different issues get separate cache entries (no collision)', async () => {
      const caller = makeFakeLlmCaller(makeDispatchDecision());
      const cache = new CoordinatorDecisionCache();

      const inputA = makeInput({ id: 'i-unique-a' });
      const inputB = makeInput({ id: 'i-unique-b' });

      await dispatchViaCoordinator(inputA, { llmCaller: caller, cache });
      const result = await dispatchViaCoordinator(inputB, { llmCaller: caller, cache });

      // inputB is not cached (different id → different hash)
      expect(result.cacheHit).toBe(false);
      expect((caller.call as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
    });

    it('singleton decisionCache cleared in beforeEach does not retain state between tests', async () => {
      // If beforeEach didn't clear the cache, a previously cached 'i-test' entry
      // would produce cacheHit:true here. This test verifies isolation.
      const caller = makeFakeLlmCaller(makeDispatchDecision());
      const result = await dispatchViaCoordinator(makeInput(), { llmCaller: caller });

      expect(result.cacheHit).toBe(false); // fresh cache — always a miss
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 13: Parse error — LLM returns invalid JSON → CoordinatorLlmParseError
  // -------------------------------------------------------------------------
  describe('Scenario 13 — parse error path', () => {
    it('CoordinatorLlmParseError thrown when LLM returns non-JSON', async () => {
      const badCaller: LlmCaller = {
        call: vi.fn().mockResolvedValue({
          text: 'Sorry, I cannot make this decision right now.',
          promptTokens: 10,
          completionTokens: 5,
          model: 'claude-haiku-4.5',
        }),
      };
      const cache = new CoordinatorDecisionCache();

      await expect(
        dispatchViaCoordinator(makeInput(), { llmCaller: badCaller, cache, bypassCache: true }),
      ).rejects.toBeInstanceOf(CoordinatorLlmParseError);
    });

    it('CoordinatorLlmParseError.rawText matches what LLM returned', async () => {
      const rawOutput = 'NOT_JSON_AT_ALL';
      const badCaller: LlmCaller = {
        call: vi.fn().mockResolvedValue({
          text: rawOutput,
          promptTokens: 5,
          completionTokens: 3,
          model: 'claude-haiku-4.5',
        }),
      };
      const cache = new CoordinatorDecisionCache();

      let caught: unknown;
      try {
        await dispatchViaCoordinator(makeInput(), { llmCaller: badCaller, cache, bypassCache: true });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(CoordinatorLlmParseError);
      expect((caught as CoordinatorLlmParseError).rawText).toBe(rawOutput);
    });

    it('parse error propagates — nothing is cached for the failing input', async () => {
      const badCaller: LlmCaller = {
        call: vi.fn().mockResolvedValue({
          text: 'invalid json',
          promptTokens: 5,
          completionTokens: 2,
          model: 'claude-haiku-4.5',
        }),
      };
      const goodCaller = makeFakeLlmCaller(makeDispatchDecision());
      const cache = new CoordinatorDecisionCache();
      const input = makeInput({ id: 'i-parse-err' });

      // First call throws — nothing should be cached
      await expect(
        dispatchViaCoordinator(input, { llmCaller: badCaller, cache, bypassCache: true }),
      ).rejects.toBeInstanceOf(CoordinatorLlmParseError);

      // Second call with good caller should NOT get cache hit
      const result = await dispatchViaCoordinator(input, { llmCaller: goodCaller, cache });
      expect(result.cacheHit).toBe(false);
      expect((goodCaller.call as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 14: Zod validation — LLM returns dispatch JSON with no agentId
  // -------------------------------------------------------------------------
  describe('Scenario 14 — Zod validation of LLM output', () => {
    it('CoordinatorLlmParseError when dispatch JSON missing required agent field', async () => {
      const malformedCaller: LlmCaller = {
        call: vi.fn().mockResolvedValue({
          text: JSON.stringify({ kind: 'dispatch', rationale: 'ok', confidence: 0.9 }), // missing 'agent'
          promptTokens: 15,
          completionTokens: 8,
          model: 'claude-haiku-4.5',
        }),
      };
      const cache = new CoordinatorDecisionCache();

      // callCoordinatorLlm converts ZodError to CoordinatorLlmParseError
      await expect(
        dispatchViaCoordinator(makeInput(), { llmCaller: malformedCaller, cache, bypassCache: true }),
      ).rejects.toBeInstanceOf(CoordinatorLlmParseError);
    });

    it('ZodError thrown on bad CoordinatorInput — no LLM call made', async () => {
      const caller = makeFakeLlmCaller(makeDispatchDecision());
      const cache = new CoordinatorDecisionCache();

      const badInput = {
        ...makeInput(),
        issue: { ...makeInput().issue, id: undefined as unknown as string },
      };

      await expect(
        dispatchViaCoordinator(badInput as unknown as CoordinatorInput, { llmCaller: caller, cache }),
      ).rejects.toThrow();

      expect((caller.call as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
    });

    it('CoordinatorLlmParseError when LLM returns unknown kind', async () => {
      const unknownKindCaller: LlmCaller = {
        call: vi.fn().mockResolvedValue({
          text: JSON.stringify({ kind: 'defer', agent: 'verbal', rationale: 'defer it' }),
          promptTokens: 10,
          completionTokens: 5,
          model: 'claude-haiku-4.5',
        }),
      };
      const cache = new CoordinatorDecisionCache();

      await expect(
        dispatchViaCoordinator(makeInput(), { llmCaller: unknownKindCaller, cache, bypassCache: true }),
      ).rejects.toBeInstanceOf(CoordinatorLlmParseError);
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 11: Decision log shape (pure builder — no DB needed)
  // -------------------------------------------------------------------------
  describe('Scenario 11 — Decision log record shape', () => {
    it('dispatch decision log has correct shape with decision + meta + persistedAt', () => {
      const decision = makeDispatchDecision();
      const meta = makeBaseMeta();

      const record = buildCoordinatorDecisionRecord(decision, meta);

      expect(record.decision).toEqual(decision);
      expect(record.meta).toEqual(meta);
      expect(typeof record.persistedAt).toBe('string');
      // persistedAt must be a valid ISO 8601 string
      expect(() => new Date(record.persistedAt)).not.toThrow();
      expect(new Date(record.persistedAt).toISOString()).toBe(record.persistedAt);
    });

    it('skip decision log has correct shape', () => {
      const decision = makeSkipDecision();
      const record = buildCoordinatorDecisionRecord(decision, makeBaseMeta());

      expect(record.decision).toEqual(decision);
      expect(record.decision.kind).toBe('skip');
    });

    it('ambiguous decision log has correct shape', () => {
      const decision = makeAmbiguousDecision();
      const record = buildCoordinatorDecisionRecord(decision, makeBaseMeta());

      expect(record.decision).toEqual(decision);
      expect(record.decision.kind).toBe('ambiguous');
    });

    it('decision log survives JSON roundtrip with same shape', () => {
      const record = buildCoordinatorDecisionRecord(makeDispatchDecision(), makeBaseMeta());
      const roundtripped = JSON.parse(JSON.stringify(record));

      expect(roundtripped.decision).toEqual(record.decision);
      expect(roundtripped.meta).toEqual(record.meta);
      expect(roundtripped.persistedAt).toBe(record.persistedAt);
    });
  });

});

// ===========================================================================
// GROUP B — Batch coordinator
// ===========================================================================

describe('GROUP B — Batch coordinator (inject LlmCaller directly)', () => {

  // -------------------------------------------------------------------------
  // Scenario 8: 3 issues → single LLM call → 3 decisions
  // -------------------------------------------------------------------------
  describe('Scenario 8 — batch dispatch 3 issues', () => {
    it('dispatchBatchViaCoordinator: single LLM call returns 3 decisions for 3 issues', async () => {
      const issueIds = ['batch-i-1', 'batch-i-2', 'batch-i-3'];

      const batchOutput = {
        decisions: issueIds.map((id, i) => ({
          issueId: id,
          decision: i === 1
            ? { kind: 'skip', reason: 'Already done' }
            : { kind: 'dispatch', agent: 'verbal', rationale: 'Best fit', confidence: 0.9 },
        })),
      };

      const batchCaller: LlmCaller = {
        call: vi.fn().mockResolvedValue({
          text: JSON.stringify(batchOutput),
          promptTokens: 300,
          completionTokens: 90,
          model: 'claude-haiku-4.5',
        }),
      };

      const cache = new BatchDecisionCache();
      const batchInput = {
        issues: issueIds.map(id => makeInput({ id })),
      };

      const result = await dispatchBatchViaCoordinator(batchInput, {
        llmCaller: batchCaller,
        cache,
      });

      // Single LLM call for all 3 issues
      expect((batchCaller.call as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
      expect(result.output.decisions).toHaveLength(3);
      expect(result.output.decisions[0].issueId).toBe('batch-i-1');
      expect(result.output.decisions[0].decision.kind).toBe('dispatch');
      expect(result.output.decisions[1].decision.kind).toBe('skip');
      expect(result.output.decisions[2].decision.kind).toBe('dispatch');
      expect(result.meta.cacheHit).toBe(false);
    });

    it('batch second identical call hits cache — no second LLM call', async () => {
      const issueIds = ['batch-cache-1', 'batch-cache-2'];
      const batchOutput = {
        decisions: issueIds.map(id => ({
          issueId: id,
          decision: { kind: 'dispatch', agent: 'verbal', rationale: 'ok', confidence: 0.8 },
        })),
      };
      const batchCaller: LlmCaller = {
        call: vi.fn().mockResolvedValue({
          text: JSON.stringify(batchOutput),
          promptTokens: 200,
          completionTokens: 60,
          model: 'claude-haiku-4.5',
        }),
      };
      const cache = new BatchDecisionCache();
      const batchInput = { issues: issueIds.map(id => makeInput({ id })) };

      await dispatchBatchViaCoordinator(batchInput, { llmCaller: batchCaller, cache });
      const second = await dispatchBatchViaCoordinator(batchInput, { llmCaller: batchCaller, cache });

      expect((batchCaller.call as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
      expect(second.meta.cacheHit).toBe(true);
      expect(second.output.decisions).toHaveLength(2);
    });

    it('batch parse error propagates CoordinatorLlmParseError', async () => {
      const badBatchCaller: LlmCaller = {
        call: vi.fn().mockResolvedValue({
          text: 'This is not JSON',
          promptTokens: 10,
          completionTokens: 5,
          model: 'claude-haiku-4.5',
        }),
      };
      const cache = new BatchDecisionCache();
      const batchInput = { issues: [makeInput({ id: 'batch-parse-err' })] };

      await expect(
        dispatchBatchViaCoordinator(batchInput, { llmCaller: badBatchCaller, cache }),
      ).rejects.toBeInstanceOf(CoordinatorLlmParseError);
    });
  });

});

// ===========================================================================
// GROUP C — Sweep integration (real coordinator + fake LlmCaller via module mock)
// ===========================================================================

describe('GROUP C — Sweep integration (real coordinator, mocked DB + LLM)', () => {

  // -------------------------------------------------------------------------
  // Scenario 1: Happy path dispatch via sweep
  // -------------------------------------------------------------------------
  describe('Scenario 1 — happy path dispatch via sweep', () => {
    it('sweep calls real coordinator → dispatch decision → run created with tier=1 → coordinator_decision persisted', async () => {
      setupSweepMocks();
      const { mockValues } = setupSweepInsert('run-abc');

      mockSweepLlmCallerCall.mockResolvedValue({
        text: JSON.stringify(makeDispatchDecision('verbal')),
        promptTokens: 100,
        completionTokens: 30,
        model: 'claude-haiku-4.5',
      });

      const result = await pickupTodosSweep.run();

      expect(result.acted).toBe(1);
      expect(result.errors).toBe(0);

      // Run inserted with correct tier
      expect(mockInsertFn).toHaveBeenCalledOnce();
      expect(mockValues).toHaveBeenCalledWith(
        expect.objectContaining({
          issueId: ISSUE_1.id,
          agentId: AGENT_VERBAL.id,
          routingTier: 1,
        }),
      );

      // coordinator_decision was persisted (MC-10 integration)
      expect(mockPersistCoordinatorDecision).toHaveBeenCalledOnce();
      const [runId, decision] = mockPersistCoordinatorDecision.mock.calls[0] as [string, CoordinatorDecision, CoordinatorCallMeta];
      expect(runId).toBe('run-abc');
      expect(decision.kind).toBe('dispatch');
      expect((decision as { agent: string }).agent).toBe('verbal');
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 3: Skip path in sweep — no run created
  // -------------------------------------------------------------------------
  describe('Scenario 3 — skip path in sweep', () => {
    it('coordinator skip → no run inserted, acted=0, persistCoordinatorDecision NOT called', async () => {
      // Skip doesn't reach circuit-breaker query — only 6 select calls
      mockSelectFn
        .mockReturnValueOnce(sel([ISSUE_1]))
        .mockReturnValueOnce(sel([]))
        .mockReturnValueOnce(sel([AGENT_VERBAL]))
        .mockReturnValueOnce(sel(PROJECT_ROW))
        .mockReturnValueOnce(sel([]))
        .mockReturnValueOnce(sel([]));

      mockSweepLlmCallerCall.mockResolvedValue({
        text: JSON.stringify(makeSkipDecision()),
        promptTokens: 80,
        completionTokens: 20,
        model: 'claude-haiku-4.5',
      });

      const result = await pickupTodosSweep.run();

      expect(result.acted).toBe(0);
      expect(result.errors).toBe(0);
      expect(mockInsertFn).not.toHaveBeenCalled();
      expect(mockPersistCoordinatorDecision).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 4: Ambiguous path in sweep — falls through to tier-2
  // -------------------------------------------------------------------------
  describe('Scenario 4 — ambiguous path in sweep', () => {
    it('coordinator ambiguous → tier-2 fallback → run created with tier=2', async () => {
      mockSelectFn
        .mockReturnValueOnce(sel([ISSUE_1]))
        .mockReturnValueOnce(sel([]))
        .mockReturnValueOnce(sel([AGENT_VERBAL]))
        .mockReturnValueOnce(sel(PROJECT_ROW))
        .mockReturnValueOnce(sel([]))
        .mockReturnValueOnce(sel([]))
        .mockReturnValueOnce(sel([])); // circuit breaker

      const { mockValues } = setupSweepInsert('run-ambig');

      mockSweepLlmCallerCall.mockResolvedValue({
        text: JSON.stringify(makeAmbiguousDecision()),
        promptTokens: 90,
        completionTokens: 25,
        model: 'claude-haiku-4.5',
      });
      mockResolveRouteTier2Fn.mockResolvedValue({
        agentId: AGENT_VERBAL.id,
        score: 7,
        reasoning: 'keyword match',
      });

      const result = await pickupTodosSweep.run();

      expect(result.acted).toBe(1);
      expect(mockResolveRouteTier2Fn).toHaveBeenCalledOnce();
      expect(mockValues).toHaveBeenCalledWith(
        expect.objectContaining({ routingTier: 2, agentId: AGENT_VERBAL.id }),
      );
      // persistCoordinatorDecision NOT called — decision was ambiguous, not dispatch
      expect(mockPersistCoordinatorDecision).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 6: Feature flag disabled in sweep
  // -------------------------------------------------------------------------
  describe('Scenario 6 — feature flag disabled in sweep', () => {
    it('COORDINATOR_DISPATCH_ENABLED=false → LLM never called, tier-2 runs directly', async () => {
      mockIsCoordinatorEnabled.mockReturnValue(false);

      // With flag off: no recentRuns query, no coordinator call (6 selects, not 7)
      mockSelectFn
        .mockReturnValueOnce(sel([ISSUE_1]))
        .mockReturnValueOnce(sel([]))
        .mockReturnValueOnce(sel([AGENT_VERBAL]))
        .mockReturnValueOnce(sel(PROJECT_ROW))
        .mockReturnValueOnce(sel([]))
        .mockReturnValueOnce(sel([])); // circuit breaker

      setupSweepInsert();

      mockResolveRouteTier2Fn.mockResolvedValue({
        agentId: AGENT_VERBAL.id,
        score: 6,
        reasoning: 'keyword match',
      });

      const result = await pickupTodosSweep.run();

      expect(result.acted).toBe(1);
      expect(mockSweepLlmCallerCall).not.toHaveBeenCalled();
      expect(mockResolveRouteTier2Fn).toHaveBeenCalledOnce();
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 10: Charter context flows to coordinator input
  // -------------------------------------------------------------------------
  describe('Scenario 10 — charter context in coordinator input', () => {
    it('candidateAgents includes charterContent from DB column', async () => {
      const agentWithCharter = {
        ...AGENT_VERBAL,
        charterContent: '# Verbal\n\nSpecialist in auth systems.',
        charterHash: 'aabbccdd',
      };

      mockSelectFn
        .mockReturnValueOnce(sel([ISSUE_1]))
        .mockReturnValueOnce(sel([]))
        .mockReturnValueOnce(sel([agentWithCharter]))
        .mockReturnValueOnce(sel(PROJECT_ROW))
        .mockReturnValueOnce(sel([]))
        .mockReturnValueOnce(sel([]))
        .mockReturnValueOnce(sel([]));

      setupSweepInsert();

      let capturedInput: CoordinatorInput | null = null;
      mockSweepLlmCallerCall.mockImplementation(async (opts: { messages: Array<{ role: string; content: string }> }) => {
        // The user message contains the JSON-stringified CoordinatorInput
        const userMsg = opts.messages.find((m: { role: string }) => m.role === 'user');
        if (userMsg) {
          capturedInput = JSON.parse(userMsg.content) as CoordinatorInput;
        }
        return {
          text: JSON.stringify(makeDispatchDecision('verbal')),
          promptTokens: 100,
          completionTokens: 30,
          model: 'claude-haiku-4.5',
        };
      });

      await pickupTodosSweep.run();

      expect(capturedInput).not.toBeNull();
      const agents = capturedInput!.candidateAgents;
      expect(agents).toHaveLength(1);
      expect(agents[0].charterContent).toBe('# Verbal\n\nSpecialist in auth systems.');
      expect(agents[0].charterHash).toBe('aabbccdd');
      expect(agents[0].name).toBe('verbal');
    });

    it('empty charterContent is forwarded as empty string (tolerant path)', async () => {
      const agentNoCharter = { ...AGENT_VERBAL, charterContent: '', charterHash: null };

      mockSelectFn
        .mockReturnValueOnce(sel([ISSUE_1]))
        .mockReturnValueOnce(sel([]))
        .mockReturnValueOnce(sel([agentNoCharter]))
        .mockReturnValueOnce(sel(PROJECT_ROW))
        .mockReturnValueOnce(sel([]))
        .mockReturnValueOnce(sel([]))
        .mockReturnValueOnce(sel([]));

      setupSweepInsert();

      let capturedInput: CoordinatorInput | null = null;
      mockSweepLlmCallerCall.mockImplementation(async (opts: { messages: Array<{ role: string; content: string }> }) => {
        const userMsg = opts.messages.find((m: { role: string }) => m.role === 'user');
        if (userMsg) capturedInput = JSON.parse(userMsg.content) as CoordinatorInput;
        return {
          text: JSON.stringify(makeDispatchDecision('verbal')),
          promptTokens: 80,
          completionTokens: 20,
          model: 'claude-haiku-4.5',
        };
      });

      await pickupTodosSweep.run();

      expect(capturedInput).not.toBeNull();
      expect(capturedInput!.candidateAgents[0].charterContent).toBe('');
      expect(capturedInput!.candidateAgents[0].charterHash).toBe(''); // null coerced to ''
    });
  });

});

// ===========================================================================
// GROUP D — Route integration (real coordinator + fake LlmCaller via module mock)
// ===========================================================================

describe('GROUP D — Route integration (real coordinator, mocked DB + LLM)', () => {

  // -------------------------------------------------------------------------
  // Scenario 2: Happy path dispatch via route
  // -------------------------------------------------------------------------
  describe('Scenario 2 — happy path via POST /runs (no agentId)', () => {
    it('returns 201 with run + coordinator decision when coordinator dispatches', async () => {
      setupRouteSelectForCoordinator();
      setupRouteInsert();

      mockSweepLlmCallerCall.mockResolvedValue({
        text: JSON.stringify(makeDispatchDecision(AGENT_NAME)),
        promptTokens: 100,
        completionTokens: 30,
        model: 'claude-haiku-4.5',
      });

      const handler = findRouteHandler('/', 'post')!;
      const req = makeReq({ issueId: ISSUE_ID }, {});
      const res = makeRes();

      await handler(req as unknown as Request, res as unknown as Response, vi.fn());

      expect(res._status).toBe(201);
      const body = res._body as Record<string, unknown>;
      expect(body.id).toBe('run-001');
      // Coordinator decision included in response body (MC-8 integration)
      expect((body._coordinatorDecision as Record<string, unknown>).kind).toBe('dispatch');
    });

    it('coordinator_decision is persisted as fire-and-forget after run inserted', async () => {
      setupRouteSelectForCoordinator();
      setupRouteInsert();

      mockSweepLlmCallerCall.mockResolvedValue({
        text: JSON.stringify(makeDispatchDecision(AGENT_NAME)),
        promptTokens: 100,
        completionTokens: 30,
        model: 'claude-haiku-4.5',
      });

      const handler = findRouteHandler('/', 'post')!;
      await handler(
        makeReq({ issueId: ISSUE_ID }, {}) as unknown as Request,
        makeRes() as unknown as Response,
        vi.fn(),
      );

      expect(mockPersistCoordinatorDecision).toHaveBeenCalledOnce();
      const [runId, decision] = mockPersistCoordinatorDecision.mock.calls[0] as [string, CoordinatorDecision];
      expect(runId).toBe('run-001');
      expect(decision.kind).toBe('dispatch');
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 3 (route): Skip → 422
  // -------------------------------------------------------------------------
  describe('Scenario 3 (route) — coordinator skip → 422', () => {
    it('returns 422 with reason when coordinator skips', async () => {
      setupRouteSelectForCoordinator();

      mockSweepLlmCallerCall.mockResolvedValue({
        text: JSON.stringify(makeSkipDecision()),
        promptTokens: 80,
        completionTokens: 20,
        model: 'claude-haiku-4.5',
      });

      const handler = findRouteHandler('/', 'post')!;
      const res = makeRes();
      await handler(makeReq({ issueId: ISSUE_ID }, {}) as unknown as Request, res as unknown as Response, vi.fn());

      expect(res._status).toBe(422);
      const body = res._body as Record<string, unknown>;
      expect(body.error).toMatch(/skip/i);
      expect(body.reason).toBe('Not ready for implementation');
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 4 (route): Ambiguous → 409 with candidates
  // -------------------------------------------------------------------------
  describe('Scenario 4 (route) — coordinator ambiguous → 409', () => {
    it('returns 409 with candidates list when coordinator is ambiguous', async () => {
      setupRouteSelectForCoordinator();

      mockSweepLlmCallerCall.mockResolvedValue({
        text: JSON.stringify(makeAmbiguousDecision()),
        promptTokens: 90,
        completionTokens: 25,
        model: 'claude-haiku-4.5',
      });

      const handler = findRouteHandler('/', 'post')!;
      const res = makeRes();
      await handler(makeReq({ issueId: ISSUE_ID }, {}) as unknown as Request, res as unknown as Response, vi.fn());

      expect(res._status).toBe(409);
      const body = res._body as Record<string, unknown>;
      expect(body.candidates).toEqual(['verbal', 'fenster']);
      expect(body.question).toBe('Which domain?');
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 6 (route): Feature flag disabled → 400
  // -------------------------------------------------------------------------
  describe('Scenario 6 (route) — feature flag disabled → 400', () => {
    it('returns 400 when COORDINATOR_DISPATCH_ENABLED=false and no agentId provided', async () => {
      mockIsCoordinatorEnabled.mockReturnValue(false);

      const handler = findRouteHandler('/', 'post')!;
      const res = makeRes();
      await handler(makeReq({ issueId: ISSUE_ID }, {}) as unknown as Request, res as unknown as Response, vi.fn());

      expect(res._status).toBe(400);
      const body = res._body as Record<string, unknown>;
      expect(body.error).toMatch(/coordinator dispatch is disabled/i);
      expect(body.error).toMatch(/agentId/);
      expect(mockSweepLlmCallerCall).not.toHaveBeenCalled();
    });
  });

});

// ===========================================================================
// GROUP E — Cross-cutting
// ===========================================================================

describe('GROUP E — Cross-cutting (drift detection, model chain, env config)', () => {

  // -------------------------------------------------------------------------
  // Scenario 7: Model fallback chain — documented current behavior
  // -------------------------------------------------------------------------
  describe('Scenario 7 — model fallback chain', () => {
    it('resolveCoordinatorModelChain returns primary + deduped fallbacks', () => {
      const chain = resolveCoordinatorModelChain({
        COORDINATOR_MODEL: 'claude-sonnet-4.5',
        COORDINATOR_MODEL_FALLBACKS: 'gpt-5.4-mini,gpt-4.1,claude-sonnet-4.5',
      });

      // Primary is first; duplicate claude-sonnet-4.5 is deduped
      expect(chain[0]).toBe('claude-sonnet-4.5');
      expect(chain).toContain('gpt-5.4-mini');
      expect(chain).toContain('gpt-4.1');
      expect(chain.filter(m => m === 'claude-sonnet-4.5')).toHaveLength(1); // no dupe
    });

    it('BUG-1: dispatchViaCoordinator does NOT retry fallbacks — primary error propagates directly', async () => {
      // Scenario 7 documents that the fallback chain (resolveCoordinatorModelChain)
      // is NOT wired into dispatchViaCoordinator. When the primary model fails,
      // the error is thrown immediately with no retry.
      //
      // Expected future behaviour: if primary model throws, dispatch should try
      // gpt-5.4-mini, then gpt-5.1-codex-mini, etc.
      //
      // Current (buggy) behaviour: error from the primary model propagates.
      const failingCaller: LlmCaller = {
        call: vi.fn().mockRejectedValue(new Error('Rate limit exceeded')),
      };
      const cache = new CoordinatorDecisionCache();

      // Assert current (broken) behaviour: error propagates, no fallback
      await expect(
        dispatchViaCoordinator(makeInput(), { llmCaller: failingCaller, cache, bypassCache: true }),
      ).rejects.toThrow('Rate limit exceeded');

      // If fallback were implemented, call count would be > 1 (primary + fallbacks).
      // Current implementation: single call, then throw.
      expect((failingCaller.call as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 9: Drift detection via agent-sync
  // -------------------------------------------------------------------------
  describe('Scenario 9 — agent-sync drift detection', () => {
    const PROJECT_ID_DRIFT = 'proj-drift';
    const SQUAD_PATH = '/fake/squad';
    const OLD_CHARTER = '# Verbal\n\nOld content.';
    const NEW_CHARTER = '# Verbal\n\nNew content — charter updated.';
    const OLD_HASH = 'oldhash123';
    const NEW_HASH = 'newhash456';

    function setupDriftMocks(opts: {
      existingRow?: object | null;
      newCharter?: string;
      newHash?: string;
    } = {}) {
      const { existingRow = null, newCharter = NEW_CHARTER, newHash = NEW_HASH } = opts;

      // SDK agents.list() throws → fallback to fs.readdir
      mockGetAgentsFn.mockRejectedValue(new Error('SDK not available'));

      // fs.readdir returns ['verbal']
      mockFsReaddir.mockResolvedValue([
        { isDirectory: () => true, name: 'verbal' },
      ]);

      // fs.access succeeds (history file does NOT exist)
      mockFsAccess.mockImplementation(async (p: string) => {
        if (String(p).includes('history.md')) throw new Error('ENOENT');
        // charter.md access succeeds
      });

      // fs.readFile returns new charter content
      mockFsReadFile.mockResolvedValue(newCharter);

      // parseCharterContent returns basic metadata
      mockParseCharterContent.mockReturnValue({ role: 'implementer', model: 'claude-haiku-4.5' });

      // computeContentHash returns the new hash
      mockComputeContentHash.mockReturnValue(newHash);

      // DB: SELECT existing agent row
      const existingRows = existingRow ? [existingRow] : [];
      const mockUpdate = vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      });
      const mockInsertChain = {
        values: vi.fn().mockResolvedValue([]),
      };

      mockSelectFn
        .mockReturnValueOnce(sel(existingRows))  // per-agent lookup
        .mockReturnValueOnce(sel(existingRows.length > 0 ? [existingRow!] : [])); // all-rows for retire step

      mockInsertFn.mockReturnValue(mockInsertChain);

      // Override getDb for update chain
      return { mockUpdate, mockInsertChain };
    }

    it('new agent on disk → DB INSERT called with charterContent', async () => {
      // SDK fails → fs fallback → agent not in DB → INSERT
      mockGetAgentsFn.mockRejectedValue(new Error('SDK not available'));
      mockFsReaddir.mockResolvedValue([{ isDirectory: () => true, name: 'verbal' }]);
      mockFsAccess.mockImplementation(async (p: string) => {
        if (String(p).includes('history.md')) throw new Error('ENOENT');
      });
      mockFsReadFile.mockResolvedValue(NEW_CHARTER);
      mockParseCharterContent.mockReturnValue({ role: 'implementer', model: null });
      mockComputeContentHash.mockReturnValue(NEW_HASH);

      const mockInsertValues = vi.fn().mockResolvedValue([]);
      mockInsertFn.mockReturnValue({ values: mockInsertValues });

      // DB SELECT returns empty (no existing row)
      mockSelectFn
        .mockReturnValueOnce(sel([]))  // per-agent lookup
        .mockReturnValueOnce(sel([])); // all-rows for retire step

      const result = await syncAgentsFromDisk(PROJECT_ID_DRIFT, SQUAD_PATH);

      expect(result.added).toBe(1);
      expect(result.updated).toBe(0);
      expect(mockInsertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'verbal',
          charterContent: NEW_CHARTER,
          charterHash: NEW_HASH,
        }),
      );
    });

    it('existing agent with changed charter → DB UPDATE called with new charterContent', async () => {
      const existingRow = {
        id: 'agent-123',
        name: 'verbal',
        role: 'implementer',
        model: null,
        status: 'active',
        charterHash: OLD_HASH,
        charterContent: OLD_CHARTER,
        historyPath: null,
      };

      mockGetAgentsFn.mockRejectedValue(new Error('SDK not available'));
      mockFsReaddir.mockResolvedValue([{ isDirectory: () => true, name: 'verbal' }]);
      mockFsAccess.mockImplementation(async (p: string) => {
        if (String(p).includes('history.md')) throw new Error('ENOENT');
      });
      mockFsReadFile.mockResolvedValue(NEW_CHARTER);
      mockParseCharterContent.mockReturnValue({ role: 'implementer', model: null });
      mockComputeContentHash.mockReturnValue(NEW_HASH); // hash changed!

      const mockUpdateWhere = vi.fn().mockResolvedValue([]);
      const mockUpdateSet = vi.fn().mockReturnValue({ where: mockUpdateWhere });
      // Wire the module-level mockUpdateFn for this test
      mockUpdateFn.mockReturnValue({ set: mockUpdateSet });

      mockSelectFn
        .mockReturnValueOnce(sel([existingRow])) // per-agent lookup
        .mockReturnValueOnce(sel([existingRow])); // all-rows for retire step

      const result = await syncAgentsFromDisk(PROJECT_ID_DRIFT, SQUAD_PATH);

      expect(result.updated).toBe(1);
      expect(result.added).toBe(0);

      // UPDATE was called with the new charter content
      expect(mockUpdateSet).toHaveBeenCalledWith(
        expect.objectContaining({
          charterContent: NEW_CHARTER,
          charterHash: NEW_HASH,
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Env config integration
  // -------------------------------------------------------------------------
  describe('Coordinator env config integration', () => {
    it('resolveCoordinatorModelChain deduplicates primary model when it appears in fallbacks', () => {
      const chain = resolveCoordinatorModelChain({
        COORDINATOR_MODEL: 'claude-sonnet-4.5',
        COORDINATOR_MODEL_FALLBACKS: 'gpt-5.4-mini,gpt-4.1,claude-sonnet-4.5',
      });

      // Primary is first; duplicate claude-sonnet-4.5 at end is removed
      expect(chain[0]).toBe('claude-sonnet-4.5');
      expect(chain).toContain('gpt-5.4-mini');
      expect(chain).toContain('gpt-4.1');
      expect(chain.filter(m => m === 'claude-sonnet-4.5')).toHaveLength(1);
    });

    it('resolveCoordinatorModelChain uses defaults when env is empty', () => {
      const chain = resolveCoordinatorModelChain({});

      expect(chain[0]).toBe('claude-haiku-4.5');
      expect(chain.length).toBeGreaterThan(1);
    });

    it('COORDINATOR_MODEL env var is forwarded to LLM caller as model parameter', async () => {
      process.env.COORDINATOR_MODEL = 'claude-opus-4.5';
      const caller = makeFakeLlmCaller(makeDispatchDecision());
      const cache = new CoordinatorDecisionCache();

      await dispatchViaCoordinator(makeInput(), { llmCaller: caller, cache, bypassCache: true });

      const callArgs = (caller.call as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(callArgs.model).toBe('claude-opus-4.5');
    });

    it('opts.model overrides COORDINATOR_MODEL env var', async () => {
      process.env.COORDINATOR_MODEL = 'claude-haiku-4.5';
      const caller = makeFakeLlmCaller(makeDispatchDecision());
      const cache = new CoordinatorDecisionCache();

      await dispatchViaCoordinator(makeInput(), {
        llmCaller: caller,
        cache,
        bypassCache: true,
        model: 'gpt-5.4-mini',
      });

      const callArgs = (caller.call as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(callArgs.model).toBe('gpt-5.4-mini');
    });
  });

});
