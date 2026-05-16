/**
 * @sabbour/squadboard-sdk — scribe/close-out.ts
 *
 * `closeOut()` is the library-ified version of the Scribe spawn template's
 * mechanical tasks 0-8 (defined in .github/agents/squad.agent.md under
 * "SPAWN MANIFEST"). It is a VERBATIM mirror of that spec — not a
 * reimagination. If the algorithm needs to change, squad.agent.md is updated
 * FIRST, then this file is synced to match. This is the "one algorithm,
 * multiple callers" principle.
 *
 * It is the single convergence point for all three caller
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

import { execFile as _execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';

import {
  archiveDecisionsBySize,
  mergeInbox,
  writeOrchestrationLogs,
  writeSessionLog,
  crossAgentHistoryUpdates,
  summarizeHistoryIfLarge,
  commitScribeFiles,
  type SpawnManifest,
} from './primitives.js';
import {
  writeHealthReport,
  type HealthReportOptions,
} from './steps/step-8-health-report.js';

export type { SpawnManifest, SpawnManifestEntry } from './primitives.js';
export type {
  HealthReportOptions,
  HealthReportResult,
  BacklogSnapshot,
  SpawnLineageEntry,
  SpawnSummary,
  NextWaveTodo,
} from './steps/step-8-health-report.js';

const execFile = promisify(_execFile);

// ---------------------------------------------------------------------------
// Public contract
// ---------------------------------------------------------------------------

export interface CloseOutOptions {
  /** Which project (defaults to SQUADBOARD_DEFAULT_PROJECT_ID env var). */
  projectId?: string;
  /** Agents that ran this wave — used for orchestration logs + cross-agent updates. */
  spawnManifest?: SpawnManifest;
  /** Path to the repository root (defaults to `git rev-parse --show-toplevel`). */
  teamRoot?: string;
  /** Optional override for the Scribe git commit message. */
  commitMessage?: string;
  /**
   * Whether to push after commit.
   * Default: false. The daemon (q7) sets this to true when a remote is
   * configured; the CLI coordinator and the manual button leave it false.
   */
  push?: boolean;
  /**
   * Options for the step-8 HEALTH REPORT artifact.
   * If omitted, step 8 is skipped (healthReportPath will be null).
   */
  healthReport?: Omit<HealthReportOptions, 'teamRoot'>;
}

export interface CloseOutResult {
  /** Whether the decisions.md size-archive gate fired. */
  decisionsArchived: boolean;
  /** Byte sizes of decisions.md before and after the run. */
  decisionsSize: { before: number; after: number };
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
  /** Path to the HEALTH REPORT artifact written in step 8 (null if healthReport opts were not provided). */
  healthReportPath: string | null;
  /** Any non-fatal errors collected during the run. */
  errors: Array<{ step: string; error: string }>;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function resolveTeamRoot(override?: string): Promise<string> {
  if (override) return override;
  try {
    const { stdout } = await execFile('git', ['rev-parse', '--show-toplevel']);
    return stdout.trim();
  } catch {
    return process.cwd();
  }
}

function toError(step: string, err: unknown): { step: string; error: string } {
  return { step, error: err instanceof Error ? err.message : String(err) };
}

// ---------------------------------------------------------------------------
// closeOut — the convergence function
// ---------------------------------------------------------------------------

export async function closeOut(opts: CloseOutOptions = {}): Promise<CloseOutResult> {
  const teamRoot = await resolveTeamRoot(opts.teamRoot);
  const squadDir = join(teamRoot, '.squad');
  const decisionsPath = join(squadDir, 'decisions.md');
  const inboxDir = join(squadDir, 'decisions', 'inbox');
  const agentsDir = join(squadDir, 'agents');
  const logsDir = join(squadDir, 'log');
  const orchDir = join(squadDir, 'orchestration-log');
  const datetime = new Date().toISOString();

  // Ensure log directories exist.
  await mkdir(logsDir, { recursive: true }).catch(() => {});
  await mkdir(orchDir, { recursive: true }).catch(() => {});

  const result: CloseOutResult = {
    decisionsArchived: false,
    decisionsSize: { before: 0, after: 0 },
    inboxFilesMerged: 0,
    orchestrationLogsWritten: 0,
    sessionLogPath: null,
    historiesUpdated: [],
    historiesSummarized: [],
    commitSha: null,
    pushed: false,
    healthReportPath: null,
    errors: [],
  };

  // Track paths written so we can commit them.
  const writtenPaths: string[] = [];

  // --- Step 0 + 1: Measure + archive decisions.md by size ---
  try {
    const archiveResult = await archiveDecisionsBySize(decisionsPath);
    result.decisionsSize = { before: archiveResult.before, after: archiveResult.after };
    result.decisionsArchived = archiveResult.fired;
    if (archiveResult.fired) {
      writtenPaths.push(decisionsPath);
      writtenPaths.push(join(squadDir, 'decisions-archive.md'));
    }
  } catch (err) {
    result.errors.push(toError('archive-decisions', err));
    result.decisionsSize = { before: 0, after: 0 };
  }

  // --- Step 2: Merge inbox ---
  try {
    const merged = await mergeInbox(inboxDir, decisionsPath);
    result.inboxFilesMerged = merged;
    if (merged > 0 && !writtenPaths.includes(decisionsPath)) {
      writtenPaths.push(decisionsPath);
    }
  } catch (err) {
    result.errors.push(toError('merge-inbox', err));
  }

  // --- Steps 3 + 4: Orchestration + session logs ---
  if (opts.spawnManifest) {
    try {
      const count = await writeOrchestrationLogs(opts.spawnManifest, orchDir, datetime);
      result.orchestrationLogsWritten = count;
      // Mark the whole orch dir as a written path (individual files vary).
      writtenPaths.push(orchDir);
    } catch (err) {
      result.errors.push(toError('orchestration-logs', err));
    }

    try {
      const logPath = await writeSessionLog(opts.spawnManifest, logsDir, datetime);
      result.sessionLogPath = logPath;
      if (logPath) writtenPaths.push(logPath);
    } catch (err) {
      result.errors.push(toError('session-log', err));
    }

    // --- Step 5: Cross-agent history updates ---
    try {
      const updated = await crossAgentHistoryUpdates(opts.spawnManifest, agentsDir);
      result.historiesUpdated = updated;
      for (const name of updated) {
        writtenPaths.push(join(agentsDir, name, 'history.md'));
      }
    } catch (err) {
      result.errors.push(toError('cross-agent-history', err));
    }
  }

  // --- Step 6: History summarization ---
  try {
    const allAgentDirs = opts.spawnManifest?.agents.map((a) => a.name) ?? [];
    for (const name of allAgentDirs) {
      const historyPath = join(agentsDir, name, 'history.md');
      try {
        const summarized = await summarizeHistoryIfLarge(historyPath);
        if (summarized) {
          result.historiesSummarized.push(name);
          if (!writtenPaths.includes(historyPath)) writtenPaths.push(historyPath);
          writtenPaths.push(join(agentsDir, name, 'history-archive.md'));
        }
      } catch {
        // Non-fatal per agent.
      }
    }
  } catch (err) {
    result.errors.push(toError('history-summarization', err));
  }

  // --- Step 7: Git commit ---
  try {
    const manifest = opts.spawnManifest;
    const message =
      opts.commitMessage ??
      [
        `chore(scribe): close-out ${manifest?.runId ?? 'wave'}`,
        '',
        manifest
          ? manifest.agents.map((a) => `- ${a.name}: ${a.summary}`).join('\n')
          : '',
        '',
        `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`,
      ]
        .join('\n')
        .trim();

    const sha = await commitScribeFiles(writtenPaths, message, teamRoot);
    result.commitSha = sha;
  } catch (err) {
    result.errors.push(toError('git-commit', err));
  }

  // --- Step 8 (optional): Push ---
  if (opts.push && result.commitSha) {
    try {
      await execFile('git', ['-C', teamRoot, 'push']);
      result.pushed = true;
    } catch (err) {
      result.errors.push(toError('git-push', err));
    }
  }

  // --- Step 8: HEALTH REPORT artifact ---
  // Mirrors squad.agent.md Scribe task #8.
  // Written AFTER commit so the commit SHA is available to include in the report.
  if (opts.healthReport) {
    try {
      const hrResult = await writeHealthReport({
        ...opts.healthReport,
        teamRoot,
      });
      result.healthReportPath = hrResult.path;
    } catch (err) {
      result.errors.push(toError('health-report', err));
    }
  }

  return result;
}
