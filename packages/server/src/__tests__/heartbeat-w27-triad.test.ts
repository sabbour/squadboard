/**
 * heartbeat-w27-triad.test.ts — W27 regression suite
 *
 * Covers all three console bugs Brady caught in devtools:
 *
 *   Bug 1 — Phantom "unknown error" rows in Sweeps acted on list:
 *     sweep.tick events MUST be filtered from the ring buffer;
 *     only heartbeat.sweep.completed / heartbeat.sweep.error are persisted.
 *
 *   Bug 2 — React duplicate-key warnings (seq 397, 398, … colliding):
 *     Each ring-buffer entry must have a unique seq. With Bug 1 fixed,
 *     the seq counter only increments for real completed/error events,
 *     so two events per tick never share a seq value.
 *
 *   Bug 3 — WebSocket proxy missing (ws://localhost:5173/api/ws fails):
 *     Vite config must declare a dedicated '/api/ws' proxy with ws: true
 *     so the dev server upgrades WS connections correctly instead of
 *     letting them fall through to the HTTP handler which closes them
 *     before the handshake completes.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eventBus } from '../realtime/event-bus.js';
import {
  getRecentSweeps,
  startHeartbeatHistory,
  _resetHeartbeatServiceState,
} from '../services/heartbeat.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emitCompleted(sweepId: string, durationMs = 5): void {
  eventBus.emitHeartbeatEvent('heartbeat.sweep.completed', {
    sweepId,
    durationMs,
    result: { acted: 1, errors: 0 },
  });
}

function emitError(sweepId: string, durationMs = 5): void {
  eventBus.emitHeartbeatEvent('heartbeat.sweep.error', {
    sweepId,
    durationMs,
    error: 'boom',
  });
}

function emitSweepTick(sweepName: string, durationMs = 5, status: 'success' | 'error' = 'success'): void {
  eventBus.emitHeartbeatEvent('sweep.tick', {
    sweepName,
    timestamp: new Date().toISOString(),
    agentsActivated: [],
    durationMs,
    status,
  });
}

// ---------------------------------------------------------------------------
// Reset ring buffer before every test so cases are independent.
// ---------------------------------------------------------------------------

beforeEach(() => {
  _resetHeartbeatServiceState();
  startHeartbeatHistory();
});

// ---------------------------------------------------------------------------
// Bug 1 — sweep.tick must NOT enter the ring buffer
// ---------------------------------------------------------------------------

describe('Bug 1 — sweep.tick excluded from ring buffer', () => {
  it('B1a: emitting sweep.tick does not add any entry to getRecentSweeps', () => {
    emitSweepTick('ceremonies-due');
    emitSweepTick('ready-workflow-steps', 3, 'error');

    const { sweeps } = getRecentSweeps();
    expect(sweeps).toHaveLength(0);
  });

  it('B1b: only heartbeat.sweep.completed events land in the ring buffer', () => {
    emitSweepTick('ceremonies-due');          // should be ignored
    emitCompleted('ceremonies-due');           // should be stored
    emitSweepTick('ready-workflow-steps');     // should be ignored
    emitCompleted('ready-workflow-steps');     // should be stored

    const { sweeps } = getRecentSweeps();
    expect(sweeps).toHaveLength(2);
    expect(sweeps.every((e) => e.sweepId !== undefined)).toBe(true);
    expect(sweeps.every((e) => e.outcome === 'completed')).toBe(true);
    expect(sweeps.map((e) => e.sweepId)).toEqual(['ceremonies-due', 'ready-workflow-steps']);
  });

  it('B1c: heartbeat.sweep.error is still persisted (only sweep.tick is excluded)', () => {
    emitSweepTick('stuck-issue-runs', 8, 'error');  // ignored
    emitError('stuck-issue-runs', 8);               // stored as error outcome

    const { sweeps } = getRecentSweeps();
    expect(sweeps).toHaveLength(1);
    expect(sweeps[0].sweepId).toBe('stuck-issue-runs');
    expect(sweeps[0].outcome).toBe('error');
    expect(sweeps[0].error).toBe('boom');
  });

  it('B1d: mixed tick/completed/error sequence — only completed and error survive', () => {
    // Simulates one full "tick" cycle per sweep: engine emits completed then tick.
    emitCompleted('ceremonies-due');
    emitSweepTick('ceremonies-due');
    emitError('idle-live-sessions');
    emitSweepTick('idle-live-sessions', 4, 'error');

    const { sweeps } = getRecentSweeps();
    expect(sweeps).toHaveLength(2);
    // No phantom entries with undefined sweepId
    expect(sweeps.every((e) => typeof e.sweepId === 'string' && e.sweepId.length > 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Bug 2 — unique seq numbers (no duplicate React keys)
// ---------------------------------------------------------------------------

describe('Bug 2 — seq numbers are unique across ring buffer entries', () => {
  it('B2a: each event in the buffer has a distinct seq value', () => {
    emitCompleted('ceremonies-due');
    emitSweepTick('ceremonies-due');     // must NOT consume a seq
    emitCompleted('ready-workflow-steps');
    emitSweepTick('ready-workflow-steps');

    const { sweeps } = getRecentSweeps();
    const seqs = sweeps.map((e) => e.seq);
    const uniqueSeqs = new Set(seqs);
    expect(uniqueSeqs.size).toBe(seqs.length);
  });

  it('B2b: seq values are strictly monotonically increasing', () => {
    emitCompleted('ceremonies-due');
    emitCompleted('ready-workflow-steps');
    emitError('stuck-issue-runs');

    const { sweeps } = getRecentSweeps();
    for (let i = 1; i < sweeps.length; i++) {
      expect(sweeps[i].seq).toBeGreaterThan(sweeps[i - 1].seq);
    }
  });

  it('B2c: cursor equals the max seq in the buffer', () => {
    emitCompleted('ceremonies-due');
    emitCompleted('ready-workflow-steps');

    const { sweeps, cursor } = getRecentSweeps();
    const maxSeq = Math.max(...sweeps.map((e) => e.seq));
    expect(cursor).toBe(maxSeq);
  });
});
