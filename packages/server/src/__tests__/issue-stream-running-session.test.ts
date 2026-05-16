/**
 * issue-stream-running-session.test.ts — Wave 28 JIS-T2 regression
 *
 * Verifies:
 *   - Register on construct (RunningIssueSessionImpl auto-registers in registry)
 *   - emit() appends a row to the DB AND publishes on the event bus
 *   - steer() records a steered event; graceful when SDK is absent
 *   - steer() calls sdkClient.sendMessage when a client is present
 *   - steer() gracefully handles sdkClient.sendMessage failures
 *   - dispose() unregisters from registry and calls sdkClient.dispose
 *   - dispose() is idempotent (second call is a no-op)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// vi.hoisted(): variables used inside vi.mock() factories must be hoisted
// so they are initialized before the factory closures are evaluated.
// ---------------------------------------------------------------------------

const {
  mockInsertValues,
  mockInsert,
  mockDb,
  registeredSessions,
  mockEmitIssueRunEvent,
} = vi.hoisted(() => {
  const mockInsertValues = vi.fn().mockResolvedValue(undefined);
  const mockInsert = vi.fn().mockReturnValue({ values: mockInsertValues });
  const mockDb = { insert: mockInsert };
  const registeredSessions = new Map<string, unknown>();
  const mockEmitIssueRunEvent = vi.fn();
  return { mockInsertValues, mockInsert, mockDb, registeredSessions, mockEmitIssueRunEvent };
});

// ---------------------------------------------------------------------------
// DB mock
// ---------------------------------------------------------------------------

vi.mock('../db/index.js', () => ({
  getDb: () => mockDb,
}));

// ---------------------------------------------------------------------------
// Schema mock — insert target
// ---------------------------------------------------------------------------

vi.mock('../db/schema.js', () => ({
  issueRunEvents: 'issue_run_events_table',
}));

// ---------------------------------------------------------------------------
// Event bus mock
// ---------------------------------------------------------------------------

vi.mock('../realtime/event-bus.js', () => ({
  eventBus: { emitIssueRunEvent: mockEmitIssueRunEvent },
}));

// ---------------------------------------------------------------------------
// activeIssueSessions mock (spy on the real module)
// ---------------------------------------------------------------------------

vi.mock('../engine/active-issue-sessions.js', () => ({
  register:   vi.fn((runId: string, session: unknown) => registeredSessions.set(runId, session)),
  unregister: vi.fn((runId: string) => registeredSessions.delete(runId)),
  get:        vi.fn((runId: string) => registeredSessions.get(runId)),
  list:       vi.fn(() => Array.from(registeredSessions.entries()).map(([runId, session]) => ({ runId, session }))),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { RunningIssueSessionImpl } from '../sdk/issue-stream.js';
import { register, unregister } from '../engine/active-issue-sessions.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSession(runId = 'run-t2-001', projectId = 'proj-t2-001') {
  return new RunningIssueSessionImpl({ runId, projectId });
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  registeredSessions.clear();
  mockEmitIssueRunEvent.mockClear();
  mockInsert.mockClear();
  mockInsertValues.mockClear();
  // Re-apply implementations after clear
  mockInsert.mockReturnValue({ values: mockInsertValues });
  mockInsertValues.mockResolvedValue(undefined);
  vi.mocked(register).mockClear();
  vi.mocked(unregister).mockClear();
});

// ---------------------------------------------------------------------------
// Constructor: auto-register
// ---------------------------------------------------------------------------

describe('constructor — auto-register', () => {
  it('calls activeIssueSessions.register with the correct runId and self', () => {
    const session = makeSession('run-reg-001');
    expect(register).toHaveBeenCalledWith('run-reg-001', session);
    expect(registeredSessions.get('run-reg-001')).toBe(session);
  });

  it('getRunId() returns the run id passed to the constructor', () => {
    const session = makeSession('run-abc');
    expect(session.getRunId()).toBe('run-abc');
  });

  it('getProjectId() returns the project id passed to the constructor', () => {
    const session = makeSession('run-xyz', 'proj-xyz');
    expect(session.getProjectId()).toBe('proj-xyz');
  });
});

// ---------------------------------------------------------------------------
// emit() — DB + event bus
// ---------------------------------------------------------------------------

describe('emit()', () => {
  it('inserts one row to issue_run_events with the correct shape', async () => {
    const session = makeSession('run-emit-001', 'proj-emit-001');
    await session.emit('issue.run.start', { agentName: 'TestAgent', model: 'gpt-4o' });

    expect(mockInsert).toHaveBeenCalledWith('issue_run_events_table');
    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run-emit-001',
        seq: 1,
        eventType: 'issue.run.start',
        payload: expect.objectContaining({ runId: 'run-emit-001', seq: 1, agentName: 'TestAgent' }),
      }),
    );
  });

  it('returns the seq number (starts at 1, monotonically increases)', async () => {
    const session = makeSession('run-seq-001');
    const s1 = await session.emit('issue.run.start', {});
    const s2 = await session.emit('issue.run.turn', { content: 'hello' });
    const s3 = await session.emit('issue.run.finish', {});
    expect(s1).toBe(1);
    expect(s2).toBe(2);
    expect(s3).toBe(3);
  });

  it('publishes event to the event bus with correct type, projectId, and enriched payload', async () => {
    const session = makeSession('run-bus-001', 'proj-bus-001');
    await session.emit('issue.run.finish', { durationMs: 500 });

    expect(mockEmitIssueRunEvent).toHaveBeenCalledWith(
      'issue.run.finish',
      'proj-bus-001',
      expect.objectContaining({ runId: 'run-bus-001', durationMs: 500 }),
    );
  });

  it('still publishes to event bus even when DB insert fails', async () => {
    mockInsertValues.mockRejectedValueOnce(new Error('DB down'));
    const session = makeSession('run-resilient-001', 'proj-resilient');
    // Should not throw
    await expect(session.emit('issue.run.error', { message: 'oops' })).resolves.toBe(1);
    expect(mockEmitIssueRunEvent).toHaveBeenCalledWith('issue.run.error', 'proj-resilient', expect.anything());
  });

  it('enriches payload with runId and seq automatically', async () => {
    const session = makeSession('run-enrich-001');
    await session.emit('issue.run.turn', { content: 'test output' });

    const [call] = mockInsertValues.mock.calls;
    const row = call[0] as { payload: Record<string, unknown> };
    expect(row.payload.runId).toBe('run-enrich-001');
    expect(row.payload.seq).toBe(1);
    expect(row.payload.content).toBe('test output');
  });
});

// ---------------------------------------------------------------------------
// steer()
// ---------------------------------------------------------------------------

describe('steer()', () => {
  it('records a steered event to DB + event bus even when no sdkClient is present', async () => {
    const session = makeSession('run-steer-001', 'proj-steer');
    await session.steer('Please stop and summarise');

    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'issue.run.steered',
        payload: expect.objectContaining({ message: 'Please stop and summarise', actor: 'user' }),
      }),
    );
    expect(mockEmitIssueRunEvent).toHaveBeenCalledWith('issue.run.steered', 'proj-steer', expect.anything());
  });

  it('uses provided actor in the steered event payload', async () => {
    const session = makeSession('run-steer-002');
    await session.steer('Redirect focus', 'pm-bot');

    const call = mockInsertValues.mock.calls[0][0] as { payload: Record<string, unknown> };
    expect(call.payload.actor).toBe('pm-bot');
  });

  it('calls sdkClient.sendMessage when one is provided', async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const session = new RunningIssueSessionImpl({
      runId: 'run-steer-sdk-001',
      projectId: 'proj-steer',
      sdkClient: { sendMessage },
    });
    await session.steer('Redirect');

    expect(sendMessage).toHaveBeenCalledWith('Redirect');
  });

  it('does NOT throw when sdkClient.sendMessage rejects (graceful degradation)', async () => {
    const sendMessage = vi.fn().mockRejectedValue(new Error('Session closed'));
    const session = new RunningIssueSessionImpl({
      runId: 'run-steer-sdk-fail',
      projectId: 'proj-steer',
      sdkClient: { sendMessage },
    });
    // Must not throw; event is still recorded
    await expect(session.steer('test')).resolves.toBeUndefined();
    expect(mockInsertValues).toHaveBeenCalled();
  });

  it('throws when called on a disposed session', async () => {
    const session = makeSession('run-steer-disposed');
    await session.dispose();
    await expect(session.steer('too late')).rejects.toThrow(/disposed/i);
  });
});

// ---------------------------------------------------------------------------
// dispose()
// ---------------------------------------------------------------------------

describe('dispose()', () => {
  it('calls activeIssueSessions.unregister', async () => {
    const session = makeSession('run-dispose-001');
    await session.dispose();
    expect(unregister).toHaveBeenCalledWith('run-dispose-001');
    expect(registeredSessions.has('run-dispose-001')).toBe(false);
  });

  it('calls sdkClient.dispose if provided', async () => {
    const disposeSdk = vi.fn().mockResolvedValue(undefined);
    const session = new RunningIssueSessionImpl({
      runId: 'run-dispose-sdk',
      projectId: 'proj-dispose',
      sdkClient: { sendMessage: vi.fn(), dispose: disposeSdk },
    });
    await session.dispose();
    expect(disposeSdk).toHaveBeenCalledOnce();
  });

  it('is idempotent — second dispose() is a no-op (no double-unregister)', async () => {
    const session = makeSession('run-dispose-idem');
    await session.dispose();
    await session.dispose(); // second call should not throw
    // unregister should only be called once
    expect(unregister).toHaveBeenCalledTimes(1);
  });

  it('does not throw when sdkClient.dispose rejects', async () => {
    const disposeSdk = vi.fn().mockRejectedValue(new Error('dispose failed'));
    const session = new RunningIssueSessionImpl({
      runId: 'run-dispose-fail',
      projectId: 'proj-dispose',
      sdkClient: { sendMessage: vi.fn(), dispose: disposeSdk },
    });
    await expect(session.dispose()).resolves.toBeUndefined();
  });
});
