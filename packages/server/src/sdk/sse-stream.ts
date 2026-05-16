/**
 * sdk/sse-stream.ts — W28 J3
 *
 * Server-sent events (SSE) alternative transport for consult streaming.
 *
 * Design:
 *   - Maintains a per-session event buffer (last 100 events) so clients can
 *     resume after a disconnect using the `Last-Event-Id` header.
 *   - A single global eventBus listener populates the buffer AND fans out to
 *     all active SSE connections for the same session, avoiding duplicate
 *     subscriptions.
 *   - Emits `:heartbeat\n\n` comment lines every 15 s.
 *   - Terminates the stream on `consult.completed` or `consult.error`.
 *
 * Delta shape mirrors the WS consult event types exactly so the client
 * can use the same payload handlers for both transports.
 */

import type { Response } from 'express';
import { eventBus } from '../realtime/event-bus.js';
import type { BusEvent, ConsultEventType } from '../realtime/event-bus.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BufferedConsultEvent {
  seq: number;
  type: ConsultEventType;
  payload: unknown;
}

// ─── Resume buffer (last 100 events per session) ──────────────────────────────

export const RESUME_BUFFER_SIZE = 100;
export const HEARTBEAT_INTERVAL_MS = 15_000;

const buffers = new Map<string, BufferedConsultEvent[]>();
const seqCounters = new Map<string, number>();

/** All active SSE notify-callbacks keyed by sessionId. */
const sseConnections = new Map<string, Set<(event: BufferedConsultEvent) => void>>();

const CONSULT_PREFIX = 'consult:';
const TERMINAL_TYPES = new Set<ConsultEventType>(['consult.completed', 'consult.error']);

function isConsultEventType(t: string): t is ConsultEventType {
  return t.startsWith('consult.');
}

function nextSeq(sessionId: string): number {
  const n = (seqCounters.get(sessionId) ?? 0) + 1;
  seqCounters.set(sessionId, n);
  return n;
}

// ─── Single global buffer + fan-out listener ──────────────────────────────────

eventBus.on('event', (evt: BusEvent) => {
  if (!evt.projectId.startsWith(CONSULT_PREFIX)) return;
  if (!isConsultEventType(evt.type)) return;

  const sessionId = evt.projectId.slice(CONSULT_PREFIX.length);
  const seq = nextSeq(sessionId);
  const entry: BufferedConsultEvent = {
    seq,
    type: evt.type as ConsultEventType,
    payload: evt.payload,
  };

  // Buffer
  const buf = buffers.get(sessionId) ?? [];
  buf.push(entry);
  if (buf.length > RESUME_BUFFER_SIZE) buf.shift();
  buffers.set(sessionId, buf);

  // Fan-out to active SSE connections
  const conns = sseConnections.get(sessionId);
  if (conns) {
    for (const notify of conns) {
      try { notify(entry); } catch { /* isolated */ }
    }
  }
});

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Return buffered events with seq strictly greater than `fromSeq`.
 * Used by the SSE endpoint (Last-Event-Id replay) and the WS resubscribe handler.
 */
export function getBufferedEvents(sessionId: string, fromSeq: number): BufferedConsultEvent[] {
  const buf = buffers.get(sessionId) ?? [];
  return buf.filter((e) => e.seq > fromSeq);
}

/** Current highest seq for a session (0 if no events yet). */
export function currentSeq(sessionId: string): number {
  return seqCounters.get(sessionId) ?? 0;
}

/** Exposed for tests: clear all buffer state. */
export function _resetBuffers(): void {
  buffers.clear();
  seqCounters.clear();
  sseConnections.clear();
}

// ─── SSE stream ───────────────────────────────────────────────────────────────

function writeSSEEvent(res: Response, entry: BufferedConsultEvent): void {
  res.write(`id: ${entry.seq}\nevent: ${entry.type}\ndata: ${JSON.stringify(entry.payload)}\n\n`);
}

/**
 * Attach an SSE stream to `res` for the given consult session.
 *
 * `lastEventIdHeader` — value of the `Last-Event-Id` request header (or a
 * `?lastEventId=` query-param override for manual retries). When provided,
 * buffered events with seq > lastEventId are replayed before going live.
 */
export function streamConsultSSE(
  sessionId: string,
  lastEventIdHeader: string | null | undefined,
  res: Response,
): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Replay missed events
  const fromSeq = lastEventIdHeader ? parseInt(lastEventIdHeader, 10) : 0;
  if (!isNaN(fromSeq) && fromSeq > 0) {
    for (const e of getBufferedEvents(sessionId, fromSeq)) {
      writeSSEEvent(res, e);
    }
  }

  let closed = false;

  function cleanup() {
    if (closed) return;
    closed = true;
    clearInterval(hbTimer);
    const conns = sseConnections.get(sessionId);
    if (conns) {
      conns.delete(notify);
      if (conns.size === 0) sseConnections.delete(sessionId);
    }
    try { res.end(); } catch { /* ignore */ }
  }

  function notify(entry: BufferedConsultEvent): void {
    if (closed) return;
    try {
      writeSSEEvent(res, entry);
    } catch {
      cleanup();
      return;
    }
    if (TERMINAL_TYPES.has(entry.type)) {
      cleanup();
    }
  }

  // Register in fan-out map
  let conns = sseConnections.get(sessionId);
  if (!conns) {
    conns = new Set();
    sseConnections.set(sessionId, conns);
  }
  conns.add(notify);

  // 15 s heartbeat
  const hbTimer = setInterval(() => {
    if (closed) return;
    try {
      res.write(':heartbeat\n\n');
    } catch {
      cleanup();
    }
  }, HEARTBEAT_INTERVAL_MS);

  res.on('close', cleanup);
}
