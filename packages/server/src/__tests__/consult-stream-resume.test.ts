/**
 * consult-stream-resume.test.ts — W28 J3
 *
 * Verifies the per-session event buffer and replay-from-lastSeq semantics:
 *   - Events are buffered as they arrive on the event bus.
 *   - `getBufferedEvents(sessionId, fromSeq)` returns only events with seq > fromSeq.
 *   - Buffer is capped at RESUME_BUFFER_SIZE (100) — oldest events are evicted.
 *   - Sequence numbers are monotonically increasing.
 *   - Cross-session isolation: session A's buffer doesn't include session B's events.
 */

import { describe, it, expect, beforeEach } from 'vitest';

describe('consult-stream resume buffer', () => {
  // Use fresh module state for each test
  beforeEach(async () => {
    const { _resetBuffers } = await import('../sdk/sse-stream.js');
    _resetBuffers();
  });

  it('starts with no buffered events', async () => {
    const { getBufferedEvents, currentSeq } = await import('../sdk/sse-stream.js');
    expect(getBufferedEvents('empty-sess', 0)).toEqual([]);
    expect(currentSeq('empty-sess')).toBe(0);
  });

  it('buffers events emitted via the event bus', async () => {
    const { getBufferedEvents } = await import('../sdk/sse-stream.js');
    const { eventBus } = await import('../realtime/event-bus.js');

    eventBus.emitConsultEvent('consult.message_delta', 'sess-buf', { sessionId: 'sess-buf', delta: 'x' });
    eventBus.emitConsultEvent('consult.message_delta', 'sess-buf', { sessionId: 'sess-buf', delta: 'y' });

    const events = getBufferedEvents('sess-buf', 0);
    expect(events).toHaveLength(2);
  });

  it('assigns monotonically increasing seq numbers', async () => {
    const { getBufferedEvents } = await import('../sdk/sse-stream.js');
    const { eventBus } = await import('../realtime/event-bus.js');

    for (let i = 0; i < 5; i++) {
      eventBus.emitConsultEvent('consult.message_delta', 'sess-mono', { sessionId: 'sess-mono', delta: `t${i}` });
    }

    const events = getBufferedEvents('sess-mono', 0);
    expect(events).toHaveLength(5);
    for (let i = 1; i < events.length; i++) {
      expect(events[i].seq).toBeGreaterThan(events[i - 1].seq);
    }
  });

  it('getBufferedEvents(fromSeq) returns only events with seq > fromSeq', async () => {
    const { getBufferedEvents } = await import('../sdk/sse-stream.js');
    const { eventBus } = await import('../realtime/event-bus.js');

    eventBus.emitConsultEvent('consult.message_delta', 'sess-from', { sessionId: 'sess-from', delta: 'a' });
    eventBus.emitConsultEvent('consult.message_delta', 'sess-from', { sessionId: 'sess-from', delta: 'b' });
    eventBus.emitConsultEvent('consult.message_delta', 'sess-from', { sessionId: 'sess-from', delta: 'c' });

    const all = getBufferedEvents('sess-from', 0);
    expect(all).toHaveLength(3);

    const cutoff = all[0].seq;
    const afterFirst = getBufferedEvents('sess-from', cutoff);
    expect(afterFirst).toHaveLength(2);
    expect(afterFirst.every((e) => e.seq > cutoff)).toBe(true);
  });

  it('caps buffer at RESUME_BUFFER_SIZE (evicts oldest)', async () => {
    const { getBufferedEvents, RESUME_BUFFER_SIZE } = await import('../sdk/sse-stream.js');
    const { eventBus } = await import('../realtime/event-bus.js');

    const total = RESUME_BUFFER_SIZE + 20;
    for (let i = 0; i < total; i++) {
      eventBus.emitConsultEvent('consult.message_delta', 'sess-cap', { sessionId: 'sess-cap', delta: `t${i}` });
    }

    const all = getBufferedEvents('sess-cap', 0);
    expect(all.length).toBe(RESUME_BUFFER_SIZE);
    // Oldest N events were evicted: the min seq in the buffer should be total - RESUME_BUFFER_SIZE + 1
    const minSeq = Math.min(...all.map((e) => e.seq));
    expect(minSeq).toBe(total - RESUME_BUFFER_SIZE + 1);
  });

  it('isolates buffers between sessions', async () => {
    const { getBufferedEvents } = await import('../sdk/sse-stream.js');
    const { eventBus } = await import('../realtime/event-bus.js');

    eventBus.emitConsultEvent('consult.message_delta', 'sess-X', { sessionId: 'sess-X', delta: 'x' });
    eventBus.emitConsultEvent('consult.message_delta', 'sess-Y', { sessionId: 'sess-Y', delta: 'y' });
    eventBus.emitConsultEvent('consult.message_delta', 'sess-Y', { sessionId: 'sess-Y', delta: 'y2' });

    expect(getBufferedEvents('sess-X', 0)).toHaveLength(1);
    expect(getBufferedEvents('sess-Y', 0)).toHaveLength(2);
  });

  it('buffers all consult event types', async () => {
    const { getBufferedEvents } = await import('../sdk/sse-stream.js');
    const { eventBus } = await import('../realtime/event-bus.js');

    const types = [
      'consult.started',
      'consult.user_message',
      'consult.message_delta',
      'consult.reasoning_delta',
      'consult.message_complete',
      'consult.tool_call',
      'consult.usage',
      'consult.error',
      'consult.completed',
    ] as const;

    for (const t of types) {
      eventBus.emitConsultEvent(t, 'sess-types', { sessionId: 'sess-types' });
    }

    const all = getBufferedEvents('sess-types', 0);
    expect(all).toHaveLength(types.length);
    const emittedTypes = all.map((e) => e.type);
    for (const t of types) {
      expect(emittedTypes).toContain(t);
    }
  });

  it('returns empty array when fromSeq is >= latest seq', async () => {
    const { getBufferedEvents, currentSeq } = await import('../sdk/sse-stream.js');
    const { eventBus } = await import('../realtime/event-bus.js');

    eventBus.emitConsultEvent('consult.message_delta', 'sess-hi', { sessionId: 'sess-hi', delta: 'z' });
    const seq = currentSeq('sess-hi');
    expect(getBufferedEvents('sess-hi', seq)).toEqual([]);
  });
});
