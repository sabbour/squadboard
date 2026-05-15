import fs from 'node:fs/promises';
import path from 'node:path';
import { eq, and } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { parseCharter, computeCharterHash } from './charter-compiler.js';

export interface SyncResult {
  added: number;
  updated: number;
  removed: number;
}

/**
 * Scan `.squad/agents/` for a project and sync to DB.
 *
 * For each sub-folder in <squadPath>/agents/:
 *   - Read charter.md and parse metadata
 *   - Upsert agents row (matched on projectId + name)
 *   - Detect charter changes via md5 hash
 *
 * Agents in DB that no longer have a folder on disk are marked 'retired'.
 */
export async function syncAgentsFromDisk(
  projectId: string,
  squadPath: string,
): Promise<SyncResult> {
  const agentsDir = path.join(squadPath, 'agents');

  // Collect folder names
  let entries: string[] = [];
  try {
    const dirents = await fs.readdir(agentsDir, { withFileTypes: true });
    entries = dirents.filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    // No agents directory — nothing to sync
    return { added: 0, updated: 0, removed: 0 };
  }

  const db = getDb();
  let added = 0;
  let updated = 0;

  const seenNames = new Set<string>();

  await Promise.all(
    entries.map(async (agentName) => {
      const charterPath = path.join(agentsDir, agentName, 'charter.md');
      const historyPath = path.join(agentsDir, agentName, 'history.md');

      // Skip folders without a charter.md
      try {
        await fs.access(charterPath);
      } catch {
        return;
      }

      seenNames.add(agentName);

      let meta;
      try {
        meta = await parseCharter(charterPath);
      } catch {
        return;
      }

      const newHash = await computeCharterHash(charterPath).catch(() => undefined);

      const historyExists = await fs
        .access(historyPath)
        .then(() => true)
        .catch(() => false);

      // Check existing DB row
      const existing = await db
        .select()
        .from(schema.agents)
        .where(and(eq(schema.agents.projectId, projectId), eq(schema.agents.name, agentName)))
        .limit(1);

      if (existing.length === 0) {
        // INSERT new agent row.
        // We deliberately omit `id`, `createdAt`, and `updatedAt` from the
        // values payload so the database defaults (`defaultRandom()` /
        // `defaultNow()`) own those columns. Never pass the entity wholesale
        // here — Drizzle would write every supplied column on conflict.
        await db.insert(schema.agents).values({
          projectId,
          name: agentName,
          role: meta.role,
          model: meta.model ?? null,
          status: 'active',
          charterPath,
          historyPath: historyExists ? historyPath : null,
          charterHash: newHash ?? null,
        });
        added++;
      } else {
        const row = existing[0];
        const hashChanged = newHash && row.charterHash !== newHash;
        const roleChanged = row.role !== meta.role;
        const modelChanged = (row.model ?? undefined) !== (meta.model ?? undefined);

        if (hashChanged || roleChanged || modelChanged) {
          // UPDATE branch: scope `.set({...})` to MUTABLE fields ONLY.
          //
          // INVARIANT: `createdAt` (and `id`) MUST NEVER appear in this set
          // clause. Re-stamping `createdAt` on every project-open / file
          // watcher tick would silently overwrite the agent's true creation
          // time — every page refresh would make the agent look "just hired".
          //
          // The mutable-fields whitelist is typed below so a TS error fires
          // if somebody adds `createdAt` (or `id`) to the set payload.
          const mutableFields: Partial<
            Omit<typeof schema.agents.$inferInsert, 'id' | 'projectId' | 'name' | 'createdAt'>
          > = {
            role: meta.role,
            model: meta.model ?? null,
            charterHash: newHash ?? null,
            historyPath: historyExists ? historyPath : row.historyPath,
            updatedAt: new Date(),
          };
          await db
            .update(schema.agents)
            .set(mutableFields)
            .where(eq(schema.agents.id, row.id));
          updated++;
        }
      }
    }),
  );

  // Retire DB rows for agents whose folder no longer exists
  const allRows = await db
    .select()
    .from(schema.agents)
    .where(eq(schema.agents.projectId, projectId));

  let removed = 0;
  await Promise.all(
    allRows
      .filter((r) => !seenNames.has(r.name) && r.status === 'active')
      .map(async (r) => {
        // Whitelist set fields — never re-stamp `createdAt` on retire.
        await db
          .update(schema.agents)
          .set({ status: 'retired', updatedAt: new Date() })
          .where(eq(schema.agents.id, r.id));
        removed++;
      }),
  );

  return { added, updated, removed };
}

/**
 * Watch `.squad/agents/` for file changes and trigger a re-sync.
 * Uses chokidar for cross-platform file watching.
 *
 * @returns A cleanup function that stops the watcher.
 */
export async function watchAgents(
  projectId: string,
  squadPath: string,
): Promise<() => void> {
  const agentsDir = path.join(squadPath, 'agents');

  // Dynamic import so the server starts even if chokidar isn't installed yet.
  const chokidar = await import('chokidar').catch(() => null);

  if (!chokidar) {
    console.warn('[agent-sync] chokidar not installed — file watching disabled');
    return () => { /* no-op */ };
  }

  const watcher = chokidar.default.watch(agentsDir, {
    depth: 2,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
  });

  const resync = async () => {
    try {
      const result = await syncAgentsFromDisk(projectId, squadPath);
      if (result.added + result.updated + result.removed > 0) {
        console.log(
          `[agent-sync] re-synced: +${result.added} ~${result.updated} -${result.removed}`,
        );
      }
    } catch (err) {
      console.error('[agent-sync] resync error:', err);
    }
  };

  watcher.on('add', resync).on('change', resync).on('unlink', resync);

  return () => {
    watcher.close();
  };
}
