/**
 * ws-server.ts — Demo 12: WebSocket server sharing port 3000 with Express.
 *
 * Protocol: JSON `{ type, payload }` envelope.
 *
 * Client → Server messages:
 *   subscribe       { projectId }
 *   unsubscribe     { projectId }
 *   presence.cursor { projectId, issueId | null }
 *   resubscribe     { projectId, lastSeq }  — W28 J3: replay from lastSeq
 *
 * Server → Client messages (all sourced from eventBus):
 *   issue.created   issue.updated   issue.moved   issue.deleted
 *   run.started     run.output      run.completed
 *   workflow.advanced
 *   presence.joined presence.left   presence.moved
 *
 * W28 J3: 15 s WS ping/pong heartbeat. Connections that miss a pong are
 * terminated to free stale sockets and give the client a clean reconnect.
 */
import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage, Server as HttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { eventBus, type BusEvent } from './event-bus.js';
import { joinPresence, leavePresence, moveCursor, removeUser } from './presence.js';
import { getBufferedEvents } from '../sdk/sse-stream.js';
import { extractRequestToken, type VerifiedAuthToken, verifyPresentedToken } from '../middleware/auth-token.js';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ClientMessage {
  type: 'subscribe' | 'unsubscribe' | 'presence.cursor' | 'resubscribe';
  payload?: {
    projectId?: string;
    issueId?: string | null;
    lastSeq?: number;
  };
}

interface ClientState {
  ws: WebSocket;
  userId: string;
  subscribedProjects: Set<string>;
  allowedProjectId: string | null;
}

interface AuthenticatedUpgradeRequest extends IncomingMessage {
  wsAuth?: VerifiedAuthToken | null;
}

// ─── State ───────────────────────────────────────────────────────────────────

// projectId → Set of client states
const rooms = new Map<string, Set<ClientState>>();
// ws → client state (fast lookup on message/close)
const clients = new Map<WebSocket, ClientState>();
// Clients subscribed to every event regardless of project (the /now page).
const globalClients = new Set<ClientState>();
// projectId:userId → sender socket for the next presence.updated fan-out.
const presenceUpdateSenders = new Map<string, WebSocket>();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function send(ws: WebSocket, type: string, payload: unknown): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type, payload }));
}

function broadcast(projectId: string, type: string, payload: unknown, excludeWs?: WebSocket): void {
  const room = rooms.get(projectId);
  if (!room) return;
  for (const client of room) {
    if (client.ws === excludeWs) continue;
    send(client.ws, type, payload);
  }
}

function isAuthorizedProject(state: ClientState, projectId: string): boolean {
  return state.allowedProjectId === null || state.allowedProjectId === projectId;
}

function subscribeToProject(state: ClientState, projectId: string): void {
  if (state.subscribedProjects.has(projectId)) return;
  state.subscribedProjects.add(projectId);

  let room = rooms.get(projectId);
  if (!room) {
    room = new Set();
    rooms.set(projectId, room);
  }
  room.add(state);

  joinPresence(projectId, state.userId);
}

function unsubscribeFromProject(state: ClientState, projectId: string): void {
  if (!state.subscribedProjects.has(projectId)) return;
  state.subscribedProjects.delete(projectId);

  const room = rooms.get(projectId);
  if (room) {
    room.delete(state);
    if (room.size === 0) rooms.delete(projectId);
  }

  leavePresence(projectId, state.userId);
}

function subscribeGlobalClient(state: ClientState): void {
  globalClients.add(state);
  state.subscribedProjects.add('__global__');
}

function unsubscribeGlobalClient(state: ClientState): void {
  globalClients.delete(state);
  state.subscribedProjects.delete('__global__');
}

function handleMessage(state: ClientState, raw: string): void {
  let msg: ClientMessage;
  try {
    msg = JSON.parse(raw) as ClientMessage;
  } catch {
    send(state.ws, 'error', { message: 'Invalid JSON' });
    return;
  }

  const { type, payload } = msg;
  const projectId = payload?.projectId;

  if (projectId && !isAuthorizedProject(state, projectId)) {
    send(state.ws, 'error', {
      message: `Forbidden project subscription: token grants ${state.allowedProjectId ?? 'no'} project access, not ${projectId}`,
    });
    return;
  }

  switch (type) {
    case 'subscribe':
      if (!projectId) { send(state.ws, 'error', { message: 'subscribe requires projectId' }); return; }
      // Phase 19: '__global__' is the magic room that receives every bus event.
      if (projectId === '__global__') {
        subscribeGlobalClient(state);
        send(state.ws, 'subscribed', { projectId: '__global__', userId: state.userId });
        return;
      }
      subscribeToProject(state, projectId);
      send(state.ws, 'subscribed', { projectId, userId: state.userId });
      break;

    case 'unsubscribe':
      if (!projectId) { send(state.ws, 'error', { message: 'unsubscribe requires projectId' }); return; }
      if (projectId === '__global__') {
        unsubscribeGlobalClient(state);
        send(state.ws, 'unsubscribed', { projectId: '__global__' });
        return;
      }
      unsubscribeFromProject(state, projectId);
      send(state.ws, 'unsubscribed', { projectId });
      break;

    case 'presence.cursor':
      if (!projectId) { send(state.ws, 'error', { message: 'presence.cursor requires projectId' }); return; }
      moveCursor(projectId, state.userId, payload?.issueId ?? null);
      // Broadcast to others in the room; the emitter in presence.ts fires eventBus which
      // goes through the bus listener below — but we need to exclude the sender there.
      // The exclusion is handled in the bus listener via the excludeWs mechanism.
      break;

    case 'resubscribe': {
      // W28 J3: replay buffered consult events from lastSeq.
      if (!projectId) { send(state.ws, 'error', { message: 'resubscribe requires projectId' }); return; }
      const lastSeq = typeof payload?.lastSeq === 'number' ? payload.lastSeq : 0;
      // Only applicable to consult rooms (consult:<sessionId>)
      if (projectId.startsWith('consult:')) {
        const sessionId = projectId.slice('consult:'.length);
        const missed = getBufferedEvents(sessionId, lastSeq);
        for (const entry of missed) {
          send(state.ws, entry.type, entry.payload);
        }
      }
      send(state.ws, 'resubscribed', { projectId, replayed: projectId.startsWith('consult:') });
      break;
    }

    default:
      send(state.ws, 'error', { message: `Unknown message type: ${String(type)}` });
  }
}

function handleClose(state: ClientState): void {
  clients.delete(state.ws);
  globalClients.delete(state); // clean up global subscription if any
  const projects = Array.from(state.subscribedProjects);
  for (const projectId of projects) {
    if (projectId === '__global__') continue;
    const room = rooms.get(projectId);
    if (room) {
      room.delete(state);
      if (room.size === 0) rooms.delete(projectId);
    }
  }
  removeUser(state.userId, projects.filter((p) => p !== '__global__'));
}

// ─── Bus listener — fan-out to WS clients ─────────────────────────────────────

function onBusEvent(event: BusEvent): void {
  let excludeWs: WebSocket | undefined;
  if (event.type === 'presence.updated') {
    const payload = event.payload as { userId?: string };
    const userId = typeof payload.userId === 'string' ? payload.userId : null;
    if (userId) {
      const key = `${event.projectId}:${userId}`;
      excludeWs = presenceUpdateSenders.get(key);
      presenceUpdateSenders.delete(key);
    }
  }

  broadcast(event.projectId, event.type, event.payload, excludeWs);
  // Phase 19: fan-out to global subscribers (/now view).
  // Deliver every bus event to clients that requested '__global__' scope.
  for (const client of globalClients) {
    if (client.ws === excludeWs) continue;
    send(client.ws, event.type, event.payload);
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────

let wss: WebSocketServer | null = null;

export const WS_PING_INTERVAL_MS = 15_000;
export const WS_MAX_PAYLOAD_BYTES = 64 * 1024;

function getUpgradePath(req: IncomingMessage): string {
  return new URL(req.url ?? '/', 'http://localhost').pathname;
}

function rejectUpgrade(socket: NodeJS.WritableStream & { destroy(): void }, message: string): void {
  socket.write(`HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Type: text/plain\r\n\r\n${message}`);
  socket.destroy();
}

export function initWebSocketServer(httpServer: HttpServer): WebSocketServer {
  // Mounted under /api/ws so the dev-server Vite proxy (which only forwards
  // /api with `ws: true`) routes the WebSocket upgrade to the Express server
  // in development. The client opens `${WS_BASE}/api/ws` (see
  // packages/client/src/realtime/ws-client.ts); keeping the server path in
  // sync is critical — a mismatch (e.g. server on /ws, client on /api/ws)
  // leaves the badge stuck on yellow "Reconnecting" forever in dev because
  // every handshake fails immediately.
  wss = new WebSocketServer({ noServer: true, maxPayload: WS_MAX_PAYLOAD_BYTES });

  httpServer.on('upgrade', (req, socket, head) => {
    if (getUpgradePath(req) !== '/api/ws') return;

    void (async () => {
      const verification = await verifyPresentedToken(extractRequestToken(req));
      if (!verification.ok) {
        rejectUpgrade(socket, verification.message ?? 'Unauthorized');
        return;
      }
      if (verification.authEnabled) {
        if (!verification.token || verification.token.mode !== 'jwt' || !verification.token.projectId) {
          rejectUpgrade(socket, 'WebSocket connections require a JWT with a projectId claim.');
          return;
        }
      }

      (req as AuthenticatedUpgradeRequest).wsAuth = verification.token;
      wss?.handleUpgrade(req, socket, head, (ws) => {
        wss?.emit('connection', ws, req);
      });
    })().catch((err) => {
      console.error('[ws] upgrade auth error:', err);
      rejectUpgrade(socket, 'Unauthorized');
    });
  });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const auth = (req as AuthenticatedUpgradeRequest).wsAuth ?? null;
    const claimedUserId = auth?.subject ?? (typeof auth?.payload?.['userId'] === 'string' ? auth.payload['userId'] : null);
    const userId = claimedUserId && claimedUserId.trim() ? claimedUserId : randomUUID();
    const state: ClientState = {
      ws,
      userId,
      subscribedProjects: new Set(),
      allowedProjectId: auth?.projectId ?? null,
    };
    clients.set(ws, state);

    // Send the assigned userId so the client knows who it is.
    send(ws, 'connected', { userId });

    // W28 J3: 15 s ping/pong heartbeat. Track liveness; terminate on missed pong.
    let isAlive = true;
    ws.on('pong', () => { isAlive = true; });
    const pingTimer = setInterval(() => {
      if (!isAlive) {
        ws.terminate();
        return;
      }
      isAlive = false;
      ws.ping();
    }, WS_PING_INTERVAL_MS);

    ws.on('message', (data) => {
      handleMessage(state, data.toString());
    });

    ws.on('close', () => {
      clearInterval(pingTimer);
      handleClose(state);
    });
    ws.on('error', (err) => {
      console.error(`[ws] client ${userId} error:`, err);
      clearInterval(pingTimer);
      handleClose(state);
    });
  });

  // Subscribe to the in-process event bus
  eventBus.on('event', onBusEvent);

  // W25: fan-out sweep.tick heartbeat events to global subscribers so the
  // Heartbeat + Now pages can animate the sweep timeline. Other heartbeat
  // event types (sweep.completed / sweep.error) remain server-only and are
  // not forwarded over WS to avoid duplicating data the page polls for.
  eventBus.onHeartbeat((evt) => {
    if (evt.type !== 'sweep.tick') return;
    for (const client of globalClients) {
      send(client.ws, 'sweep.tick', evt.payload);
    }
  });

  wss.on('error', (err) => {
    console.error('[ws] server error:', err);
  });

  console.log('[ws] WebSocket server attached to HTTP server at /api/ws');
  return wss;
}

export function getWebSocketServer(): WebSocketServer | null {
  return wss;
}

/** Returns current connected client count (useful for health checks). */
export function connectedClients(): number {
  return clients.size;
}
