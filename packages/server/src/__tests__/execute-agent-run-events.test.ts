/**
 * execute-agent-run-events.test.ts — Wave 28 JIS-T3 regression
 *
 * Verifies that executeAgentRun() publishes the correct sequence of
 * issue_run events for success and failure paths.
 *
 * Event tracking is via mockEmitIssueRunEvent (the event bus mock).
 * The emit() function always calls eventBus.emitIssueRunEvent() regardless
 * of DB errors, so this is the most reliable assertion surface.
 *
 *   Success: issue.run.start → issue.run.turn → issue.run.metric → issue.run.finish
 *   Error:   issue.run.start → issue.run.error
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// vi.hoisted(): variables used inside vi.mock() factories must be hoisted
// so they are initialized before factory closures are evaluated.
// ---------------------------------------------------------------------------

const {
  mockEmitIssueRunEvent,
  registeredSessions,
  getAgentSessionResult,
  getAgentSessionError,
  setAgentSessionError,
  setAgentSessionResult,
  getAgentSessionEvents,
  setAgentSessionEvents,
} = vi.hoisted(() => {
  const mockEmitIssueRunEvent = vi.fn();
  const registeredSessions = new Map<string, unknown>();
  type MockAgentSessionEvent = { type: string; payload: Record<string, unknown> };

  let _agentSessionError: Error | null = null;
  let _agentSessionEvents: MockAgentSessionEvent[] = [];
  let _agentSessionResult = {
    output: 'Agent produced this output.',
    resolvedModel: 'gpt-4o',
    inputTokens: 100,
    outputTokens: 200,
    tokensUsed: 300,
    costUsd: '0.01',
  };

  return {
    mockEmitIssueRunEvent,
    registeredSessions,
    getAgentSessionResult: () => _agentSessionResult,
    getAgentSessionError: () => _agentSessionError,
    setAgentSessionError: (e: Error | null) => { _agentSessionError = e; },
    setAgentSessionResult: (r: typeof _agentSessionResult) => { _agentSessionResult = r; },
    getAgentSessionEvents: () => _agentSessionEvents,
    setAgentSessionEvents: (events: MockAgentSessionEvent[]) => { _agentSessionEvents = events; },
  };
});

// ---------------------------------------------------------------------------
// DB mock
// ---------------------------------------------------------------------------

const mockWhere = vi.fn().mockResolvedValue([]);
const mockFrom  = vi.fn().mockReturnValue({ where: mockWhere });
const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });

const mockInsertValues = vi.fn().mockResolvedValue(undefined);
const mockInsert = vi.fn().mockReturnValue({ values: mockInsertValues });

const mockUpdateWhere = vi.fn().mockResolvedValue(undefined);
const mockUpdateSet   = vi.fn().mockReturnValue({ where: mockUpdateWhere });
const mockUpdate = vi.fn().mockReturnValue({ set: mockUpdateSet });

const mockDb = { select: mockSelect, insert: mockInsert, update: mockUpdate };

vi.mock('../db/index.js', () => ({
  getDb: () => mockDb,
}));

// ---------------------------------------------------------------------------
// Schema mock
// ---------------------------------------------------------------------------

vi.mock('../db/schema.js', () => ({
  issueRuns:      { id: 'issue_runs.id', status: 'issue_runs.status' },
  issueRunEvents: 'issue_run_events_table',
  projects:       { id: 'projects.id', defaultModel: 'projects.default_model' },
}));

// ---------------------------------------------------------------------------
// Drizzle-orm mock (minimal)
// ---------------------------------------------------------------------------

vi.mock('drizzle-orm', () => ({
  eq:  (a: unknown, b: unknown) => ({ __eq: [a, b] }),
  and: (...args: unknown[]) => ({ __and: args }),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...vals: unknown[]) => ({ __sql: { strings, vals } }),
    { __brand: 'sql' },
  ),
}));

// ---------------------------------------------------------------------------
// Event bus mock — primary assertion surface
// ---------------------------------------------------------------------------

vi.mock('../realtime/event-bus.js', () => ({
  eventBus: { emitIssueRunEvent: mockEmitIssueRunEvent },
}));

// ---------------------------------------------------------------------------
// activeIssueSessions mock
// ---------------------------------------------------------------------------

vi.mock('../engine/active-issue-sessions.js', () => ({
  register:   vi.fn((id: string, s: unknown) => registeredSessions.set(id, s)),
  unregister: vi.fn((id: string) => registeredSessions.delete(id)),
  get:        vi.fn((id: string) => registeredSessions.get(id)),
  list:       vi.fn(() => []),
}));

// ---------------------------------------------------------------------------
// squad-client mock — uses getter functions to read current test state
// ---------------------------------------------------------------------------

vi.mock('../sdk/squad-client.js', () => ({
  createAgentSession: vi.fn(async (opts: {
    onEvent?: (event: { type: string; payload: Record<string, unknown> }) => void | Promise<void>;
  } = {}) => {
    const err = getAgentSessionError();
    if (err) throw err;
    for (const event of getAgentSessionEvents()) {
      await opts.onEvent?.(event);
    }
    return getAgentSessionResult();
  }),
}));

// ---------------------------------------------------------------------------
// Other deps — class-based mocks so `new X()` always works
// ---------------------------------------------------------------------------

vi.mock('../sdk/output-streamer.js', () => ({
  OutputStreamer: class {
    write() { return Promise.resolve(); }
    flush() { return Promise.resolve(); }
  },
}));

vi.mock('../sdk/cost-tracker.js', () => ({
  CostTracker: class {
    record()     { return Promise.resolve(); }
    recordCost() { return Promise.resolve(); }
  },
}));

vi.mock('../sdk/budget-guard.js', () => ({
  BudgetGuard:         { check: vi.fn().mockResolvedValue(undefined) },
  BudgetExceededError: class BudgetExceededError extends Error {},
}));

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn().mockResolvedValue('You are a test agent.'),
}));

vi.mock('../sdk/model-defaults.js', () => ({
  BUILTIN_FALLBACK: 'claude-3-haiku',
}));

// ---------------------------------------------------------------------------
// Import SUT after mocks
// ---------------------------------------------------------------------------

import { executeAgentRun } from '../sdk/bridge.js';
import type { AgentRunInput } from '../sdk/bridge.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type EmittedEvent = { type: string; payload: Record<string, unknown> };
function getEmittedEvents(): EmittedEvent[] {
  return mockEmitIssueRunEvent.mock.calls.map(
    (call) => ({ type: call[0] as string, payload: call[2] as Record<string, unknown> }),
  );
}

function makeInput(overrides: Partial<AgentRunInput> = {}): AgentRunInput {
  return {
    issueRunId:       'run-t3-001',
    projectId:        'proj-t3-001',
    agent: {
      id:          'agent-001',
      name:        'TestAgent',
      charterPath: '/agents/test/charter.md',
      charterContent: 'You are a test agent.',
      historyPath: null,
      charterHash: null,
      agentKind:   'squad',
      role:        'worker',
      model:       'gpt-4o',
      status:      'active',
      projectId:   'proj-t3-001',
      createdAt:   new Date(),
      updatedAt:   new Date(),
    },
    issueTitle:       'Fix the widget',
    issueBody:        'The widget is broken.',
    workspacePath:    '/workspace',
    projectSquadPath: '/workspace/.squad',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  registeredSessions.clear();
  mockEmitIssueRunEvent.mockClear();
  setAgentSessionError(null);
  setAgentSessionEvents([]);
  setAgentSessionResult({
    output:        'Agent produced this output.',
    resolvedModel: 'gpt-4o',
    inputTokens:   100,
    outputTokens:  200,
    tokensUsed:    300,
    costUsd:       '0.01',
  });
});

// ---------------------------------------------------------------------------
// Success path
// ---------------------------------------------------------------------------

describe('executeAgentRun() — success path event emissions', () => {
  it('emits issue.run.start as the first event', async () => {
    await executeAgentRun(makeInput());
    const events = getEmittedEvents();
    const startEvent = events.find((e) => e.type === 'issue.run.start');
    expect(startEvent).toBeDefined();
    expect(startEvent!.payload).toMatchObject({
      agentName: 'TestAgent',
      taskTitle: 'Fix the widget',
    });
  });

  it('emits issue.run.start before issue.run.finish', async () => {
    await executeAgentRun(makeInput());
    const events    = getEmittedEvents();
    const startIdx  = events.findIndex((e) => e.type === 'issue.run.start');
    const finishIdx = events.findIndex((e) => e.type === 'issue.run.finish');
    expect(startIdx).toBeGreaterThanOrEqual(0);
    expect(finishIdx).toBeGreaterThan(startIdx);
  });

  it('emits issue.run.finish with durationMs, cost, and tokenCounts', async () => {
    await executeAgentRun(makeInput());
    const events = getEmittedEvents();
    const finish = events.find((e) => e.type === 'issue.run.finish');
    expect(finish).toBeDefined();
    expect(finish!.payload).toMatchObject({
      durationMs:  expect.any(Number),
      cost:        expect.any(String),
      status:      'completed',
      outputAvailable: true,
      outputSummary: 'Agent produced this output.',
      tokenCounts: { input: expect.any(Number), output: expect.any(Number) },
    });
  });

  it('emits issue.run.turn with assistant content', async () => {
    await executeAgentRun(makeInput());
    const events = getEmittedEvents();
    const turn = events.find((e) => e.type === 'issue.run.turn');
    expect(turn).toBeDefined();
    expect(turn!.payload.content).toBe('Agent produced this output.');
  });

  it('emits issue.run.metric when inputTokens + outputTokens are available', async () => {
    await executeAgentRun(makeInput());
    const events = getEmittedEvents();
    const metric = events.find((e) => e.type === 'issue.run.metric');
    expect(metric).toBeDefined();
    expect(metric!.payload).toMatchObject({ inputTokens: 100, outputTokens: 200 });
  });

  it('forwards live SDK token, tool, and usage events to issue.run events', async () => {
    setAgentSessionEvents([
      { type: 'message_delta', payload: { delta: 'working…' } },
      { type: 'tool.call', payload: { toolName: 'bash', args: { command: 'pnpm test' } } },
      { type: 'tool.result', payload: { toolName: 'bash', result: { resultType: 'success' } } },
      { type: 'usage', payload: { inputTokens: 10, outputTokens: 20, model: 'gpt-4o', cost: 0.000325 } },
      { type: 'turn_start', payload: { raw: true } },
    ]);

    await executeAgentRun(makeInput());
    const events = getEmittedEvents();

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'issue.run.token',
          payload: expect.objectContaining({ kind: 'message_delta', delta: 'working…' }),
        }),
        expect.objectContaining({
          type: 'issue.run.tool_call',
          payload: expect.objectContaining({ toolName: 'bash', args: { command: 'pnpm test' } }),
        }),
        expect.objectContaining({
          type: 'issue.run.tool_result',
          payload: expect.objectContaining({ toolName: 'bash', result: { resultType: 'success' } }),
        }),
        expect.objectContaining({
          type: 'issue.run.token',
          payload: expect.objectContaining({ kind: 'usage', inputTokens: 10, outputTokens: 20, cost: 0.000325 }),
        }),
        expect.objectContaining({
          type: 'issue.run.metric',
          payload: expect.objectContaining({ kind: 'activity', phase: 'turn_start' }),
        }),
      ]),
    );
  });

  it('emits parsed structured output metadata on finish when the final message is JSON', async () => {
    setAgentSessionResult({
      output:        '{"ok":true,"items":[1,2]}',
      resolvedModel: 'gpt-4o',
      inputTokens:   100,
      outputTokens:  200,
      tokensUsed:    300,
      costUsd:       '0.01',
    });

    await executeAgentRun(makeInput());
    const events = getEmittedEvents();
    const finish = events.find((e) => e.type === 'issue.run.finish');

    expect(finish!.payload).toMatchObject({
      structuredOutputSource: 'json',
      structuredOutput: { ok: true, items: [1, 2] },
    });
  });

  it('does NOT emit issue.run.error on success', async () => {
    await executeAgentRun(makeInput());
    const events = getEmittedEvents();
    const errEvent = events.find((e) => e.type === 'issue.run.error');
    expect(errEvent).toBeUndefined();
  });

  it('session is unregistered from activeIssueSessions after completion', async () => {
    await executeAgentRun(makeInput({ issueRunId: 'run-dispose-check' }));
    expect(registeredSessions.has('run-dispose-check')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Error path
// ---------------------------------------------------------------------------

describe('executeAgentRun() — error path event emissions', () => {
  beforeEach(() => {
    setAgentSessionError(new Error('SDK exploded'));
  });

  it('emits issue.run.error with message', async () => {
    await executeAgentRun(makeInput({ issueRunId: 'run-err-001' }));
    const events = getEmittedEvents();
    const errEvent = events.find((e) => e.type === 'issue.run.error');
    expect(errEvent).toBeDefined();
    expect(errEvent!.payload).toMatchObject({
      message: 'SDK exploded',
      errorMessage: 'SDK exploded',
      status: 'failed',
    });
  });

  it('does NOT emit issue.run.finish on error', async () => {
    await executeAgentRun(makeInput({ issueRunId: 'run-err-002' }));
    const events = getEmittedEvents();
    const finish = events.find((e) => e.type === 'issue.run.finish');
    expect(finish).toBeUndefined();
  });

  it('still emits issue.run.start before the error', async () => {
    await executeAgentRun(makeInput({ issueRunId: 'run-err-003' }));
    const events   = getEmittedEvents();
    const startIdx = events.findIndex((e) => e.type === 'issue.run.start');
    const errIdx   = events.findIndex((e) => e.type === 'issue.run.error');
    expect(startIdx).toBeGreaterThanOrEqual(0);
    expect(errIdx).toBeGreaterThan(startIdx);
  });

  it('session is unregistered from activeIssueSessions after error (finally block)', async () => {
    await executeAgentRun(makeInput({ issueRunId: 'run-err-dispose' }));
    expect(registeredSessions.has('run-err-dispose')).toBe(false);
  });

  it('returns success:false with errorMessage', async () => {
    const result = await executeAgentRun(makeInput({ issueRunId: 'run-err-result' }));
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('SDK exploded');
  });
});
