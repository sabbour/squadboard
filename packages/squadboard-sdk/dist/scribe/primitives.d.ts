/**
 * @sabbour/squadboard-sdk — scribe/primitives.ts
 *
 * Independently-testable primitives that implement the mechanical close-out
 * tasks described in the Scribe spawn template (tasks 0-8 in squad.agent.md).
 * Each primitive is a named export so future agents (Auditor, etc.) can compose
 * them independently without importing the full closeOut() orchestrator.
 *
 * ⚠️  MIRROR CONTRACT (Wave 14, q8 course-correction):
 *   This file is a VERBATIM library-ification of squad.agent.md tasks 0-8 as of
 *   2026-05-15. The SDK MUST NOT diverge from the source spec. If the algorithm
 *   is wrong, the fix goes into squad.agent.md FIRST, then this file is synced.
 *   "One algorithm, multiple callers" — Scribe stays one agent with one spec.
 *
 * SYNC VERIFICATION RECIPE:
 *   1. Open .github/agents/squad.agent.md, search "SPAWN MANIFEST".
 *   2. For each task 0-8, locate the corresponding primitive below.
 *   3. Confirm thresholds, logic, and paths match the spec exactly.
 *   4. Any divergence is a bug in this file, not in squad.agent.md.
 *
 * KNOWN FOLLOW-UP (do NOT fix here):
 *   The Wave 13 Scribe-4 run left decisions.md at 74.7KB after running task #1.
 *   This is because the date-window approach (archive entries older than 7d) does
 *   not guarantee the file shrinks when all content is recent. The correct fix is
 *   to update squad.agent.md task #1 (e.g., add a targetBytes guarantee), then
 *   sync this primitive. Filed as a follow-up against squad.agent.md, not here.
 */
export interface SpawnManifestEntry {
    /** Agent cast name (e.g. "kobayashi", "verbal"). */
    name: string;
    /** One-line summary of what the agent did. */
    summary: string;
    /** Optional commit SHA if the agent produced a commit. */
    commitSha?: string;
}
export interface SpawnManifest {
    /** Wave or run identifier (e.g. "wave-14", "q8-scribe-as-ceremony"). */
    runId: string;
    /** ISO 8601 datetime of the run. */
    datetime: string;
    /** Agents that participated. */
    agents: SpawnManifestEntry[];
    /** Short human-readable topic (used as the session-log filename suffix). */
    topic?: string;
}
export interface ArchiveResult {
    /** Byte size of decisions.md before archiving. */
    before: number;
    /** Byte size of decisions.md after archiving (or same as before if gate didn't fire). */
    after: number;
    /** Whether archiving actually ran. */
    fired: boolean;
}
/**
 * Archive dated H2 sections from decisions.md into decisions-archive.md
 * based on the age thresholds in squad.agent.md task #1:
 *   - size >= 20480 bytes (20KB) → archive entries older than 30 days
 *   - size >= 51200 bytes (50KB) → archive entries older than 7 days
 *
 * Sections are matched by extracting an ISO 8601 date from the start of each
 * H2 heading (e.g. "## 2026-05-15T19:46:00-07:00: Some title").
 * Sections with no parseable date are never archived.
 *
 * ⚠️  Do NOT add a targetBytes parameter. The thresholds are part of the
 *     algorithm defined in squad.agent.md. Override the spec there, not here.
 */
export declare function archiveDecisionsBySize(decisionsPath: string): Promise<ArchiveResult>;
/**
 * Read all .md files in inboxDir, append them to decisionsPath (deduplicating
 * by normalized H2 heading), then delete the inbox files.
 *
 * Returns the count of inbox files merged.
 */
export declare function mergeInbox(inboxDir: string, decisionsPath: string): Promise<number>;
/**
 * Write one orchestration-log file per agent in the spawn manifest.
 * Files land at logsDir/{isoUtcTimestamp}-{agentName}.md.
 *
 * Returns the count of files written.
 */
export declare function writeOrchestrationLogs(manifest: SpawnManifest, logsDir: string, datetime: string): Promise<number>;
/**
 * Write a brief session-log file summarising the run.
 * File lands at logsDir/{isoUtcTimestamp}-{topic}.md.
 *
 * Returns the path written (or null on failure).
 */
export declare function writeSessionLog(manifest: SpawnManifest, logsDir: string, datetime: string): Promise<string | null>;
/**
 * Append a "team update" block to the history.md of each agent mentioned in
 * the spawn manifest (peers — not the agent being updated).
 *
 * Returns the list of agent names whose history.md was updated.
 */
export declare function crossAgentHistoryUpdates(manifest: SpawnManifest, agentsDir: string): Promise<string[]>;
/**
 * If a history.md file is >= 15360 bytes (15KB), compact the "## Learnings"
 * section by moving older lines to history-archive.md.
 *
 * Threshold: 15360 bytes — exactly as specified in squad.agent.md task #6.
 * Compaction keeps the most recent 80 lines of the Learnings section.
 *
 * Returns true if compaction ran, false otherwise.
 */
export declare function summarizeHistoryIfLarge(historyPath: string): Promise<boolean>;
/**
 * Stage each allowed path individually with `git add -- <path>` and commit
 * using a message file (avoids shell-escaping bugs with -m).
 *
 * Allowed paths: decisions.md, decisions-archive.md, agents/{name}/history.md,
 * agents/{name}/history-archive.md, log/*, orchestration-log/* — callers
 * pass only paths within this set.
 *
 * Returns the commit SHA on success, null if nothing was staged or commit failed.
 */
export declare function commitScribeFiles(allowedPaths: string[], message: string, repoRoot: string): Promise<string | null>;
//# sourceMappingURL=primitives.d.ts.map