/**
 * @sabbour/squadboard-sdk — scribe/steps/step-8-health-report.ts
 *
 * Mirrors squad.agent.md Scribe task #8 (HEALTH REPORT) verbatim.
 *
 * Writes a health-report artifact to:
 *   .squad/health/{YYYY-MM-DD}/wave-{N}-{coordinator-session-id}.md
 *
 * Content sections (per spec):
 *   (a) Wave summary — N spawns / X done / Y in-flight / Z deferred
 *   (b) Backlog delta — before→after counts
 *   (c) Lineage tree — which spawn closed which todo
 *   (d) Defects observed — build breaks, missed scope, etc.
 *   (e) Verbatim quote of each spawn's plain-language summary
 *   (f) Next-wave recommendations — auto-derived from in_progress + blocked todos
 *
 * MIRROR CONTRACT: This file is a verbatim library-ification of squad.agent.md
 * task #8. If the spec changes, update squad.agent.md first, then sync here.
 */
export interface BacklogSnapshot {
    total: number;
    done: number;
    inProgress: number;
    blocked: number;
    pending: number;
}
export interface SpawnLineageEntry {
    spawnName: string;
    todosClosed: string[];
}
export interface SpawnSummary {
    name: string;
    plainLanguageSummary: string;
    commitSha?: string;
}
export interface NextWaveTodo {
    id: string;
    title: string;
    status: 'in_progress' | 'blocked';
    blockedReason?: string;
}
export interface HealthReportOptions {
    /** Wave number (e.g. 20). Use 0 if unknown. */
    waveNumber: number;
    /** Coordinator session ID (e.g. "4fa34ed1"). Use "session-unknown" if unknown. */
    sessionId: string;
    /** Backlog counts before the wave ran. */
    backlogBefore: BacklogSnapshot;
    /** Backlog counts after the wave ran. */
    backlogAfter: BacklogSnapshot;
    /** Per-spawn summary entries. */
    spawnSummaries: SpawnSummary[];
    /** Which spawn closed which todos. */
    lineage?: SpawnLineageEntry[];
    /** Defects observed during the wave. */
    defects?: string[];
    /** Todos that remain in_progress or blocked (drives next-wave recommendations). */
    nextWaveTodos?: NextWaveTodo[];
    /** Root of the repo (defaults to `process.cwd()`). */
    teamRoot?: string;
    /** Override the date string (YYYY-MM-DD). Defaults to today in local time. */
    dateOverride?: string;
}
export interface HealthReportResult {
    /** Absolute path to the written artifact. */
    path: string;
    /** Markdown content that was written. */
    content: string;
}
/**
 * Write the HEALTH REPORT artifact to `.squad/health/{date}/wave-{N}-{session}.md`.
 * Returns the artifact path and rendered content.
 *
 * Mirrors squad.agent.md Scribe task #8 verbatim.
 */
export declare function writeHealthReport(opts: HealthReportOptions): Promise<HealthReportResult>;
//# sourceMappingURL=step-8-health-report.d.ts.map