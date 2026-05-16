/**
 * @sabbour/squadboard-sdk — scribe/close-out.ts
 *
 * `closeOut()` is the library-ified version of the Scribe spawn template's
 * mechanical tasks 0-8 (defined in .github/agents/squad.agent.md under
 * "SPAWN MANIFEST"). It is the single convergence point for all three caller
 * paths that need to trigger a Scribe close-out:
 *
 *   1. CLI coordinator (squad.agent.md prompt) — existing behaviour; will
 *      migrate to this SDK call in a future wave once the daemon proves the
 *      contract. Until then, the spawn template continues to run as-is.
 *
 *   2. Standalone autonomous daemon (q7, built by Verbal) — calls closeOut()
 *      on a cron/event cadence. Sets push: true when a remote is configured.
 *
 *   3. Manual "End Wave" button on the project page (q9, Wave 15) — calls
 *      closeOut() on demand, bypassing the daemon schedule.
 *
 * Pluggability: each step below delegates to a named primitive (exported
 * from ./primitives.ts) so Auditor, future ceremonies, or tests can compose
 * them without importing this orchestrator.
 *
 * Ceremony registration: this function backs the 'scribe-close-out' entry in
 * the ceremony registry (packages/server/src/services/ceremony-translator.ts).
 */
import { type SpawnManifest } from './primitives.js';
export type { SpawnManifest, SpawnManifestEntry } from './primitives.js';
export interface CloseOutOptions {
    /** Which project (defaults to SQUADBOARD_DEFAULT_PROJECT_ID env var). */
    projectId?: string;
    /** Agents that ran this wave — used for orchestration logs + cross-agent updates. */
    spawnManifest?: SpawnManifest;
    /** Path to the repository root (defaults to `git rev-parse --show-toplevel`). */
    teamRoot?: string;
    /** Override Scribe's decisions.md size gate thresholds. */
    archiveThresholdBytes?: {
        /** Trigger archiving at this size (default: 20KB). */
        soft?: number;
        /** Trigger aggressive archiving at this size (default: 51KB). */
        hard?: number;
        /** Target file size after archiving (default: 30KB). */
        target?: number;
    };
    /** Optional override for the Scribe git commit message. */
    commitMessage?: string;
    /**
     * Whether to push after commit.
     * Default: false. The daemon (q7) sets this to true when a remote is
     * configured; the CLI coordinator and the manual button leave it false.
     */
    push?: boolean;
}
export interface CloseOutResult {
    /** Whether the decisions.md size-archive gate fired. */
    decisionsArchived: boolean;
    /** Byte sizes of decisions.md before and after the run. */
    decisionsSize: {
        before: number;
        after: number;
    };
    /** Number of inbox/*.md files merged into decisions.md. */
    inboxFilesMerged: number;
    /** Number of orchestration-log files written. */
    orchestrationLogsWritten: number;
    /** Path to the session log file written (null if no spawnManifest). */
    sessionLogPath: string | null;
    /** Agent names whose history.md received cross-agent updates. */
    historiesUpdated: string[];
    /** Agent names whose history.md hit 15KB+ and was compacted. */
    historiesSummarized: string[];
    /** SHA of the Scribe git commit (null if nothing was staged). */
    commitSha: string | null;
    /** Whether a `git push` was attempted and succeeded. */
    pushed: boolean;
    /** Any non-fatal errors collected during the run. */
    errors: Array<{
        step: string;
        error: string;
    }>;
}
export declare function closeOut(opts?: CloseOutOptions): Promise<CloseOutResult>;
//# sourceMappingURL=close-out.d.ts.map