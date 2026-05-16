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
    /**
     * Phase 15: parallel SDK fan-out spawn telemetry. The payload shape is
     * documented in sdk/fan-out-adapter.ts (FanOutSpawnTelemetry).
     * `projectId` may be 'global' when no project context is in scope, but
     * normally the engine forwards the parent workflow_run's project.
     */
    emitFanOutEvent(type, projectId, payload) {
        const event = { type, projectId, payload };
        this.emit('event', event);
    }
    /**
     * Phase 17: Ask / Consult event. The "scope key" is `consult:<sessionId>`
     * (placed in the BusEvent.projectId slot for ws-server room routing).
     * Clients subscribe with `{ projectId: 'consult:<sessionId>' }` to
     * receive these events.
     */
    emitConsultEvent(type, consultSessionId, payload) {
        const event = { type, projectId: `consult:${consultSessionId}`, payload };
        this.emit('event', event);
    }
    // ── Phase 12 reframe: Flow page real-time events ──────────────────────────
    /**
     * In-memory throttle map for `flow.instance.heartbeat` events.
     * Key: instanceId — Value: last emit timestamp (ms since epoch).
     * Entries are never explicitly evicted; they are O(active_instances) which
     * is bounded in practice by the number of running workflow/issue runs.
     */
    _flowHeartbeatLastEmit = new Map();
    /**
     * Emit a flow lifecycle event (started / ended / lineage) scoped to a
     * project. Routed through the same project room as issue/run events.
     */
    emitFlowEvent(type, projectId, payload) {
        const event = { type, projectId, payload };
        this.emit('event', event);
    }
    /**
     * Emit `flow.instance.heartbeat` throttled to at most 1 event per second
     * per instance. Calls that arrive within the 1 s window are silently
     * dropped to avoid flooding the WS channel.
     */
    emitFlowHeartbeat(projectId, instanceId, payload) {
        const now = Date.now();
        const last = this._flowHeartbeatLastEmit.get(instanceId) ?? 0;
        if (now - last < 1_000)
            return;
        this._flowHeartbeatLastEmit.set(instanceId, now);
        const event = { type: 'flow.instance.heartbeat', projectId, payload };
        this.emit('event', event);
    }
    /**
     * Phase 3 Heartbeat: sweep telemetry event.
     *
     * Emitted on the separate `'heartbeat'` channel — NOT on `'event'` — so
     * project-scoped subscribers (e.g. ceremony-dispatcher) never see these.
     * Heartbeat events are server-wide infrastructure telemetry; they carry no
     * project UUID and must not be routed through project-event pipelines.
     *
     * Subscribers: use `eventBus.on('heartbeat', handler)`.
     */
    emitHeartbeatEvent(type, payload) {
        this.emit('heartbeat', { type, payload });
    }
    /** Subscribe to server-wide heartbeat sweep telemetry events. */
    onHeartbeat(handler) {
        this.on('heartbeat', handler);
        return () => this.off('heartbeat', handler);
    }
    /** Stream G: emit a git push / PR event scoped to a project. */
    emitGitEvent(type, projectId, payload) {
        const event = { type, projectId, payload };
        this.emit('event', event);
    }
    /** Wave 20 — G4.2: emit a copilot-watcher event scoped to a project. */
    emitCopilotEvent(type, projectId, payload) {
        const event = { type, projectId, payload };
        this.emit('event', event);
    }
    /** Stream G Phase 2B: emit a GitHub webhook event scoped to a project. */
    emitGithubWebhookEvent(eventType, action, projectId, payload) {
        const busType = action
            ? `github.${eventType}.${action}`
            : `github.${eventType}`;
        const event = { type: busType, projectId, payload };
        this.emit('event', event);
    }
    /**
     * Phase 19 (Now view): Subscribe to ALL events across ALL projects.
     * The handler receives every BusEvent emitted on the in-process bus,
     * regardless of projectId. Used by the WS server to fan out to clients
     * that hold a `__global__` subscription (the /now page).
     *
     * Returns an unsubscribe function for clean teardown.
     */
    subscribeGlobal(handler) {
        this.on('event', handler);
        return () => this.off('event', handler);
    }
}
export const eventBus = new EventBus();
// Increase limit for large deployments with many WS subscribers
eventBus.setMaxListeners(512);
//# sourceMappingURL=event-bus.js.map