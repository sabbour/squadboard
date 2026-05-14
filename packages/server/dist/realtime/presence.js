/**
 * presence.ts — Demo 12: in-memory presence tracking.
 *
 * Tracks which anonymous WS clients (identified by their connection ID) are
 * in each project, and which issue they're currently hovering.
 *
 * userId = generated connection ID (anonymous; no auth in hacking phase).
 */
import { eventBus } from './event-bus.js';
// projectId → Map<userId, PresenceRecord>
const presenceMap = new Map();
function getRoom(projectId) {
    let room = presenceMap.get(projectId);
    if (!room) {
        room = new Map();
        presenceMap.set(projectId, room);
    }
    return room;
}
/** Called when a WS client subscribes to a project. */
export function joinPresence(projectId, userId) {
    const room = getRoom(projectId);
    const record = {
        userId,
        connectedAt: new Date(),
        issueId: null,
    };
    room.set(userId, record);
    eventBus.emitPresenceEvent('presence.joined', projectId, { userId, cursor: null });
}
/** Called when a WS client unsubscribes from a project or disconnects. */
export function leavePresence(projectId, userId) {
    const room = presenceMap.get(projectId);
    if (!room)
        return;
    room.delete(userId);
    if (room.size === 0)
        presenceMap.delete(projectId);
    eventBus.emitPresenceEvent('presence.left', projectId, { userId });
}
/** Called on presence.cursor messages from the client. */
export function moveCursor(projectId, userId, issueId) {
    const room = presenceMap.get(projectId);
    if (!room)
        return;
    const record = room.get(userId);
    if (!record)
        return;
    record.issueId = issueId;
    // Broadcast to OTHER subscribers only; ws-server handles filtering
    eventBus.emitPresenceEvent('presence.moved', projectId, { userId, issueId });
}
/** Returns a snapshot of current presence for a project (for GET /presence). */
export function listPresence(projectId) {
    const room = presenceMap.get(projectId);
    if (!room)
        return [];
    return Array.from(room.values());
}
/** Clean up all presence records for a userId across ALL projects they joined. */
export function removeUser(userId, subscribedProjects) {
    for (const projectId of subscribedProjects) {
        leavePresence(projectId, userId);
    }
}
//# sourceMappingURL=presence.js.map