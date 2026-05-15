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
 */
export type SessionEventType =
  | 'session.started'
  | 'session.message'
  | 'session.delta'
  | 'session.tool'
  | 'session.usage'
  | 'session.error'
  | 'session.completed'
  | 'session.steered';

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

export type BusEventType =
  | IssueEventType
  | RunEventType
  | WorkflowEventType
  | PresenceEventType
  | SessionEventType
  | CommentEventType
  | DeliverableEventType
  | FanOutEventType;

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
}

export const eventBus = new EventBus();
// Increase limit for large deployments with many WS subscribers
eventBus.setMaxListeners(512);
