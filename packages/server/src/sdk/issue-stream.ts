/**
 * issue-stream.ts — Wave 28 JIS-T2
 *
 * RunningIssueSessionImpl: the concrete class that satisfies the
 * RunningIssueSession interface (defined in engine/active-issue-sessions.ts).
 *
 * Responsibilities:
 *   1. Self-registers in the activeIssueSessions registry on construction
 *      so the steer endpoint can reach it while the run is in flight.
 *   2. Persists every emitted event to issue_run_events (seq-ordered log).
 *   3. Publishes every event to the in-process eventBus so WebSocket clients
 *      receive real-time updates without polling.
 *   4. Handles steer() gracefully: always records the steered event in the
 *      DB; attempts to call sdkClient.sendMessage() if one is provided;
 *      emits console.warn and continues if the SDK can't interrupt mid-stream.
 *   5. dispose() cleans up: unregisters from the registry, calls optional
 *      SDK cleanup, and idempotently marks itself as disposed.
 *
 * Mirrors the RunningLiveSession pattern in sdk/squad-stream.ts.
 */

import { getDb } from '../db/index.js';
import { issueRunEvents } from '../db/schema.js';
import { eventBus, type IssueRunEventType } from '../realtime/event-bus.js';
import * as activeIssueSessions from '../engine/active-issue-sessions.js';
import type { RunningIssueSession } from '../engine/active-issue-sessions.js';

// ---------------------------------------------------------------------------
// Minimal SDK client interface — only the subset issue-stream needs.
// The full SquadClient surface is in squad-stream.ts / squad-client.ts.
// ---------------------------------------------------------------------------

export interface IssueSdkClient {
  /**
   * Inject a message into the running agent session.
   * May throw if the session has already terminated.
   */
  sendMessage(message: string): Promise<void>;

  /** Optional graceful shutdown (close network connection, flush buffers). */
  dispose?(): Promise<void>;
}

// ---------------------------------------------------------------------------
// RunningIssueSessionImpl
// ---------------------------------------------------------------------------

export class RunningIssueSessionImpl implements RunningIssueSession {
  private readonly runId: string;
  private readonly projectId: string;
  private readonly sdkClient: IssueSdkClient | null;
  private seq = 0;
  private isDisposed = false;

  constructor(args: {
    runId: string;
    projectId: string;
    /** Optional live SDK client. Null for one-shot bridge runs. */
    sdkClient?: IssueSdkClient | null;
  }) {
    this.runId = args.runId;
    this.projectId = args.projectId;
    this.sdkClient = args.sdkClient ?? null;
    activeIssueSessions.register(this.runId, this);
  }

  // ── Interface implementation ──────────────────────────────────────────────

  getRunId(): string {
    return this.runId;
  }

  getProjectId(): string {
    return this.projectId;
  }

  /**
   * Inject a steering message.
   *
   * Graceful degradation:
   * - Always records the event to DB (the record is the canonical audit trail).
   * - If an sdkClient is present, attempts sendMessage(); catches and warns on
   *   failure (e.g., SDK session already closed after a one-shot run).
   * - If no sdkClient is present, emits a console.warn; the event is still
   *   persisted so callers see it via the events endpoint.
   */
  async steer(message: string, actor = 'user'): Promise<void> {
    if (this.isDisposed) {
      throw new Error(`[issue-stream] Cannot steer disposed session for run ${this.runId}`);
    }
    await this.emit('issue.run.steered', { message, actor });

    if (!this.sdkClient) {
      console.warn(
        `[issue-stream] steer requested for run ${this.runId} but no live SDK session is attached; ` +
          'event recorded but message cannot be injected mid-stream.',
      );
      return;
    }

    try {
      await this.sdkClient.sendMessage(message);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[issue-stream] steer for run ${this.runId}: SDK sendMessage failed (${msg}); ` +
          'event was still recorded.',
      );
    }
  }

  /**
   * Gracefully tear down the session.
   * Idempotent — safe to call multiple times.
   */
  async dispose(): Promise<void> {
    if (this.isDisposed) return;
    this.isDisposed = true;
    activeIssueSessions.unregister(this.runId);

    if (this.sdkClient?.dispose) {
      try {
        await this.sdkClient.dispose();
      } catch (err) {
        console.warn(`[issue-stream] SDK dispose failed for run ${this.runId}:`, err);
      }
    }
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  /**
   * Write one event to issue_run_events and publish it on the event bus.
   *
   * Returns the sequence number assigned to this event so callers (e.g.,
   * the steer endpoint) can echo it back to the HTTP client.
   *
   * DB failures are non-fatal: we log a warning and still publish the event
   * so in-flight clients aren't silently stalled.
   */
  async emit(eventType: IssueRunEventType | string, payload: Record<string, unknown>): Promise<number> {
    const seq = ++this.seq;
    const enriched: Record<string, unknown> = { runId: this.runId, seq, ...payload };

    try {
      const db = getDb();
      await db.insert(issueRunEvents).values({
        runId: this.runId,
        seq,
        eventType,
        payload: enriched,
      });
    } catch (err) {
      console.warn(`[issue-stream] failed to persist event ${eventType} (seq ${seq}) for run ${this.runId}:`, err);
    }

    eventBus.emitIssueRunEvent(eventType as IssueRunEventType, this.projectId, enriched);

    return seq;
  }
}
