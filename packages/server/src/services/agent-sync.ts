import fs from 'node:fs/promises';
import path from 'node:path';
import { eq, and } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { parseCharterContent, computeContentHash } from './charter-compiler.js';
import { getAgents } from './sdk-state.js';
import { isInternalSquadWorkspacePath } from './squad-path-safety.js';

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
 * Agents in DB that are reliably absent from `.squad/agents/` are marked
 * 'retired'. Charter read/parse failures are not absence signals.
 */
export async function syncAgentsFromDisk(
  projectId: string,
  squadPath: string,
): Promise<SyncResult> {
  if (isInternalSquadWorkspacePath(squadPath)) {
    console.warn(`[agent-sync] skipped internal Squadboard workspace: ${squadPath}`);
    return { added: 0, updated: 0, removed: 0 };
  }

  const agentsDir = path.join(squadPath, 'agents');

  let sdkAgents: Awaited<ReturnType<typeof getAgents>> | null = null;
  const sdkNames = new Set<string>();
  try {
    sdkAgents = await getAgents(projectId);
    for (const name of await sdkAgents.list()) {
      // Skip internal directories (e.g. _alumni) — they are not real agents.
      if (!name.startsWith('_')) sdkNames.add(name);
    }
  } catch (sdkErr) {
    console.warn('[agent-sync] SDK agents.list() failed; continuing with fs scan:', sdkErr);
  }

  const diskListing = await listAgentDirs(agentsDir);
  const presentNames = new Set<string>([...sdkNames, ...diskListing.names]);
  const entries = [...presentNames].sort((a, b) => a.localeCompare(b));

  const db = getDb();
  let added = 0;
  let updated = 0;

  await Promise.all(
    entries.map(async (agentName) => {
      const charterPath = path.join(agentsDir, agentName, 'charter.md');
      const historyPath = path.join(agentsDir, agentName, 'history.md');

      const charterContent = await readAgentCharter({
        agentName,
        charterPath,
        sdkAgents,
        sdkHasAgent: sdkNames.has(agentName),
      });

      if (charterContent === null) return;

      let meta;
      try {
        meta = parseCharterContent(charterContent);
      } catch (err) {
        console.warn(
          `[agent-sync] Could not parse charter for '${agentName}'; leaving DB status unchanged:`,
          err instanceof Error ? err.message : String(err),
        );
        return;
      }

      const newHash = computeContentHash(charterContent);

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
        try {
          await db.insert(schema.agents).values({
            projectId,
            name: agentName,
            role: meta.role,
            model: meta.model ?? null,
            status: 'active',
            charterPath,
            historyPath: historyExists ? historyPath : null,
            charterHash: newHash ?? null,
            charterContent,
          });
          added++;
        } catch (err) {
          console.warn(
            `[agent-sync] Error inserting agent '${agentName}':`,
            err instanceof Error ? err.message : String(err),
          );
        }
      } else {
        const row = existing[0];
        const hashChanged = newHash && row.charterHash !== newHash;
        const roleChanged = row.role !== meta.role;
        const modelChanged = (row.model ?? undefined) !== (meta.model ?? undefined);
        const charterContentChanged = row.charterContent !== charterContent;
        const shouldReactivate = row.status === 'retired';

        if (hashChanged || roleChanged || modelChanged || charterContentChanged || shouldReactivate) {
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
            charterContent,
            historyPath: historyExists ? historyPath : row.historyPath,
            updatedAt: new Date(),
          };
          if (shouldReactivate) mutableFields.status = 'active';
          try {
            await db
              .update(schema.agents)
              .set(mutableFields)
              .where(eq(schema.agents.id, row.id));
            updated++;
          } catch (err) {
            console.warn(
              `[agent-sync] Error updating agent '${agentName}':`,
              err instanceof Error ? err.message : String(err),
            );
          }
        }
      }
    }),
  );

  // Retire DB rows only when the filesystem listing is reliable. A stale SDK
  // cache, transient charter read failure, or parse problem is not proof of
  // deletion and must not silently retire active hire-team agents.
  const allRows = await db
    .select()
    .from(schema.agents)
    .where(eq(schema.agents.projectId, projectId));

  let removed = 0;
  if (diskListing.reliableForRetirement) {
    await Promise.all(
      allRows
        .filter((r) => !presentNames.has(r.name) && r.status === 'active')
        .map(async (r) => {
          // Whitelist set fields — never re-stamp `createdAt` on retire.
          await db
            .update(schema.agents)
            .set({ status: 'retired', updatedAt: new Date() })
            .where(eq(schema.agents.id, r.id));
          removed++;
        }),
    );
  } else if (allRows.some((r) => !presentNames.has(r.name) && r.status === 'active')) {
    console.warn(
      '[agent-sync] Skipped retiring agents because .squad/agents could not be listed reliably',
    );
  }

  return { added, updated, removed };
}

interface AgentDirListing {
  names: Set<string>;
  reliableForRetirement: boolean;
}

async function listAgentDirs(agentsDir: string): Promise<AgentDirListing> {
  try {
    const dirents = await fs.readdir(agentsDir, { withFileTypes: true });
    return {
      // Underscore-prefixed directories (e.g. `_alumni`, `_archive`) are
      // internal housekeeping folders, not agents. Silently skip them so
      // sync never tries to read their charter or logs spurious warnings.
      names: new Set(
        dirents
          .filter((d) => d.isDirectory() && !d.name.startsWith('_'))
          .map((d) => d.name),
      ),
      reliableForRetirement: true,
    };
  } catch (err) {
    if (isNotFoundError(err)) {
      return { names: new Set(), reliableForRetirement: true };
    }
    console.warn(
      '[agent-sync] fs.readdir(.squad/agents) failed; retirement disabled for this sync:',
      err instanceof Error ? err.message : String(err),
    );
    return { names: new Set(), reliableForRetirement: false };
  }
}

async function readAgentCharter(opts: {
  agentName: string;
  charterPath: string;
  sdkAgents: Awaited<ReturnType<typeof getAgents>> | null;
  sdkHasAgent: boolean;
}): Promise<string | null> {
  const { agentName, charterPath, sdkAgents, sdkHasAgent } = opts;

  if (sdkAgents && sdkHasAgent) {
    try {
      return await sdkAgents.get(agentName).charter();
    } catch (sdkErr) {
      console.warn(
        `[agent-sync] SDK charter() failed for '${agentName}', falling back to fs:`,
        sdkErr,
      );
    }
  }

  try {
    return await fs.readFile(charterPath, 'utf-8');
  } catch (fsErr) {
    console.warn(
      `[agent-sync] Could not read charter.md for '${agentName}'; leaving DB status unchanged:`,
      fsErr instanceof Error ? fsErr.message : String(fsErr),
    );
    return null;
  }
}

function isNotFoundError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === 'ENOENT'
  );
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
