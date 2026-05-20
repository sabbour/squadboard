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

import { readFile, writeFile, readdir, unlink, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile as _execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';

const execFile = promisify(_execFile);

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function readUtf8(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return '';
  }
}

async function fileSize(path: string): Promise<number> {
  try {
    const s = await stat(path);
    return s.size;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single agent's participation record within a spawn manifest. */
export interface SpawnManifestEntry {
  /** Agent cast name (e.g. "kobayashi", "verbal"). */
  name: string;
  /** One-line summary of what the agent did. */
  summary: string;
  /** Optional commit SHA if the agent produced a commit. */
  commitSha?: string;
}

/** Describes all agents that participated in a single Scribe run/wave. */
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

/** Return value from {@link archiveDecisionsBySize}. */
export interface ArchiveResult {
  /** Byte size of decisions.md before archiving. */
  before: number;
  /** Byte size of decisions.md after archiving (or same as before if gate didn't fire). */
  after: number;
  /** Whether archiving actually ran. */
  fired: boolean;
}

// ---------------------------------------------------------------------------
// Primitive 1: archiveDecisionsBySize
// ---------------------------------------------------------------------------
// Mirrors squad.agent.md task #1 EXACTLY:
//   "If decisions.md >= 20480 bytes, archive entries older than 30 days NOW.
//    If >= 51200 bytes, archive entries older than 7 days."

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
export async function archiveDecisionsBySize(
  decisionsPath: string,
): Promise<ArchiveResult> {
  // squad.agent.md task #1 thresholds — immutable, mirror the spec.
  const SOFT_BYTES = 20_480; // 20 KB → archive entries older than 30 days
  const HARD_BYTES = 51_200; // 50 KB → archive entries older than 7 days

  const before = await fileSize(decisionsPath);
  if (before < SOFT_BYTES) {
    return { before, after: before, fired: false };
  }

  const content = await readUtf8(decisionsPath);
  if (!content.trim()) return { before, after: before, fired: false };

  // Determine the age cutoff from the spec.
  const now = Date.now();
  const cutoffDays = before >= HARD_BYTES ? 7 : 30;
  const cutoffMs = cutoffDays * 24 * 60 * 60 * 1000;
  const cutoff = now - cutoffMs;

  // Split on H2 section boundaries.
  const h2Regex = /^(?=## )/m;
  const parts = content.split(h2Regex);
  const header = parts[0]; // everything before first H2
  const sections = parts.slice(1);

  if (sections.length === 0) return { before, after: before, fired: false };

  const toArchive: string[] = [];
  const toKeep: string[] = [];

  // ISO 8601 date at the start of an H2 heading.
  const datePattern = /^## (\d{4}-\d{2}-\d{2}[T ][^\s:]+)/;

  for (const section of sections) {
    const m = section.match(datePattern);
    if (m) {
      const ts = Date.parse(m[1]);
      if (!isNaN(ts) && ts < cutoff) {
        toArchive.push(section);
        continue;
      }
    }
    toKeep.push(section);
  }

  if (toArchive.length === 0) return { before, after: before, fired: false };

  const archivePath = join(decisionsPath.replace(/[^\\/]+$/, ''), 'decisions-archive.md');
  const existingArchive = await readUtf8(archivePath);

  // Reconstruct decisions.md (header + kept sections).
  const newContent = header + toKeep.join('');
  await writeFile(decisionsPath, newContent, 'utf8');

  // Prepend archived sections after the archive H1.
  const archiveHeader = existingArchive.startsWith('# ')
    ? existingArchive
    : `# Decisions Archive\n\n`;
  const headEnd = archiveHeader.indexOf('\n\n') + 2;
  const archiveTop = archiveHeader.slice(0, headEnd);
  const archiveBody = archiveHeader.slice(headEnd);
  await writeFile(archivePath, archiveTop + toArchive.join('') + archiveBody, 'utf8');

  const after = await fileSize(decisionsPath);
  return { before, after, fired: true };
}

// ---------------------------------------------------------------------------
// Primitive 2: mergeInbox
// ---------------------------------------------------------------------------
// Mirrors squad.agent.md task #2:
//   "Merge .squad/decisions/inbox/ → decisions.md, delete inbox files. Deduplicate."

/**
 * Read all .md files in inboxDir, append them to decisionsPath (deduplicating
 * by normalized H2 heading), then delete the inbox files.
 *
 * Returns the count of inbox files merged.
 */
export async function mergeInbox(
  inboxDir: string,
  decisionsPath: string,
): Promise<number> {
  let files: string[];
  try {
    const entries = await readdir(inboxDir);
    files = entries.filter((f) => f.endsWith('.md')).map((f) => join(inboxDir, f));
  } catch {
    return 0;
  }

  if (files.length === 0) return 0;

  const existing = await readUtf8(decisionsPath);
  const existingHeadings = new Set(
    [...existing.matchAll(/^## (.+)$/gm)].map(([, h]) => h.trim().toLowerCase()),
  );

  const chunks: string[] = [];
  for (const f of files) {
    const content = await readUtf8(f);
    if (!content.trim()) {
      await unlink(f).catch(() => {});
      continue;
    }
    const firstHeading = content.match(/^## (.+)$/m);
    if (firstHeading && existingHeadings.has(firstHeading[1].trim().toLowerCase())) {
      await unlink(f).catch(() => {});
      continue;
    }
    chunks.push(content.trimEnd() + '\n');
    if (firstHeading) existingHeadings.add(firstHeading[1].trim().toLowerCase());
    await unlink(f).catch(() => {});
  }

  if (chunks.length > 0) {
    const separator = existing.endsWith('\n\n') ? '' : '\n\n';
    await writeFile(decisionsPath, existing + separator + chunks.join('\n\n'), 'utf8');
  }

  return files.length;
}

// ---------------------------------------------------------------------------
// Primitive 3: writeOrchestrationLogs
// ---------------------------------------------------------------------------
// Mirrors squad.agent.md task #3:
//   "Write .squad/orchestration-log/{timestamp}-{agent}.md per agent.
//    Use ISO 8601 UTC timestamp."

/**
 * Write one orchestration-log file per agent in the spawn manifest.
 * Files land at logsDir/{isoUtcTimestamp}-{agentName}.md.
 *
 * Returns the count of files written.
 */
export async function writeOrchestrationLogs(
  manifest: SpawnManifest,
  logsDir: string,
  datetime: string,
): Promise<number> {
  // squad.agent.md says "ISO 8601 UTC timestamp" — use the datetime as-is
  // (callers should pass UTC ISO string, e.g. from new Date().toISOString()).
  const ts = datetime.replace(/:/g, '-').replace(/\./g, '-');
  let count = 0;
  for (const agent of manifest.agents) {
    const filename = `${ts}-${agent.name}.md`;
    const path = join(logsDir, filename);
    const content = [
      `# Orchestration Log — ${agent.name}`,
      '',
      `**Run:** ${manifest.runId}`,
      `**Datetime:** ${datetime}`,
      `**Agent:** ${agent.name}`,
      agent.commitSha ? `**Commit:** ${agent.commitSha}` : '',
      '',
      '## Summary',
      '',
      agent.summary,
      '',
    ]
      .filter((l) => l !== undefined)
      .join('\n');
    await writeFile(path, content, 'utf8').catch(() => {});
    count++;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Primitive 4: writeSessionLog
// ---------------------------------------------------------------------------
// Mirrors squad.agent.md task #4:
//   "Write .squad/log/{timestamp}-{topic}.md. Brief. Use ISO 8601 UTC timestamp."

/**
 * Write a brief session-log file summarising the run.
 * File lands at logsDir/{isoUtcTimestamp}-{topic}.md.
 *
 * Returns the path written (or null on failure).
 */
export async function writeSessionLog(
  manifest: SpawnManifest,
  logsDir: string,
  datetime: string,
): Promise<string | null> {
  const ts = datetime.replace(/:/g, '-').replace(/\./g, '-');
  const topic = (manifest.topic ?? manifest.runId).toLowerCase().replace(/\s+/g, '-').slice(0, 40);
  const filename = `${ts}-${topic}.md`;
  const path = join(logsDir, filename);

  const agentLines = manifest.agents
    .map((a) => `- **${a.name}**: ${a.summary}${a.commitSha ? ` (${a.commitSha})` : ''}`)
    .join('\n');

  const content = [
    `# Session Log — ${manifest.topic ?? manifest.runId}`,
    '',
    `**Run:** ${manifest.runId}`,
    `**Datetime:** ${datetime}`,
    '',
    '## Agents',
    '',
    agentLines,
    '',
  ].join('\n');

  try {
    await writeFile(path, content, 'utf8');
    return path;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Primitive 5: crossAgentHistoryUpdates
// ---------------------------------------------------------------------------
// Mirrors squad.agent.md task #5:
//   "Append team updates to affected agents' history.md."

/**
 * Append a "team update" block to the history.md of each agent mentioned in
 * the spawn manifest (peers — not the agent being updated).
 *
 * Returns the list of agent names whose history.md was updated.
 */
export async function crossAgentHistoryUpdates(
  manifest: SpawnManifest,
  agentsDir: string,
): Promise<string[]> {
  const updated: string[] = [];

  for (const target of manifest.agents) {
    const historyPath = join(agentsDir, target.name, 'history.md');
    if (!existsSync(historyPath)) continue;

    const peers = manifest.agents.filter((a) => a.name !== target.name);
    if (peers.length === 0) continue;

    const peerLines = peers.map((p) => `- **${p.name}**: ${p.summary}`).join('\n');

    const block = [
      '',
      `## Team Update — ${manifest.datetime}`,
      '',
      `Run: ${manifest.runId}`,
      '',
      peerLines,
      '',
    ].join('\n');

    const existing = await readUtf8(historyPath);
    await writeFile(historyPath, existing + block, 'utf8').catch(() => {});
    updated.push(target.name);
  }

  return updated;
}

// ---------------------------------------------------------------------------
// Primitive 6: summarizeHistoryIfLarge
// ---------------------------------------------------------------------------
// Mirrors squad.agent.md task #6:
//   "If any history.md >= 15360 bytes (15KB), summarize now."

/**
 * If a history.md file is >= 15360 bytes (15KB), compact the "## Learnings"
 * section by moving older lines to history-archive.md.
 *
 * Threshold: 15360 bytes — exactly as specified in squad.agent.md task #6.
 * Compaction keeps the most recent 80 lines of the Learnings section.
 *
 * Returns true if compaction ran, false otherwise.
 */
export async function summarizeHistoryIfLarge(
  historyPath: string,
): Promise<boolean> {
  // squad.agent.md task #6 threshold — immutable mirror of spec.
  const THRESHOLD_BYTES = 15_360; // 15 KB

  const size = await fileSize(historyPath);
  if (size < THRESHOLD_BYTES) return false;

  const content = await readUtf8(historyPath);
  const learningsIdx = content.indexOf('\n## Learnings');
  if (learningsIdx === -1) return false;

  const beforeLearnings = content.slice(0, learningsIdx + 1);
  const learningsAndRest = content.slice(learningsIdx + 1);

  const nextH2 = learningsAndRest.indexOf('\n## ', 14);
  const learningsBody =
    nextH2 === -1 ? learningsAndRest : learningsAndRest.slice(0, nextH2);
  const afterLearnings = nextH2 === -1 ? '' : learningsAndRest.slice(nextH2);

  const lines = learningsBody.split('\n');
  const KEEP_LINES = 80;
  if (lines.length <= KEEP_LINES) return false;

  const toArchive = lines.slice(0, lines.length - KEEP_LINES).join('\n');
  const toKeep = lines.slice(lines.length - KEEP_LINES).join('\n');

  const archivePath = historyPath.replace(/history\.md$/, 'history-archive.md');
  const existingArchive = await readUtf8(archivePath);
  const newArchive = existingArchive
    ? existingArchive.trimEnd() + '\n\n' + toArchive
    : `# History Archive\n\n` + toArchive;

  await writeFile(archivePath, newArchive, 'utf8');
  await writeFile(historyPath, beforeLearnings + toKeep + afterLearnings, 'utf8');

  return true;
}

// ---------------------------------------------------------------------------
// Primitive 7: commitScribeFiles
// ---------------------------------------------------------------------------
// Mirrors squad.agent.md task #7:
//   "Stage only the exact .squad/ files Scribe wrote in this session.
//    Stage each file individually with `git add -- <path>`.
//    Commit with -F (write msg to temp file). Skip if nothing staged.
//    ⚠️ NEVER use `git add .squad/` or broad globs."

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
export async function commitScribeFiles(
  allowedPaths: string[],
  message: string,
  repoRoot: string,
): Promise<string | null> {
  const existing = allowedPaths.filter((p) => existsSync(p));
  if (existing.length === 0) return null;

  // Stage each file individually — never `git add .squad/`.
  for (const p of existing) {
    try {
      await execFile('git', ['-C', repoRoot, 'add', '--', p]);
    } catch {
      // Non-fatal — continue staging other files.
    }
  }

  // Check if anything is actually staged.
  let staged: string;
  try {
    const { stdout } = await execFile('git', ['-C', repoRoot, 'diff', '--cached', '--name-only']);
    staged = stdout.trim();
  } catch {
    return null;
  }
  if (!staged) return null;

  // Write commit message to a file to avoid shell-escaping issues (-F flag).
  const msgPath = join(repoRoot, '.squad', '.scribe-commit-msg.tmp');
  await writeFile(msgPath, message, 'utf8');

  try {
    await execFile('git', ['-C', repoRoot, 'commit', '-F', msgPath]);
    const { stdout: sha } = await execFile('git', ['-C', repoRoot, 'rev-parse', 'HEAD']);
    return sha.trim();
  } catch {
    return null;
  } finally {
    await unlink(msgPath).catch(() => {});
  }
}

