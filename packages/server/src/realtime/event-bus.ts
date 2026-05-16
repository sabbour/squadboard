/**
 * event-bus.ts — Demo 12: in-process event bus for real-time fan-out.
 *
 * Single-process EventEmitter; no Redis needed in the hacking phase.
 * The WS server subscribes here and broadcasts to connected clients.
 */
import { EventEmitter } from 'node:events';

// ─── Types ──────────────────────────────────────────────────────────────────

export type IssueEventType =
  | 'issue.created'
  | 'issue.updated'
  | 'issue.moved'
  | 'issue.deleted';

export type RunEventType =
  | 'run.started'
  | 'run.output'
  | 'run.completed';

export type WorkflowEventType = 'workflow.advanced';

export type PresenceEventType =
  | 'presence.joined'
  | 'presence.left'
  | 'presence.moved';

/**
 * Live multi-agent session events.
 * Surfaced to the browser by the WS server so the LiveSession UI can
 * stream agent transcripts, tool calls, and completion in real time.
 *
 * Phase 5 additions: consult.request / consult.response / consult.error are
 * routed through the same session topic so the activity feed can render
 * consult exchanges inline alongside regular assistant messages.
 */
export type SessionEventType =
  | 'session.started'
  | 'session.message'
  | 'session.delta'
  | 'session.tool'
  | 'session.usage'
  | 'session.error'
  | 'session.completed'
  | 'session.steered'
  | 'consult.request'
  | 'consult.response'
  | 'consult.error';

export type CommentEventType =
  | 'comment.created'
  | 'comment.deleted';

export type DeliverableEventType =
  | 'deliverable.created'
  | 'deliverable.updated'
  | 'deliverable.reviewed'
  | 'deliverable.superseded';

/**
 * Phase 15: parallel SDK fan-out spawn telemetry. Emitted once per
 * spawnFanOutChildren() invocation so downstream UI (Phase 12 flow viz,
 * future ops dashboards) can render parallel-spawn fan-outs distinctly
 * from serial fan-outs.
 */
export type FanOutEventType = 'fan_out.parallel_spawn';

/**
 * Phase 3 Heartbeat: sweep lifecycle telemetry emitted by engine/heartbeat.ts.
 * Payload is scoped to `__heartbeat__` (server-wide, not project-scoped).
 */
export type HeartbeatEventType =
  | 'heartbeat.sweep.completed'
  | 'heartbeat.sweep.error';

/**
 * Phase 17: Ask / Consult mode events. Routed to a per-consult room
 * (key: `consult:<sessionId>`) rather than a project room because consult
 * sessions can be cross-project. Clients subscribe via the existing
 * `subscribe` ws message using that synthetic project key.
 */
export type ConsultEventType =
  | 'consult.started'
  | 'consult.user_message'
  | 'consult.message_delta'
  | 'consult.reasoning_delta'
  | 'consult.message_complete'
  | 'consult.tool_call'
  | 'consult.proposal_created'
  | 'consult.proposal_decided'
  | 'consult.usage'
  | 'consult.error'
  | 'consult.completed';

/**
 * Phase 12 reframe: Flow-page real-time events.
 * Scoped to a project room (same routing as RunEventType / WorkflowEventType).
 *
 * flow.instance.started    — a new agent instance began (workflow_run, issue_run, live_session, consult_session)
 * flow.instance.heartbeat  — periodic liveness tick for a running instance (throttled to 1/s per instance)
 * flow.instance.ended      — instance reached a terminal state
 * flow.lineage.edge.created — a new parent→child edge was materialised
 */
export type FlowEventType =
  | 'flow.instance.started'
  | 'flow.instance.heartbeat'
  | 'flow.instance.ended'
  | 'flow.lineage.edge.created';

/**
 * Stream G — GitHub integration: git push + PR lifecycle events.
 * Scoped to a project room so the run drawer button updates without page refresh.
 *
 * git.push.complete  — branch pushed to origin; payload includes branch + URL
 * git.pr.created     — PR opened via gh; payload includes PR URL + number
 * git.comment.posted — comment posted on a linked GH issue (G2.3)
 * git.pr.merged      — PR merged via gh pr merge (G2.5)
 */
export type GitEventType =
  | 'git.push.complete'
  | 'git.pr.created'
  | 'git.comment.posted'
  | 'git.pr.merged';

export type BusEventType =
  | IssueEventType
  | RunEventType
  | WorkflowEventType
  | PresenceEventType
  | SessionEventType
  | CommentEventType
  | DeliverableEventType
  | FanOutEventType
  | ConsultEventType
  | HeartbeatEventType
  | FlowEventType
  | GitEventType;

export interface BusEvent {
  type: BusEventType;
  projectId: string;
  payload: unknown;
}

// ─── EventBus singleton ──────────────────────────────────────────────────────

class EventBus extends EventEmitter {
  /** Emit an issue-lifecycle event scoped to a project. */
  emitIssueEvent(type: IssueEventType, projectId: string, payload: unknown): void {
    const event: BusEvent = { type, projectId, payload };
    this.emit('event', event);
  }

  /** Emit a run-lifecycle event scoped to a project. */
  emitRunEvent(type: RunEventType, projectId: string, payload: unknown): void {
    const event: BusEvent = { type, projectId, payload };
    this.emit('event', event);
  }

  /** Emit a workflow-step event scoped to a project. */
  emitWorkflowEvent(projectId: string, payload: unknown): void {
    const event: BusEvent = { type: 'workflow.advanced', projectId, payload };
    this.emit('event', event);
  }

  /** Emit a presence event scoped to a project. */
  emitPresenceEvent(type: PresenceEventType, projectId: string, payload: unknown): void {
    const event: BusEvent = { type, projectId, payload };
    this.emit('event', event);
  }

  /** Emit a live-session event scoped to a project. */
  emitSessionEvent(type: SessionEventType, projectId: string, payload: unknown): void {
    const event: BusEvent = { type, projectId, payload };
    this.emit('event', event);
  }

  /** Emit a comment-thread event scoped to a project. */
  emitCommentEvent(type: CommentEventType, projectId: string, payload: unknown): void {
    const event: BusEvent = { type, projectId, payload };
    this.emit('event', event);
  }

  /** Emit a deliverable-lifecycle event scoped to a project. */
  emitDeliverableEvent(type: DeliverableEventType, projectId: string, payload: unknown): void {
    const event: BusEvent = { type, projectId, payload };
    this.emit('event', event);
  }

  /**
   * Phase 15: parallel SDK fan-out spawn telemetry. The payload shape is
   * documented in sdk/fan-out-adapter.ts (FanOutSpawnTelemetry).
   * `projectId` may be 'global' when no project context is in scope, but
   * normally the engine forwards the parent workflow_run's project.
   */
  emitFanOutEvent(type: FanOutEventType, projectId: string, payload: unknown): void {
    const event: BusEvent = { type, projectId, payload };
    this.emit('event', event);
  }

  /**
   * Phase 17: Ask / Consult event. The "scope key" is `consult:<sessionId>`
   * (placed in the BusEvent.projectId slot for ws-server room routing).
   * Clients subscribe with `{ projectId: 'consult:<sessionId>' }` to
   * receive these events.
   */
  emitConsultEvent(type: ConsultEventType, consultSessionId: string, payload: unknown): void {
    const event: BusEvent = { type, projectId: `consult:${consultSessionId}`, payload };
    this.emit('event', event);
  }

  // ── Phase 12 reframe: Flow page real-time events ──────────────────────────

  /**
   * In-memory throttle map for `flow.instance.heartbeat` events.
   * Key: instanceId — Value: last emit timestamp (ms since epoch).
   * Entries are never explicitly evicted; they are O(active_instances) which
   * is bounded in practice by the number of running workflow/issue runs.
   */
  private readonly _flowHeartbeatLastEmit = new Map<string, number>();

  /**
   * Emit a flow lifecycle event (started / ended / lineage) scoped to a
   * project. Routed through the same project room as issue/run events.
   */
  emitFlowEvent(type: FlowEventType, projectId: string, payload: unknown): void {
    const event: BusEvent = { type, projectId, payload };
    this.emit('event', event);
  }

  /**
   * Emit `flow.instance.heartbeat` throttled to at most 1 event per second
   * per instance. Calls that arrive within the 1 s window are silently
   * dropped to avoid flooding the WS channel.
   */
  emitFlowHeartbeat(projectId: string, instanceId: string, payload: unknown): void {
    const now = Date.now();
    const last = this._flowHeartbeatLastEmit.get(instanceId) ?? 0;
    if (now - last < 1_000) return;
    this._flowHeartbeatLastEmit.set(instanceId, now);
    const event: BusEvent = { type: 'flow.instance.heartbeat', projectId, payload };
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
  emitHeartbeatEvent(type: HeartbeatEventType, payload: unknown): void {
    this.emit('heartbeat', { type, payload });
  }

  /** Subscribe to server-wide heartbeat sweep telemetry events. */
  onHeartbeat(handler: (event: { type: HeartbeatEventType; payload: unknown }) => void): () => void {
    this.on('heartbeat', handler);
    return () => this.off('heartbeat', handler);
  }
  /** Stream G: emit a git push / PR event scoped to a project. */
  emitGitEvent(type: GitEventType, projectId: string, payload: unknown): void {
    const event: BusEvent = { type, projectId, payload };
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
  subscribeGlobal(handler: (event: BusEvent) => void): () => void {
    this.on('event', handler);
    return () => this.off('event', handler);
  }
}

export const eventBus = new EventBus();
// Increase limit for large deployments with many WS subscribers
eventBus.setMaxListeners(512);
