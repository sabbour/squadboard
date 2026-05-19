import { getDb } from '../db/index.js';
import { agents } from '../db/schema.js';
import { eq, and, like } from 'drizzle-orm';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

export interface BackfillStats {
  inspected: number;
  updated: number;
  skipped: number;
  errors: Array<{ agent: string; error: string }>;
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
    errors: [],
  };

  // Normalize path (remove trailing slash if present)
  const normalizedRoot = squadRoot.endsWith(path.sep)
    ? squadRoot.slice(0, -1)
    : squadRoot;

  try {
    // Query all agents where charterContent is empty
    const db = getDb();
    const emptyCharterAgents = await db
      .select()
      .from(agents)
      .where(like(agents.charterContent, ''));

    stats.inspected = emptyCharterAgents.length;

    for (const agent of emptyCharterAgents) {
      try {
        const charterPath = path.join(
          normalizedRoot,
          '.squad',
          'agents',
          agent.name,
          'charter.md'
        );

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
        `[charter-backfill] Completed with ${stats.errors.length} error(s):`,
        stats.errors.map((e) => `${e.agent}: ${e.error}`).join('; ')
      );
    }

    console.log(
      `[charter-backfill] Backfill complete: inspected=${stats.inspected}, updated=${stats.updated}, skipped=${stats.skipped}`
    );

    return stats;
  } catch (err) {
    console.error('[charter-backfill] Backfill failed, but continuing:', err);
    return null;
  }
}
