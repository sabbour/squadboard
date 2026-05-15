/**
 * event-bus.ts — Demo 12: in-process event bus for real-time fan-out.
 *
 * Single-process EventEmitter; no Redis needed in the hacking phase.
 * The WS server subscribes here and broadcasts to connected clients.
 */
import { EventEmitter } from 'node:events';
// ─── EventBus singleton ──────────────────────────────────────────────────────
class EventBus extends EventEmitter {
    /** Emit an issue-lifecycle event scoped to a project. */
    emitIssueEvent(type, projectId, payload) {
        const event = { type, projectId, payload };
        this.emit('event', event);
    }
    /** Emit a run-lifecycle event scoped to a project. */
    emitRunEvent(type, projectId, payload) {
        const event = { type, projectId, payload };
        this.emit('event', event);
    }
    /** Emit a workflow-step event scoped to a project. */
    emitWorkflowEvent(projectId, payload) {
        const event = { type: 'workflow.advanced', projectId, payload };
        this.emit('event', event);
    }
    /** Emit a presence event scoped to a project. */
    emitPresenceEvent(type, projectId, payload) {
        const event = { type, projectId, payload };
        this.emit('event', event);
    }
    /** Emit a live-session event scoped to a project. */
    emitSessionEvent(type, projectId, payload) {
        const event = { type, projectId, payload };
        this.emit('event', event);
    }
    /** Emit a comment-thread event scoped to a project. */
    emitCommentEvent(type, projectId, payload) {
        const event = { type, projectId, payload };
        this.emit('event', event);
    }
    /** Emit a deliverable-lifecycle event scoped to a project. */
    emitDeliverableEvent(type, projectId, payload) {
        const event = { type, projectId, payload };
        this.emit('event', event);
    }
}
export const eventBus = new EventBus();
// Increase limit for large deployments with many WS subscribers
eventBus.setMaxListeners(512);
//# sourceMappingURL=event-bus.js.map