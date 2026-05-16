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
import { execFile as _execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { archiveDecisionsBySize, mergeInbox, writeOrchestrationLogs, writeSessionLog, crossAgentHistoryUpdates, summarizeHistoryIfLarge, commitScribeFiles, } from './primitives.js';
const execFile = promisify(_execFile);
// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------
async function resolveTeamRoot(override) {
    if (override)
        return override;
    try {
        const { stdout } = await execFile('git', ['rev-parse', '--show-toplevel']);
        return stdout.trim();
    }
    catch {
        return process.cwd();
    }
}
function toError(step, err) {
    return { step, error: err instanceof Error ? err.message : String(err) };
}
// ---------------------------------------------------------------------------
// closeOut — the convergence function
// ---------------------------------------------------------------------------
export async function closeOut(opts = {}) {
    const teamRoot = await resolveTeamRoot(opts.teamRoot);
    const squadDir = join(teamRoot, '.squad');
    const decisionsPath = join(squadDir, 'decisions.md');
    const inboxDir = join(squadDir, 'decisions', 'inbox');
    const agentsDir = join(squadDir, 'agents');
    const logsDir = join(squadDir, 'log');
    const orchDir = join(squadDir, 'orchestration-log');
    const datetime = new Date().toISOString();
    // Ensure log directories exist.
    await mkdir(logsDir, { recursive: true }).catch(() => { });
    await mkdir(orchDir, { recursive: true }).catch(() => { });
    const result = {
        decisionsArchived: false,
        decisionsSize: { before: 0, after: 0 },
        inboxFilesMerged: 0,
        orchestrationLogsWritten: 0,
        sessionLogPath: null,
        historiesUpdated: [],
        historiesSummarized: [],
        commitSha: null,
        pushed: false,
        errors: [],
    };
    // Track paths written so we can commit them.
    const writtenPaths = [];
    // --- Step 0 + 1: Measure + archive decisions.md by size ---
    try {
        const archiveResult = await archiveDecisionsBySize(decisionsPath, {
            softBytes: opts.archiveThresholdBytes?.soft,
            hardBytes: opts.archiveThresholdBytes?.hard,
            targetBytes: opts.archiveThresholdBytes?.target,
        });
        result.decisionsSize = { before: archiveResult.before, after: archiveResult.after };
        result.decisionsArchived = archiveResult.fired;
        if (archiveResult.fired) {
            writtenPaths.push(decisionsPath);
            writtenPaths.push(join(squadDir, 'decisions-archive.md'));
        }
    }
    catch (err) {
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
    }
    catch (err) {
        result.errors.push(toError('merge-inbox', err));
    }
    // --- Steps 3 + 4: Orchestration + session logs ---
    if (opts.spawnManifest) {
        try {
            const count = await writeOrchestrationLogs(opts.spawnManifest, orchDir, datetime);
            result.orchestrationLogsWritten = count;
            // Mark the whole orch dir as a written path (individual files vary).
            writtenPaths.push(orchDir);
        }
        catch (err) {
            result.errors.push(toError('orchestration-logs', err));
        }
        try {
            const logPath = await writeSessionLog(opts.spawnManifest, logsDir, datetime);
            result.sessionLogPath = logPath;
            if (logPath)
                writtenPaths.push(logPath);
        }
        catch (err) {
            result.errors.push(toError('session-log', err));
        }
        // --- Step 5: Cross-agent history updates ---
        try {
            const updated = await crossAgentHistoryUpdates(opts.spawnManifest, agentsDir);
            result.historiesUpdated = updated;
            for (const name of updated) {
                writtenPaths.push(join(agentsDir, name, 'history.md'));
            }
        }
        catch (err) {
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
                    if (!writtenPaths.includes(historyPath))
                        writtenPaths.push(historyPath);
                    writtenPaths.push(join(agentsDir, name, 'history-archive.md'));
                }
            }
            catch {
                // Non-fatal per agent.
            }
        }
    }
    catch (err) {
        result.errors.push(toError('history-summarization', err));
    }
    // --- Step 7: Git commit ---
    try {
        const manifest = opts.spawnManifest;
        const message = opts.commitMessage ??
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
    }
    catch (err) {
        result.errors.push(toError('git-commit', err));
    }
    // --- Step 8 (optional): Push ---
    if (opts.push && result.commitSha) {
        try {
            await execFile('git', ['-C', teamRoot, 'push']);
            result.pushed = true;
        }
        catch (err) {
            result.errors.push(toError('git-push', err));
        }
    }
    return result;
}
//# sourceMappingURL=close-out.js.map