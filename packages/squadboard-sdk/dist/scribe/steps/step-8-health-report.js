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
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function localDateString(override) {
    if (override)
        return override;
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}
function slugifyWave(waveNumber) {
    return waveNumber === 0 ? 'wave-unknown' : `wave-${waveNumber}`;
}
function renderBacklogDelta(before, after) {
    const delta = (field) => {
        const diff = after[field] - before[field];
        const sign = diff >= 0 ? '+' : '';
        return `${before[field]} → ${after[field]} (${sign}${diff})`;
    };
    return [
        `| Metric     | Before | After | Δ |`,
        `|------------|--------|-------|---|`,
        `| Total      | ${before.total} | ${after.total} | ${after.total - before.total >= 0 ? '+' : ''}${after.total - before.total} |`,
        `| Done       | ${before.done} | ${after.done} | ${after.done - before.done >= 0 ? '+' : ''}${after.done - before.done} |`,
        `| In Progress| ${before.inProgress} | ${after.inProgress} | ${after.inProgress - before.inProgress >= 0 ? '+' : ''}${after.inProgress - before.inProgress} |`,
        `| Blocked    | ${before.blocked} | ${after.blocked} | ${after.blocked - before.blocked >= 0 ? '+' : ''}${after.blocked - before.blocked} |`,
        `| Pending    | ${before.pending} | ${after.pending} | ${after.pending - before.pending >= 0 ? '+' : ''}${after.pending - before.pending} |`,
    ].join('\n');
}
// ---------------------------------------------------------------------------
// writeHealthReport — step 8 primitive
// ---------------------------------------------------------------------------
/**
 * Write the HEALTH REPORT artifact to `.squad/health/{date}/wave-{N}-{session}.md`.
 * Returns the artifact path and rendered content.
 *
 * Mirrors squad.agent.md Scribe task #8 verbatim.
 */
export async function writeHealthReport(opts) {
    const teamRoot = opts.teamRoot ?? process.cwd();
    const dateStr = localDateString(opts.dateOverride);
    const waveSlug = slugifyWave(opts.waveNumber);
    const sessionSlug = opts.sessionId || 'session-unknown';
    const dir = join(teamRoot, '.squad', 'health', dateStr);
    const filename = `${waveSlug}-${sessionSlug}.md`;
    const artifactPath = join(dir, filename);
    // (a) Wave summary
    const totalSpawns = opts.spawnSummaries.length;
    const doneCount = opts.backlogAfter.done - opts.backlogBefore.done;
    const inFlightCount = opts.backlogAfter.inProgress;
    const deferredCount = opts.backlogAfter.blocked;
    const waveSummarySection = [
        `## (a) Wave Summary`,
        ``,
        `- **Wave**: ${opts.waveNumber === 0 ? 'unknown' : opts.waveNumber}`,
        `- **Session**: \`${sessionSlug}\``,
        `- **Spawns**: ${totalSpawns}`,
        `- **Done (delta)**: +${Math.max(0, doneCount)}`,
        `- **In Flight**: ${inFlightCount}`,
        `- **Deferred/Blocked**: ${deferredCount}`,
    ].join('\n');
    // (b) Backlog delta
    const backlogDeltaSection = [
        `## (b) Backlog Delta`,
        ``,
        renderBacklogDelta(opts.backlogBefore, opts.backlogAfter),
    ].join('\n');
    // (c) Lineage tree
    const lineageEntries = opts.lineage ?? [];
    const lineageSection = [
        `## (c) Lineage Tree`,
        ``,
        lineageEntries.length === 0
            ? `_No lineage data provided._`
            : lineageEntries
                .map((e) => {
                const todos = e.todosClosed.length === 0
                    ? '  _none_'
                    : e.todosClosed.map((t) => `  - ${t}`).join('\n');
                return `**${e.spawnName}**\n${todos}`;
            })
                .join('\n\n'),
    ].join('\n');
    // (d) Defects observed
    const defects = opts.defects ?? [];
    const defectsSection = [
        `## (d) Defects Observed`,
        ``,
        defects.length === 0
            ? `_None reported._`
            : defects.map((d) => `- ${d}`).join('\n'),
    ].join('\n');
    // (e) Verbatim spawn summaries
    const summariesSection = [
        `## (e) Spawn Summaries (Verbatim)`,
        ``,
        opts.spawnSummaries.length === 0
            ? `_No spawns this wave._`
            : opts.spawnSummaries
                .map((s) => {
                const sha = s.commitSha ? ` (commit: \`${s.commitSha.slice(0, 8)}\`)` : '';
                return `### ${s.name}${sha}\n\n> ${s.plainLanguageSummary.replace(/\n/g, '\n> ')}`;
            })
                .join('\n\n'),
    ].join('\n');
    // (f) Next-wave recommendations
    const nextTodos = opts.nextWaveTodos ?? [];
    const nextWaveSection = [
        `## (f) Next-Wave Recommendations`,
        ``,
        `_Auto-derived from \`status='in_progress'\` and \`status='blocked'\` todos._`,
        ``,
        nextTodos.length === 0
            ? `_Board is clear — no carry-over items._`
            : nextTodos
                .map((t) => {
                const tag = t.status === 'blocked' ? '🔴 BLOCKED' : '🔄 IN PROGRESS';
                const reason = t.blockedReason ? ` — ${t.blockedReason}` : '';
                return `- [${tag}] **${t.id}**: ${t.title}${reason}`;
            })
                .join('\n'),
    ].join('\n');
    const content = [
        `# Health Report — ${waveSlug} / \`${sessionSlug}\``,
        ``,
        `> Generated: ${new Date().toISOString()}`,
        ``,
        waveSummarySection,
        ``,
        backlogDeltaSection,
        ``,
        lineageSection,
        ``,
        defectsSection,
        ``,
        summariesSection,
        ``,
        nextWaveSection,
        ``,
    ].join('\n');
    await mkdir(dir, { recursive: true });
    await writeFile(artifactPath, content, 'utf8');
    return { path: artifactPath, content };
}
//# sourceMappingURL=step-8-health-report.js.map