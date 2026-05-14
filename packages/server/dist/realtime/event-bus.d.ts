/**
 * event-bus.ts — Demo 12: in-process event bus for real-time fan-out.
 *
 * Single-process EventEmitter; no Redis needed in the hacking phase.
 * The WS server subscribes here and broadcasts to connected clients.
 */
import { EventEmitter } from 'node:events';
export type IssueEventType = 'issue.created' | 'issue.updated' | 'issue.moved' | 'issue.deleted';
export type RunEventType = 'run.started' | 'run.output' | 'run.completed';
export type WorkflowEventType = 'workflow.advanced';
export type PresenceEventType = 'presence.joined' | 'presence.left' | 'presence.moved';
export type BusEventType = IssueEventType | RunEventType | WorkflowEventType | PresenceEventType;
export interface BusEvent {
    type: BusEventType;
    projectId: string;
    payload: unknown;
}
declare class EventBus extends EventEmitter {
    /** Emit an issue-lifecycle event scoped to a project. */
    emitIssueEvent(type: IssueEventType, projectId: string, payload: unknown): void;
    /** Emit a run-lifecycle event scoped to a project. */
    emitRunEvent(type: RunEventType, projectId: string, payload: unknown): void;
    /** Emit a workflow-step event scoped to a project. */
    emitWorkflowEvent(projectId: string, payload: unknown): void;
    /** Emit a presence event scoped to a project. */
    emitPresenceEvent(type: PresenceEventType, projectId: string, payload: unknown): void;
}
export declare const eventBus: EventBus;
export {};
//# sourceMappingURL=event-bus.d.ts.map