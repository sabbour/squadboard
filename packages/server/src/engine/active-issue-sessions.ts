/**
 * active-issue-sessions.ts — Wave 28 JIS-T5
 *
 * In-memory registry of running issue sessions keyed by run_id.
 * Single-process (no Redis); safe for the current monolith deployment model.
 *
 * The RunningIssueSession *interface* is defined here so T5 (registry) and T6
 * (events endpoint) can import it without depending on the T2 class.
 * T2 (issue-stream.ts) will implement the class against this interface.
 */

// ---------------------------------------------------------------------------
// Interface contract for JIS-T2 implementors
// ---------------------------------------------------------------------------

/**
 * Minimal interface that the active-session registry requires from any
 * RunningIssueSession implementation.
 *
 * JIS-T2 will implement a class that satisfies this interface and adds
 * SDK event listeners, event bus publishing, and DB persistence.
 */
export interface RunningIssueSession {
  /** The UUID of the issue_run this session is tracking. */
  getRunId(): string;

  /** The UUID of the project this run belongs to (for event-bus scoping). */
  getProjectId(): string;

  /**
   * Injects a steering message into the running SDK session.
   * Returns a promise that resolves when the injection is queued.
   * Implementations should throw if the session is no longer active.
   */
  steer(message: string, actor?: string): Promise<void>;

  /**
   * Gracefully tears down the session (closes SDK connection, flushes buffers).
   * Called by the registry cleanup and by the run finaliser.
   */
  dispose(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const _sessions = new Map<string, RunningIssueSession>();

/**
 * Register a session for a run.
 * Overwrites any existing entry (run restart semantics — dispose old session
 * before re-registering to avoid leaks).
 */
export function register(runId: string, session: RunningIssueSession): void {
  _sessions.set(runId, session);
}

/** Look up the active session for a run_id. Returns undefined if not found. */
export function get(runId: string): RunningIssueSession | undefined {
  return _sessions.get(runId);
}

/** Remove the session from the registry (call after dispose()). */
export function unregister(runId: string): void {
  _sessions.delete(runId);
}

/**
 * List all active sessions.
 * Returns a snapshot array so callers can iterate safely even if the map
 * is mutated during iteration (e.g., by a concurrent unregister()).
 */
export function list(): Array<{ runId: string; session: RunningIssueSession }> {
  return Array.from(_sessions.entries()).map(([runId, session]) => ({ runId, session }));
}
