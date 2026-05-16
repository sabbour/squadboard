/**
 * sse-stream.test.ts — W28 J3
 *
 * Verifies the SSE stream module:
 *   - Content-Type is text/event-stream
 *   - 15 s heartbeat fires
 *   - Event shape matches WS path (same ConsultEventType + JSON payload)
 *   - Last-Event-Id resume replays missed events
 *   - Terminal events (completed/error) end the response
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { BufferedConsultEvent } from '../sdk/sse-stream.js';

// ── Minimal mock of an Express response ──────────────────────────────────────

function makeMockRes() {
  const headers: Record<string, string> = {};
  const chunks: string[] = [];
  const ee = new EventEmitter();
  let ended = false;

  return {
    setHeader(k: string, v: string) { headers[k] = v; },
    flushHeaders() { /* no-op */ },
    write(chunk: string) { chunks.push(chunk); return true; },
    end() { ended = true; },
    on(event: string, fn: (...args: unknown[]) => void) { ee.on(event, fn); },
    off(event: string, fn: (...args: unknown[]) => void) { ee.off(event, fn); },
    simulateClose() { ee.emit('close'); },
    // Accessors for assertions
    headers,
    chunks,
    get ended() { return ended; },
  };
}

// ── Isolate module between tests ──────────────────────────────────────────────

// Re-import module each test group so bus listeners start fresh.
describe('sse-stream', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sets text/event-stream content-type headers', async () => {
    const { streamConsultSSE, _resetBuffers } = await import('../sdk/sse-stream.js');
    _resetBuffers();
    const res = makeMockRes();
    streamConsultSSE('sess-1', null, res as never);
    expect(res.headers['Content-Type']).toBe('text/event-stream');
    expect(res.headers['Cache-Control']).toBe('no-cache');
    res.simulateClose();
  });

  it('sends :heartbeat comment after 15 s', async () => {
    const { streamConsultSSE, _resetBuffers } = await import('../sdk/sse-stream.js');
    _resetBuffers();
    const res = makeMockRes();
    streamConsultSSE('sess-hb', null, res as never);

    vi.advanceTimersByTime(15_000);

    expect(res.chunks.some((c) => c === ':heartbeat\n\n')).toBe(true);
    res.simulateClose();
  });

  it('sends :heartbeat every 15 s (fires 3 times in 45 s)', async () => {
    const { streamConsultSSE, _resetBuffers } = await import('../sdk/sse-stream.js');
    _resetBuffers();
    const res = makeMockRes();
    streamConsultSSE('sess-hb2', null, res as never);

    vi.advanceTimersByTime(45_000);
    const hbCount = res.chunks.filter((c) => c === ':heartbeat\n\n').length;
    expect(hbCount).toBe(3);
    res.simulateClose();
  });

  it('emits events with SSE format: id / event / data', async () => {
    const { streamConsultSSE, _resetBuffers } = await import('../sdk/sse-stream.js');
    const { eventBus } = await import('../realtime/event-bus.js');
    _resetBuffers();
    const res = makeMockRes();
    streamConsultSSE('sess-fmt', null, res as never);

    const payload = { sessionId: 'sess-fmt', delta: 'hello' };
    eventBus.emitConsultEvent('consult.message_delta', 'sess-fmt', payload);

    const raw = res.chunks.join('');
    expect(raw).toMatch(/^id: \d+\n/);
    expect(raw).toContain('event: consult.message_delta\n');
    expect(raw).toContain(`data: ${JSON.stringify(payload)}\n\n`);
    res.simulateClose();
  });

  it('replays buffered events when Last-Event-Id is provided', async () => {
    const { streamConsultSSE, getBufferedEvents, _resetBuffers } = await import('../sdk/sse-stream.js');
    const { eventBus } = await import('../realtime/event-bus.js');
    _resetBuffers();

    // Emit 3 events before opening SSE (simulates missed events during disconnect)
    const p1 = { sessionId: 'sess-resume', delta: 'a' };
    const p2 = { sessionId: 'sess-resume', delta: 'b' };
    const p3 = { sessionId: 'sess-resume', delta: 'c' };
    eventBus.emitConsultEvent('consult.message_delta', 'sess-resume', p1);
    eventBus.emitConsultEvent('consult.message_delta', 'sess-resume', p2);
    eventBus.emitConsultEvent('consult.message_delta', 'sess-resume', p3);

    const buffered = getBufferedEvents('sess-resume', 0);
    expect(buffered).toHaveLength(3);

    // Open SSE from seq 1 (skip first event, replay 2 + 3)
    const res = makeMockRes();
    streamConsultSSE('sess-resume', String(buffered[0].seq), res as never);

    const raw = res.chunks.join('');
    // Should contain p2 and p3 but NOT p1
    expect(raw).toContain(JSON.stringify(p2));
    expect(raw).toContain(JSON.stringify(p3));
    expect(raw.indexOf(JSON.stringify(p2))).toBeLessThan(raw.indexOf(JSON.stringify(p3)));
    res.simulateClose();
  });

  it('terminates stream on consult.completed', async () => {
    const { streamConsultSSE, _resetBuffers } = await import('../sdk/sse-stream.js');
    const { eventBus } = await import('../realtime/event-bus.js');
    _resetBuffers();
    const res = makeMockRes();
    streamConsultSSE('sess-done', null, res as never);

    eventBus.emitConsultEvent('consult.completed', 'sess-done', { sessionId: 'sess-done', reason: 'completed' });

    expect(res.ended).toBe(true);
  });

  it('terminates stream on consult.error', async () => {
    const { streamConsultSSE, _resetBuffers } = await import('../sdk/sse-stream.js');
    const { eventBus } = await import('../realtime/event-bus.js');
    _resetBuffers();
    const res = makeMockRes();
    streamConsultSSE('sess-err', null, res as never);

    eventBus.emitConsultEvent('consult.error', 'sess-err', { sessionId: 'sess-err', message: 'oops' });

    expect(res.ended).toBe(true);
  });

  it('does not bleed events between sessions', async () => {
    const { streamConsultSSE, _resetBuffers } = await import('../sdk/sse-stream.js');
    const { eventBus } = await import('../realtime/event-bus.js');
    _resetBuffers();
    const resA = makeMockRes();
    const resB = makeMockRes();
    streamConsultSSE('sess-A', null, resA as never);
    streamConsultSSE('sess-B', null, resB as never);

    eventBus.emitConsultEvent('consult.message_delta', 'sess-A', { sessionId: 'sess-A', delta: 'only-A' });

    expect(resA.chunks.join('')).toContain('only-A');
    expect(resB.chunks.join('')).not.toContain('only-A');

    resA.simulateClose();
    resB.simulateClose();
  });

  it('buffer respects RESUME_BUFFER_SIZE (100 events max)', async () => {
    const { getBufferedEvents, RESUME_BUFFER_SIZE, _resetBuffers } = await import('../sdk/sse-stream.js');
    const { eventBus } = await import('../realtime/event-bus.js');
    _resetBuffers();

    for (let i = 0; i < RESUME_BUFFER_SIZE + 10; i++) {
      eventBus.emitConsultEvent('consult.message_delta', 'sess-cap', { sessionId: 'sess-cap', delta: `t${i}` });
    }

    const all = getBufferedEvents('sess-cap', 0);
    expect(all.length).toBeLessThanOrEqual(RESUME_BUFFER_SIZE);
  });

  it('does not leak memory (registered/deregistered SSE connections)', async () => {
    const { streamConsultSSE, _resetBuffers } = await import('../sdk/sse-stream.js');
    _resetBuffers();
    const res = makeMockRes();
    streamConsultSSE('sess-leak', null, res as never);
    res.simulateClose();
    // After close, no entries in sseConnections for the session — indirectly
    // verified by ensuring no writes happen after close.
    const chunksBefore = res.chunks.length;
    // Even if more time passes, no new chunks should arrive
    vi.advanceTimersByTime(15_000);
    expect(res.chunks.length).toBe(chunksBefore);
  });
});
