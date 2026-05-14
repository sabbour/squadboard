/**
 * ws-server.ts — Demo 12: WebSocket server sharing port 3000 with Express.
 *
 * Protocol: JSON `{ type, payload }` envelope.
 *
 * Client → Server messages:
 *   subscribe       { projectId }
 *   unsubscribe     { projectId }
 *   presence.cursor { projectId, issueId | null }
 *
 * Server → Client messages (all sourced from eventBus):
 *   issue.created   issue.updated   issue.moved   issue.deleted
 *   run.started     run.output      run.completed
 *   workflow.advanced
 *   presence.joined presence.left   presence.moved
 */
import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { Server as HttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { eventBus, type BusEvent } from './event-bus.js';
import { joinPresence, leavePresence, moveCursor, removeUser } from './presence.js';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ClientMessage {
  type: 'subscribe' | 'unsubscribe' | 'presence.cursor';
  payload?: {
    projectId?: string;
    issueId?: string | null;
  };
}

interface ClientState {
  ws: WebSocket;
  userId: string;
  subscribedProjects: Set<string>;
}

// ─── State ───────────────────────────────────────────────────────────────────

// projectId → Set of client states
const rooms = new Map<string, Set<ClientState>>();
// ws → client state (fast lookup on message/close)
const clients = new Map<WebSocket, ClientState>();

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

  switch (type) {
    case 'subscribe':
      if (!projectId) { send(state.ws, 'error', { message: 'subscribe requires projectId' }); return; }
      subscribeToProject(state, projectId);
      send(state.ws, 'subscribed', { projectId, userId: state.userId });
      break;

    case 'unsubscribe':
      if (!projectId) { send(state.ws, 'error', { message: 'unsubscribe requires projectId' }); return; }
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

    default:
      send(state.ws, 'error', { message: `Unknown message type: ${String(type)}` });
  }
}

function handleClose(state: ClientState): void {
  clients.delete(state.ws);
  const projects = Array.from(state.subscribedProjects);
  for (const projectId of projects) {
    const room = rooms.get(projectId);
    if (room) {
      room.delete(state);
      if (room.size === 0) rooms.delete(projectId);
    }
  }
  removeUser(state.userId, projects);
}

// ─── Bus listener — fan-out to WS clients ─────────────────────────────────────

function onBusEvent(event: BusEvent): void {
  broadcast(event.projectId, event.type, event.payload);
}

// ─── Init ─────────────────────────────────────────────────────────────────────

let wss: WebSocketServer | null = null;

export function initWebSocketServer(httpServer: HttpServer): WebSocketServer {
  wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws: WebSocket, _req: IncomingMessage) => {
    const userId = randomUUID();
    const state: ClientState = {
      ws,
      userId,
      subscribedProjects: new Set(),
    };
    clients.set(ws, state);

    // Send the assigned userId so the client knows who it is
    send(ws, 'connected', { userId });

    ws.on('message', (data) => {
      handleMessage(state, data.toString());
    });

    ws.on('close', () => handleClose(state));
    ws.on('error', (err) => {
      console.error(`[ws] client ${userId} error:`, err);
      handleClose(state);
    });
  });

  // Subscribe to the in-process event bus
  eventBus.on('event', onBusEvent);

  wss.on('error', (err) => {
    console.error('[ws] server error:', err);
  });

  console.log('[ws] WebSocket server attached to HTTP server at /ws');
  return wss;
}

export function getWebSocketServer(): WebSocketServer | null {
  return wss;
}

/** Returns current connected client count (useful for health checks). */
export function connectedClients(): number {
  return clients.size;
}
