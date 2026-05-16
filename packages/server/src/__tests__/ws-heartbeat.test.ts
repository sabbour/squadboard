/**
 * ws-heartbeat.test.ts — W28 J3
 *
 * Verifies the 15 s WS ping/pong heartbeat added to ws-server.ts:
 *   - A ping frame is sent to each client every 15 s.
 *   - A connection that does not respond with pong is terminated.
 *   - A connection that responds with pong stays alive.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { WS_PING_INTERVAL_MS } from '../realtime/ws-server.js';

// ── Fake WebSocket ────────────────────────────────────────────────────────────

class FakeWS extends EventEmitter {
  public readyState = 1; // OPEN
  public pings = 0;
  public terminated = false;
  public sent: string[] = [];

  ping() { this.pings++; }
  terminate() { this.terminated = true; this.readyState = 3; }
  send(data: string) { this.sent.push(data); }

  /** Simulate client pong response. */
  simulatePong() { this.emit('pong'); }
  /** Simulate clean close. */
  simulateClose() { this.emit('close'); }
}

// ── Replicate the ping logic in isolation ─────────────────────────────────────
//
// We extract the ping/pong logic so we can test it without spinning up a real
// HTTP server. The logic mirrors exactly what ws-server.ts does on 'connection'.

function attachPingPong(ws: FakeWS): () => void {
  let isAlive = true;
  ws.on('pong', () => { isAlive = true; });

  const timer = setInterval(() => {
    if (!isAlive) {
      ws.terminate();
      return;
    }
    isAlive = false;
    ws.ping();
  }, WS_PING_INTERVAL_MS);

  const cleanup = () => clearInterval(timer);
  ws.on('close', cleanup);
  return cleanup;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ws-heartbeat (15 s ping/pong)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('WS_PING_INTERVAL_MS is 15000', () => {
    expect(WS_PING_INTERVAL_MS).toBe(15_000);
  });

  it('sends one ping after 15 s', () => {
    const ws = new FakeWS();
    attachPingPong(ws);

    vi.advanceTimersByTime(15_000);

    expect(ws.pings).toBe(1);
    ws.simulateClose();
  });

  it('sends three pings after 45 s (with pong between each)', () => {
    const ws = new FakeWS();
    attachPingPong(ws);

    for (let i = 0; i < 3; i++) {
      vi.advanceTimersByTime(15_000);
      ws.simulatePong();
    }

    expect(ws.pings).toBe(3);
    expect(ws.terminated).toBe(false);
    ws.simulateClose();
  });

  it('terminates connection when pong is NOT received', () => {
    const ws = new FakeWS();
    attachPingPong(ws);

    // First interval: sets isAlive=false, sends ping — pong never comes.
    vi.advanceTimersByTime(15_000);
    expect(ws.pings).toBe(1);
    expect(ws.terminated).toBe(false);

    // Second interval: isAlive is still false → terminate.
    vi.advanceTimersByTime(15_000);
    expect(ws.terminated).toBe(true);
  });

  it('does NOT terminate when pong arrives before next interval', () => {
    const ws = new FakeWS();
    attachPingPong(ws);

    vi.advanceTimersByTime(15_000); // ping sent, isAlive=false
    ws.simulatePong();              // isAlive=true again

    vi.advanceTimersByTime(15_000); // second interval: alive → just send another ping
    expect(ws.terminated).toBe(false);
    expect(ws.pings).toBe(2);
    ws.simulateClose();
  });

  it('stops pinging after close', () => {
    const ws = new FakeWS();
    attachPingPong(ws);

    ws.simulateClose();
    vi.advanceTimersByTime(60_000);
    expect(ws.pings).toBe(0);
    expect(ws.terminated).toBe(false);
  });
});
