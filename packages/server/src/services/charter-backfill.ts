import { getDb } from '../db/index.js';
import { agents, projects } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  isInternalSquadCharterPath,
  isInternalSquadWorkspacePath,
  normalizeSquadPath,
} from './squad-path-safety.js';

export interface BackfillStats {
  inspected: number;
  updated: number;
  skipped: number;
  suppressedInternal: number;
  errors: Array<{ agent: string; error: string }>;
}

interface EmptyCharterAgent {
  id: string;
  name: string;
  charterPath: string;
  projectPath: string | null;
}

/**
 * Backfill charter_content column by reading .squad/agents/<name>/charter.md
 * from disk for all agents with empty charterContent. Runs once per process.
 * Failures are logged but non-fatal.
 *
 * @param squadRoot Path to squad root directory (e.g., process.cwd() or project path)
 * @returns Statistics about the backfill operation
 */
export async function backfillCharterContent(squadRoot: string): Promise<BackfillStats> {
  const stats: BackfillStats = {
    inspected: 0,
    updated: 0,
    skipped: 0,
    suppressedInternal: 0,
    errors: [],
  };

  // Normalize path (remove trailing slash if present)
  const normalizedRoot = squadRoot.endsWith(path.sep)
    ? squadRoot.slice(0, -1)
    : squadRoot;

  try {
    // Query all agents where charterContent is empty
    const db = getDb();
    const emptyCharterAgents: EmptyCharterAgent[] = await db
      .select({
        id: agents.id,
        name: agents.name,
        charterPath: agents.charterPath,
        projectPath: projects.path,
      })
      .from(agents)
      .leftJoin(projects, eq(agents.projectId, projects.id))
      .where(eq(agents.charterContent, ''));

    stats.inspected = emptyCharterAgents.length;

    for (const agent of emptyCharterAgents) {
      try {
        const charterPath = resolveBackfillCharterPath(agent, normalizedRoot);

        if (
          (agent.projectPath && isInternalSquadWorkspacePath(agent.projectPath))
          || isInternalSquadCharterPath(charterPath)
        ) {
          stats.skipped += 1;
          stats.suppressedInternal += 1;
          continue;
        }

        if (!existsSync(charterPath)) {
          stats.skipped += 1;
          stats.errors.push({
            agent: agent.name,
            error: `Charter file not found at ${charterPath}`,
          });
          continue;
        }

        const content = await readFile(charterPath, 'utf-8');

        await db
          .update(agents)
          .set({ charterContent: content })
          .where(eq(agents.id, agent.id));

        stats.updated += 1;
      } catch (err) {
        stats.skipped += 1;
        const errorMsg = err instanceof Error ? err.message : String(err);
        stats.errors.push({
          agent: agent.name,
          error: errorMsg,
        });
      }
    }

    return stats;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('[charter-backfill] Fatal error during backfill:', errorMsg);
    throw err;
  }
}

function resolveBackfillCharterPath(agent: EmptyCharterAgent, fallbackRoot: string): string {
  const storedCharterPath = agent.charterPath?.trim();
  if (storedCharterPath) {
    if (path.isAbsolute(storedCharterPath)) {
      return path.normalize(storedCharterPath);
    }

    if (agent.projectPath?.trim()) {
      const projectSquadPath = normalizeSquadPath(agent.projectPath);
      const projectRoot = path.dirname(projectSquadPath);
      return storedCharterPath === '.squad' || storedCharterPath.startsWith(`.squad${path.sep}`)
        ? path.resolve(projectRoot, storedCharterPath)
        : path.resolve(projectSquadPath, storedCharterPath);
    }

    return path.resolve(fallbackRoot, storedCharterPath);
  }

  if (agent.projectPath?.trim()) {
    return path.join(normalizeSquadPath(agent.projectPath), 'agents', agent.name, 'charter.md');
  }

  return path.join(fallbackRoot, '.squad', 'agents', agent.name, 'charter.md');
}

export function formatBackfillErrorSummary(
  errors: BackfillStats['errors'],
  sampleLimit = 5,
): string {
  if (errors.length === 0) return 'none';
  const byMessage = new Map<string, number>();
  for (const error of errors) {
    const key = error.error.replace(/ at .+$/, ' at <path>');
    byMessage.set(key, (byMessage.get(key) ?? 0) + 1);
  }

  const groups = [...byMessage.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([message, count]) => `${count}× ${message}`)
    .slice(0, sampleLimit);
  const examples = errors
    .slice(0, sampleLimit)
    .map((e) => `${e.agent}: ${e.error}`)
    .join('; ');
  const omitted = errors.length > sampleLimit ? `; ${errors.length - sampleLimit} more omitted` : '';

  return `${groups.join(' | ')}. Examples: ${examples}${omitted}`;
}

/**
 * Initialize backfill state (idempotent). Track if backfill has already run
 * in this process via a module-level flag.
 */
let _backfillInitialized = false;

/**
 * Call this once after migrations complete to ensure charter_content is populated.
 * Returns early if already called in this process (idempotent).
 *
 * @param squadRoot Path to squad root directory
 * @returns Statistics if this call triggered backfill, null if already ran
 */
export async function ensureCharterBackfill(squadRoot: string): Promise<BackfillStats | null> {
  if (_backfillInitialized) {
    return null;
  }

  _backfillInitialized = true;

  try {
    const stats = await backfillCharterContent(squadRoot);

    if (stats.errors.length > 0) {
      console.warn(
        `[charter-backfill] Completed with ${stats.errors.length} error(s): ${formatBackfillErrorSummary(stats.errors)}`,
      );
    }

    console.log(
      `[charter-backfill] Backfill complete: inspected=${stats.inspected}, updated=${stats.updated}, skipped=${stats.skipped}, suppressedInternal=${stats.suppressedInternal}`
    );

    return stats;
  } catch (err) {
    console.error('[charter-backfill] Backfill failed, but continuing:', err);
    return null;
  }
}
