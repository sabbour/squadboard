/**
 * @sabbour/squadboard-sdk — scribe/primitives.ts
 *
 * Independently-testable primitives that implement the mechanical close-out
 * tasks described in the Scribe spawn template (tasks 0-8 in squad.agent.md).
 * Each primitive is a named export so future agents (Auditor, etc.) can compose
 * them independently without importing the full closeOut() orchestrator.
 *
 * Archive-gate fix (Wave 14, q8):
 *   The original task #1 in squad.agent.md archived to a DATE window (entries
 *   older than 7d / 30d) which left decisions.md at 74.7KB — still oversized
 *   because many recent entries already exceeded the soft/hard thresholds.
 *   archiveDecisionsBySize() now walks entries from OLDEST to NEWEST and moves
 *   them to decisions-archive.md until the file size is ≤ targetBytes. This
 *   guarantees the file is never left oversized regardless of how recent the
 *   bulk of its content is.
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
 * Archive entries from decisions.md into decisions-archive.md until the file
 * is ≤ targetBytes.
 *
 * Strategy: walk H2 sections (## …) from OLDEST to NEWEST. Move the oldest
 * sections first until the remaining file is within the target size. This
 * guarantees the file cannot stay oversized, even if all content is recent.
 *
 * The old date-window approach (archive entries older than 7d / 30d) was
 * replaced here because it left the file at 74.7KB (Scribe-4, Wave 13) —
 * the bulk of the content was "recent" but the file was already oversized.
 *
 * @param decisionsPath  Absolute path to decisions.md
 * @param opts
 *   softBytes  — lower threshold that triggers archiving (default 20480 = 20KB)
 *   hardBytes  — upper threshold that triggers more aggressive archiving (default 52224 = 51KB)
 *   targetBytes — target size after archiving (default 30720 = 30KB)
 */
export declare function archiveDecisionsBySize(decisionsPath: string, opts?: {
    softBytes?: number;
    hardBytes?: number;
    targetBytes?: number;
}): Promise<ArchiveResult>;
/**
 * Read all .md files in inboxDir, append them to decisionsPath (deduplicating
 * by normalized heading), then delete the inbox files.
 *
 * Returns the count of inbox files merged.
 */
export declare function mergeInbox(inboxDir: string, decisionsPath: string): Promise<number>;
/**
 * Write one orchestration-log file per agent in the spawn manifest.
 * Files land at logsDir/{datetime}-{agentName}.md.
 *
 * Returns the count of files written.
 */
export declare function writeOrchestrationLogs(manifest: SpawnManifest, logsDir: string, datetime: string): Promise<number>;
/**
 * Write a brief session-log file summarising the run.
 * File lands at logsDir/{datetime}-{topic}.md.
 *
 * Returns the path written (or null on failure).
 */
export declare function writeSessionLog(manifest: SpawnManifest, logsDir: string, datetime: string): Promise<string | null>;
/**
 * Append a "team update" block to the history.md of each agent mentioned in
 * the spawn manifest (other than the agent whose history.md is being updated).
 *
 * Returns the list of agent names whose history.md was updated.
 */
export declare function crossAgentHistoryUpdates(manifest: SpawnManifest, agentsDir: string): Promise<string[]>;
/**
 * If a history.md file exceeds thresholdBytes, compact the "## Learnings"
 * section by moving older entries to history-archive.md.
 *
 * This is a soft compaction: it preserves the most recent N lines of the
 * Learnings section and archives the rest. Uses a fixed window of 80 lines
 * as "recent enough to keep".
 *
 * Returns true if compaction ran, false otherwise.
 */
export declare function summarizeHistoryIfLarge(historyPath: string, thresholdBytes?: number): Promise<boolean>;
/**
 * Stage each path individually with `git add -- <path>` and commit using a
 * temporary message file (to avoid shell-escaping bugs with `git commit -m`).
 *
 * Only stages paths that exist and sit within the given repoRoot.
 * NEVER stages with broad globs like `git add .squad/`.
 *
 * Returns the commit SHA on success, null if nothing was staged or commit failed.
 */
export declare function commitScribeFiles(allowedPaths: string[], message: string, repoRoot: string): Promise<string | null>;
//# sourceMappingURL=primitives.d.ts.map