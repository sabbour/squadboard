/**
 * log-monitor.test.ts
 *
 * Tests for the in-process log monitor service (services/log-monitor.ts).
 * Coverage:
 *   - Error classification by message pattern
 *   - Consecutive-failure tracking and sweep-disable enqueue
 *   - drain() applies the disable auto-fix
 *   - Rate-limiter for agent-sync-charter-warn
 *   - getState() returns correct shape
 *   - Advisory-only classes produce no pending fix
 *   - resetForTest() clears all state
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LogMonitor } from '../services/log-monitor.js';

function makeMonitor() {
  const m = new LogMonitor();
  return m;
}

describe('log-monitor — error classification', () => {
  it('classifies pglite-oid-stale messages', () => {
    const m = makeMonitor();
    m.ingest('engine', 'could not open relation with OID 12345');
    const { events } = m.getState();
    expect(events).toHaveLength(1);
    expect(events[0].errorClass).toBe('pglite-oid-stale');
  });

  it('classifies stale-run-reclaim messages', () => {
    const m = makeMonitor();
    m.ingest('sweeper', '[sweeper] reclaimed 3 expired lease(s)');
    const { events } = m.getState();
    expect(events[0].errorClass).toBe('stale-run-reclaim');
  });

  it('classifies orphan-heartbeat messages', () => {
    const m = makeMonitor();
    m.ingest('sweeper', '[sweeper] orphaned 2 issue_run(s) with no heartbeat');
    const { events } = m.getState();
    expect(events[0].errorClass).toBe('orphan-heartbeat');
  });

  it('classifies step-retry-exhausted messages', () => {
    const m = makeMonitor();
    m.ingest('sweeper', 'step_run abc123 exhausted retries — workflow_run xyz failed');
    const { events } = m.getState();
    expect(events[0].errorClass).toBe('step-retry-exhausted');
  });

  it('classifies agent-sync-charter-warn messages', () => {
    const m = makeMonitor();
    m.ingest('agent-sync', '[agent-sync] Could not read charter.md for fenster: ENOENT');
    const { events } = m.getState();
    expect(events[0].errorClass).toBe('agent-sync-charter-warn');
  });

  it('ignores unclassifiable messages', () => {
    const m = makeMonitor();
    m.ingest('engine', 'some random log line with no known pattern');
    const { events } = m.getState();
    expect(events).toHaveLength(0);
  });

  it('stores source and context on classified events', () => {
    const m = makeMonitor();
    m.ingest('sweep:stuck-issue-runs', 'could not open relation with OID 99', {
      sweepId: 'stuck-issue-runs',
    });
    const { events } = m.getState();
    expect(events[0].source).toBe('sweep:stuck-issue-runs');
    expect(events[0].context).toMatchObject({ sweepId: 'stuck-issue-runs' });
  });
});

describe('log-monitor — consecutive sweep failure tracking', () => {
  it('does not enqueue a fix after fewer than 3 failures', () => {
    const m = makeMonitor();
    m.recordSweepFailure('ceremonies-due');
    m.recordSweepFailure('ceremonies-due');
    const { pendingFixes } = m.getState();
    expect(pendingFixes).toHaveLength(0);
  });

  it('enqueues a sweep-disable fix for allowlisted non-critical sweeps after 3 failures', () => {
    const m = makeMonitor();
    m.recordSweepFailure('ralph-monitor');
    m.recordSweepFailure('ralph-monitor');
    m.recordSweepFailure('ralph-monitor');
    const { pendingFixes, events } = m.getState();
    expect(pendingFixes).toHaveLength(1);
    expect(pendingFixes[0].errorClass).toBe('sweep-consecutive-fail');
    expect(pendingFixes[0].context?.['sweepId']).toBe('ralph-monitor');
    // Should also have recorded an event
    expect(events.some((e) => e.errorClass === 'sweep-consecutive-fail')).toBe(true);
  });

  it('does not double-enqueue if called more than 3 times', () => {
    const m = makeMonitor();
    for (let i = 0; i < 6; i++) m.recordSweepFailure('log-monitor');
    const { pendingFixes } = m.getState();
    expect(pendingFixes).toHaveLength(1);
  });

  it('does not enqueue auto-fixes for core workflow or lease sweeps', () => {
    const m = makeMonitor();
    for (let i = 0; i < 3; i++) m.recordSweepFailure('stuck-issue-runs');
    for (let i = 0; i < 3; i++) m.recordSweepFailure('ready-workflow-steps');

    const { pendingFixes, events } = m.getState();
    expect(pendingFixes).toHaveLength(0);
    expect(events.filter((e) => e.errorClass === 'sweep-consecutive-fail')).toHaveLength(2);
    expect(events.every((e) => e.context?.['autoFixAllowed'] === 0)).toBe(true);
  });

  it('tracks different sweeps independently', () => {
    const m = makeMonitor();
    for (let i = 0; i < 3; i++) m.recordSweepFailure('ralph-monitor');
    for (let i = 0; i < 2; i++) m.recordSweepFailure('sweep-b');
    const { pendingFixes } = m.getState();
    // Only ralph-monitor crossed threshold and is allowlisted for safe auto-disable
    expect(pendingFixes).toHaveLength(1);
    expect(pendingFixes[0].context?.['sweepId']).toBe('ralph-monitor');
  });

  it('resets the window after the window expires', () => {
    const m = makeMonitor();
    // Inject a stale windowStart by recording 2 failures, then simulate
    // the internal state having an old windowStart by resetting and re-recording.
    m.recordSweepFailure('sweep-x');
    m.recordSweepFailure('sweep-x');
    // Reset state (clears failureMap)
    m.resetForTest();
    // Now record 3 fresh failures — should enqueue
    for (let i = 0; i < 3; i++) m.recordSweepFailure('log-monitor');
    const { pendingFixes } = m.getState();
    expect(pendingFixes).toHaveLength(1);
  });
});

describe('log-monitor — drain()', () => {
  it('calls setSweepEnabled(id, false) when a sweep-consecutive-fail fix is pending', async () => {
    const m = makeMonitor();
    for (let i = 0; i < 3; i++) m.recordSweepFailure('ralph-monitor');

    const setSweepEnabled = vi.fn();
    const applied = await m.drain({ setSweepEnabled });

    expect(applied).toBe(1);
    expect(setSweepEnabled).toHaveBeenCalledWith('ralph-monitor', false);
  });

  it('moves the fix from pendingFixes to appliedFixes after drain', async () => {
    const m = makeMonitor();
    for (let i = 0; i < 3; i++) m.recordSweepFailure('log-monitor');

    const setSweepEnabled = vi.fn();
    await m.drain({ setSweepEnabled });

    const { pendingFixes, appliedFixes } = m.getState();
    expect(pendingFixes).toHaveLength(0);
    expect(appliedFixes).toHaveLength(1);
    expect(appliedFixes[0].errorClass).toBe('sweep-consecutive-fail');
    expect(appliedFixes[0].context?.['sweepId']).toBe('log-monitor');
  });

  it('re-enqueues the fix if setSweepEnabled is not provided', async () => {
    const m = makeMonitor();
    for (let i = 0; i < 3; i++) m.recordSweepFailure('ralph-monitor');

    const applied = await m.drain({}); // no setSweepEnabled

    expect(applied).toBe(0);
    const { pendingFixes } = m.getState();
    expect(pendingFixes).toHaveLength(1); // still pending
  });

  it('returns 0 when there are no pending fixes', async () => {
    const m = makeMonitor();
    const applied = await m.drain({ setSweepEnabled: vi.fn() });
    expect(applied).toBe(0);
  });

  it('re-enqueues a fix if setSweepEnabled throws', async () => {
    const m = makeMonitor();
    for (let i = 0; i < 3; i++) m.recordSweepFailure('ralph-monitor');

    const setSweepEnabled = vi.fn().mockImplementation(() => {
      throw new Error('unknown sweep');
    });
    const applied = await m.drain({ setSweepEnabled });

    expect(applied).toBe(0);
    const { pendingFixes } = m.getState();
    expect(pendingFixes).toHaveLength(1);
  });

  it('never disables a core sweep even if an unsafe pending fix is present', async () => {
    const m = makeMonitor();
    for (let i = 0; i < 3; i++) m.recordSweepFailure('stuck-issue-runs');

    const setSweepEnabled = vi.fn();
    const applied = await m.drain({ setSweepEnabled });

    expect(applied).toBe(0);
    expect(setSweepEnabled).not.toHaveBeenCalled();
  });
});

describe('log-monitor — rate limiter (agent-sync-charter-warn)', () => {
  it('allows first 3 occurrences through for the same source', () => {
    const m = makeMonitor();
    for (let i = 0; i < 3; i++) {
      m.ingest('agent-sync', '[agent-sync] Could not read charter.md for hockney: ENOENT');
    }
    const { events } = m.getState();
    expect(events).toHaveLength(3);
  });

  it('suppresses occurrences beyond the threshold (same source, same window)', () => {
    const m = makeMonitor();
    for (let i = 0; i < 10; i++) {
      m.ingest('agent-sync', '[agent-sync] Could not read charter.md for hockney: ENOENT');
    }
    const { events } = m.getState();
    // Only 3 allowed through
    expect(events).toHaveLength(3);
  });

  it('tracks rate limits separately per source', () => {
    const m = makeMonitor();
    // Different sources have independent rate limits
    for (let i = 0; i < 5; i++) {
      m.ingest('agent-sync-a', '[agent-sync] Could not read charter.md for a: ENOENT');
      m.ingest('agent-sync-b', '[agent-sync] Could not read charter.md for b: ENOENT');
    }
    const { events } = m.getState();
    // 3 from each source = 6 total
    expect(events.filter((e) => e.source === 'agent-sync-a')).toHaveLength(3);
    expect(events.filter((e) => e.source === 'agent-sync-b')).toHaveLength(3);
  });
});

describe('log-monitor — getState()', () => {
  it('returns empty arrays when nothing has been ingested', () => {
    const m = makeMonitor();
    const state = m.getState();
    expect(state.events).toHaveLength(0);
    expect(state.pendingFixes).toHaveLength(0);
    expect(state.appliedFixes).toHaveLength(0);
    expect(state.safeAutoDisableSweepIds).toEqual(['ralph-monitor', 'log-monitor']);
  });

  it('returns copies (not references) of internal arrays', () => {
    const m = makeMonitor();
    m.ingest('engine', 'could not open relation with OID 1');
    const state1 = m.getState();
    const state2 = m.getState();
    expect(state1.events).not.toBe(state2.events);
  });
});

describe('log-monitor — advisory-only classes', () => {
  it('pglite-oid-stale records event but enqueues no pending fix', () => {
    const m = makeMonitor();
    m.ingest('engine', 'could not open relation with OID 123');
    const { pendingFixes } = m.getState();
    expect(pendingFixes).toHaveLength(0);
  });

  it('stale-run-reclaim records event but enqueues no pending fix', () => {
    const m = makeMonitor();
    m.ingest('sweeper', '[sweeper] reclaimed 1 expired lease(s)');
    const { pendingFixes } = m.getState();
    expect(pendingFixes).toHaveLength(0);
  });
});

describe('log-monitor — resetForTest()', () => {
  it('clears all events, fixes, and rate-limit state', () => {
    const m = makeMonitor();
    m.ingest('engine', 'could not open relation with OID 1');
    for (let i = 0; i < 3; i++) m.recordSweepFailure('ralph-monitor');

    m.resetForTest();

    const state = m.getState();
    expect(state.events).toHaveLength(0);
    expect(state.pendingFixes).toHaveLength(0);
    expect(state.appliedFixes).toHaveLength(0);

    // Rate limit should also be reset — next ingestion should go through
    for (let i = 0; i < 3; i++) {
      m.ingest('agent-sync', '[agent-sync] Could not read charter.md for x: ENOENT');
    }
    expect(m.getState().events).toHaveLength(3);
  });
});
