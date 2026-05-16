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

import { readFile, writeFile, readdir, unlink, stat } from 'node:fs/promises';
import { join, basename } from 'node:path';
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

// ---------------------------------------------------------------------------
// Primitive 1: archiveDecisionsBySize
// ---------------------------------------------------------------------------

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
export async function archiveDecisionsBySize(
  decisionsPath: string,
  opts: {
    softBytes?: number;
    hardBytes?: number;
    targetBytes?: number;
  } = {},
): Promise<ArchiveResult> {
  const softBytes = opts.softBytes ?? 20_480;   // 20 KB
  const hardBytes = opts.hardBytes ?? 52_224;   // 51 KB
  const targetBytes = opts.targetBytes ?? 30_720; // 30 KB

  const before = await fileSize(decisionsPath);
  if (before < softBytes) {
    return { before, after: before, fired: false };
  }

  const content = await readUtf8(decisionsPath);
  if (!content.trim()) return { before, after: before, fired: false };

  // Split on H2 section boundaries (## …). Keep the leading header (# Squad Decisions etc).
  const h2Regex = /^(?=## )/m;
  const parts = content.split(h2Regex);
  // parts[0] is everything before the first H2 (file header / H1).
  const header = parts[0];
  const sections = parts.slice(1); // each starts with "## "

  if (sections.length === 0) {
    // No sections to archive.
    return { before, after: before, fired: false };
  }

  const archivePath = join(decisionsPath.replace(/decisions\.md$/, ''), 'decisions-archive.md');
  const existingArchive = await readUtf8(archivePath);

  const toArchive: string[] = [];
  const toKeep: string[] = [...sections];

  // Walk from oldest (index 0) and move sections until we're at or below targetBytes.
  // If we're at the hard threshold, be more aggressive.
  const threshold = before >= hardBytes ? targetBytes : Math.max(targetBytes, softBytes - 1024);

  while (toKeep.length > 0) {
    const candidateContent = header + toKeep.join('');
    const candidateSize = Buffer.byteLength(candidateContent, 'utf8');
    if (candidateSize <= threshold) break;
    // Archive the oldest remaining section.
    const oldest = toKeep.shift()!;
    toArchive.push(oldest);
  }

  if (toArchive.length === 0) {
    return { before, after: before, fired: false };
  }

  // Write updated decisions.md.
  const newContent = header + toKeep.join('');
  await writeFile(decisionsPath, newContent, 'utf8');

  // Prepend archived sections to decisions-archive.md (newest archives at top).
  const archiveHeader = existingArchive.startsWith('# ')
    ? existingArchive
    : `# Decisions Archive\n\n`;

  // Insert toArchive entries after the archive H1 header.
  const archiveHeadEnd = archiveHeader.indexOf('\n\n') + 2;
  const archiveTop = archiveHeader.slice(0, archiveHeadEnd);
  const archiveBody = archiveHeader.slice(archiveHeadEnd);
  const newArchive = archiveTop + toArchive.join('') + archiveBody;
  await writeFile(archivePath, newArchive, 'utf8');

  const after = await fileSize(decisionsPath);
  return { before, after, fired: true };
}

// ---------------------------------------------------------------------------
// Primitive 2: mergeInbox
// ---------------------------------------------------------------------------

/**
 * Read all .md files in inboxDir, append them to decisionsPath (deduplicating
 * by normalized heading), then delete the inbox files.
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
  // Normalize headings already in decisions.md for deduplication.
  const existingHeadings = new Set(
    [...existing.matchAll(/^## (.+)$/gm)].map(([, h]) => h.trim().toLowerCase()),
  );

  const chunks: string[] = [];
  for (const f of files) {
    const content = await readUtf8(f);
    if (!content.trim()) continue;
    // Check for duplicate H2 heading.
    const firstHeading = content.match(/^## (.+)$/m);
    if (firstHeading && existingHeadings.has(firstHeading[1].trim().toLowerCase())) {
      // Already present — skip but still delete the file.
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

/**
 * Write one orchestration-log file per agent in the spawn manifest.
 * Files land at logsDir/{datetime}-{agentName}.md.
 *
 * Returns the count of files written.
 */
export async function writeOrchestrationLogs(
  manifest: SpawnManifest,
  logsDir: string,
  datetime: string,
): Promise<number> {
  const ts = datetime.replace(/[:.]/g, '-').replace(/[TZ]/g, (c) => (c === 'T' ? 'T' : 'Z'));
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

/**
 * Write a brief session-log file summarising the run.
 * File lands at logsDir/{datetime}-{topic}.md.
 *
 * Returns the path written (or null on failure).
 */
export async function writeSessionLog(
  manifest: SpawnManifest,
  logsDir: string,
  datetime: string,
): Promise<string | null> {
  const ts = datetime.replace(/[:.]/g, '-').replace(/[TZ]/g, (c) => (c === 'T' ? 'T' : 'Z'));
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

/**
 * Append a "team update" block to the history.md of each agent mentioned in
 * the spawn manifest (other than the agent whose history.md is being updated).
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

    const peerLines = peers
      .map((p) => `- **${p.name}**: ${p.summary}`)
      .join('\n');

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
export async function summarizeHistoryIfLarge(
  historyPath: string,
  thresholdBytes = 15_360, // 15 KB
): Promise<boolean> {
  const size = await fileSize(historyPath);
  if (size < thresholdBytes) return false;

  const content = await readUtf8(historyPath);
  const learningsIdx = content.indexOf('\n## Learnings');
  if (learningsIdx === -1) return false;

  const beforeLearnings = content.slice(0, learningsIdx + 1);
  const learningsAndRest = content.slice(learningsIdx + 1);

  // Find where Learnings section ends (next H2 or end of file).
  const nextH2 = learningsAndRest.indexOf('\n## ', 14); // skip past "## Learnings" header
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

/**
 * Stage each path individually with `git add -- <path>` and commit using a
 * temporary message file (to avoid shell-escaping bugs with `git commit -m`).
 *
 * Only stages paths that exist and sit within the given repoRoot.
 * NEVER stages with broad globs like `git add .squad/`.
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

  // Stage each file individually.
  for (const p of existing) {
    try {
      await execFile('git', ['-C', repoRoot, 'add', '--', p]);
    } catch {
      // continue — other files may still be stageable
    }
  }

  // Check if anything is actually staged.
  let stagedOutput: string;
  try {
    const { stdout } = await execFile('git', ['-C', repoRoot, 'diff', '--cached', '--name-only']);
    stagedOutput = stdout.trim();
  } catch {
    return null;
  }
  if (!stagedOutput) return null;

  // Write commit message to a file to avoid shell escaping issues.
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
