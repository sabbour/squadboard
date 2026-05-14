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
import { WebSocketServer } from 'ws';
import type { Server as HttpServer } from 'node:http';
export declare function initWebSocketServer(httpServer: HttpServer): WebSocketServer;
export declare function getWebSocketServer(): WebSocketServer | null;
/** Returns current connected client count (useful for health checks). */
export declare function connectedClients(): number;
//# sourceMappingURL=ws-server.d.ts.map