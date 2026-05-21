/**
 * squad-writeback.ts — Bidirectional sync between Squadboard DB and the
 * `.squad/` filesystem projection.
 *
 * ┌──────────────────────────────────────────────────────────┐
 * │  SYNC ARCHITECTURE (two directions, one source of truth)  │
 * │                                                            │
 * │  DB (source of truth, postgresql mode)                     │
 * │    ↓ writeback (this file)      ↑ import (agent-sync,     │
 * │    ↓ after every mutation         ceremony import)         │
 * │  .squad/ filesystem projection                             │
 * │    (read by CLI / Copilot)                                 │
 * └──────────────────────────────────────────────────────────┘
 *
 * DB → Disk (exported here, called after every mutation):
 *   agents: writeAgentCharterToDisk, rebuildTeamMd
 *   ceremonies: writeCeremonyToDisk, removeCeremonyFromDisk, rebuildCeremoniesMd
 *
 * Disk → DB (imported here for ceremonies; agents use agent-sync.ts):
 *   ceremonies: syncCeremoniesFromDisk  (analogous to syncAgentsFromDisk)
 *
 * All functions are best-effort — failures are logged but never thrown
 * so a writeback error never fails the originating API call.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { eq, and, inArray } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { writeCharter, computeCharterHash } from './charter-compiler.js';
import { exportCeremonyAsYaml } from './ceremony-yaml-export.js';
import { importCeremonyFromYaml } from './ceremony-yaml-import.js';
import { isInternalSquadWorkspacePath } from './squad-path-safety.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AgentRow = typeof schema.agents.$inferSelect;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Ensure a directory exists, creating intermediate dirs as needed. */
async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

/** Safe stat — returns null instead of throwing. */
async function statSafe(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/** Resolve the `squadPath` for a given projectId from DB. */
async function resolveSquadPath(projectId: string): Promise<string | null> {
  const db = getDb();
  const [project] = await db
    .select({ path: schema.projects.path })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .limit(1);
  return project?.path ?? null;
}

// ---------------------------------------------------------------------------
// Agent writeback: DB → Disk
// ---------------------------------------------------------------------------

/**
 * Re-write the charter.md for an agent after its role or model changes.
 *
 * Called from PATCH /api/projects/:id/agents/:id after DB update.
 * The agent row must include the updated role/model.
 */
export async function writeAgentCharterToDisk(agent: AgentRow): Promise<void> {
  if (!agent.charterPath) return;

  try {
    await ensureDir(path.dirname(agent.charterPath));
    await writeCharter(agent.charterPath, {
      name: agent.name,
      role: agent.role,
      model: agent.model ?? undefined,
      expertise: [],
    });

    // Keep DB in sync with the freshly-written content.
    const db = getDb();
    const newHash = await computeCharterHash(agent.charterPath);
    const newContent = await fs.readFile(agent.charterPath, 'utf-8');
    await db
      .update(schema.agents)
      .set({ charterHash: newHash, charterContent: newContent, updatedAt: new Date() })
      .where(eq(schema.agents.id, agent.id));

    console.info(`[squad-writeback] wrote charter: ${agent.charterPath}`);
  } catch (err) {
    console.warn('[squad-writeback] writeAgentCharterToDisk failed:', err instanceof Error ? err.message : err);
  }
}

/**
 * Regenerate `.squad/team.md` from all active agents in DB.
 *
 * Called after any agent mutation so CLI/Copilot always sees the current roster.
 */
export async function rebuildTeamMd(projectId: string, squadPath: string): Promise<void> {
  if (isInternalSquadWorkspacePath(squadPath)) return;

  try {
    const db = getDb();

    const [project] = await db
      .select({ name: schema.projects.name, description: schema.projects.description })
      .from(schema.projects)
      .where(eq(schema.projects.id, projectId))
      .limit(1);

    const agents = await db
      .select()
      .from(schema.agents)
      .where(
        and(
          eq(schema.agents.projectId, projectId),
          inArray(schema.agents.status, ['active', 'disabled']),
        ),
      )
      .orderBy(schema.agents.name);

    const projectName = project?.name ?? 'Squad Project';
    const description = project?.description?.trim() || 'Squad-managed project.';

    const rows = agents.map((agent) => {
      const charterRef = agent.agentKind === 'copilot'
        ? '—'
        : `\`.squad/agents/${agent.name}/charter.md\``;
      const statusLabel = agent.status === 'active' ? '✅ Active' : '⏸ Disabled';
      const kindLabel = agent.agentKind === 'copilot' ? '🤖 Copilot Agent' : '🤖 AI Agent';
      const badge = getRoleBadge(agent.role, agent.name);
      return `| ${agent.name} | ${agent.role} | ${charterRef} | ${statusLabel} | ${kindLabel} | ${badge} |`;
    });

    const membersSection = rows.length > 0
      ? rows.join('\n')
      : '| _No members yet_ | _Cast a team to finish setup_ | — | — | — | — |';

    const content = `# ${projectName}

> ${description}

## Coordinator

| Name | Role | Notes |
|------|------|-------|
| Squad | Coordinator | Routes work, enforces handoffs, and keeps reviewer gates intact. |

## Members

| Name | Role | Charter | Status | Type | Badge |
|------|------|---------|--------|------|-------|
${membersSection}

## Project Context

- **Description:** ${description}
`;

    const teamMdPath = path.join(squadPath, 'team.md');
    await ensureDir(squadPath);
    await fs.writeFile(teamMdPath, content, 'utf-8');
    console.info(`[squad-writeback] rebuilt team.md (${agents.length} agents)`);
  } catch (err) {
    console.warn('[squad-writeback] rebuildTeamMd failed:', err instanceof Error ? err.message : err);
  }
}

function getRoleBadge(role: string, name: string): string {
  const r = role.toLowerCase();
  if (r.includes('lead') || r.includes('architect') || r.includes('coordinator')) return '🏗️ Lead';
  if (r.includes('frontend') || r.includes('ui') || r.includes('react')) return '⚛️ Frontend';
  if (r.includes('backend') || r.includes('api') || r.includes('server')) return '🔧 Backend';
  if (r.includes('test') || r.includes('qa') || r.includes('quality')) return '🧪 Tester';
  if (r.includes('devops') || r.includes('infra') || r.includes('platform')) return '⚙️ DevOps';
  if (r.includes('design') || r.includes('ux')) return '🎨 Designer';
  if (r.includes('monitor') || r.includes('watch')) return '🔄 Monitor';
  if (r.includes('scribe') || r.includes('logger') || r.includes('log')) return '📋 Scribe';
  if (r.includes('data') || r.includes('analytics') || r.includes('database')) return '📊 Data';
  if (r.includes('security') || r.includes('auth') || r.includes('compliance')) return '🔒 Security';
  return '👤 Agent';
}

// ---------------------------------------------------------------------------
// Ceremony writeback: DB → Disk
// ---------------------------------------------------------------------------

/** Absolute path for a ceremony YAML file on disk. */
function ceremonyYamlPath(squadPath: string, slug: string): string {
  return path.join(squadPath, 'ceremonies', `${slug}.yaml`);
}

/**
 * Export a ceremony from DB as a YAML file at `.squad/ceremonies/{slug}.yaml`.
 *
 * Called after ceremony CREATE or PATCH.
 */
export async function writeCeremonyToDisk(ceremonyId: string, squadPath: string): Promise<void> {
  if (isInternalSquadWorkspacePath(squadPath)) return;

  try {
    const db = getDb();
    const [row] = await db
      .select({ slug: schema.workflows.slug, kind: schema.workflows.kind })
      .from(schema.workflows)
      .where(eq(schema.workflows.id, ceremonyId))
      .limit(1);

    if (!row) return;
    // Skip narrative ceremonies — they're prose, not executable YAML.
    if (row.kind === 'narrative') return;

    const yamlText = await exportCeremonyAsYaml(ceremonyId);
    const filePath = ceremonyYamlPath(squadPath, row.slug);
    await ensureDir(path.dirname(filePath));
    await fs.writeFile(filePath, yamlText, 'utf-8');
    console.info(`[squad-writeback] wrote ceremony: ${filePath}`);
  } catch (err) {
    console.warn('[squad-writeback] writeCeremonyToDisk failed:', err instanceof Error ? err.message : err);
  }
}

/**
 * Remove a ceremony YAML file from disk after DELETE/archive.
 */
export async function removeCeremonyFromDisk(slug: string, squadPath: string): Promise<void> {
  if (isInternalSquadWorkspacePath(squadPath)) return;

  const filePath = ceremonyYamlPath(squadPath, slug);
  try {
    if (await statSafe(filePath)) {
      await fs.unlink(filePath);
      console.info(`[squad-writeback] removed ceremony: ${filePath}`);
    }
  } catch (err) {
    console.warn('[squad-writeback] removeCeremonyFromDisk failed:', err instanceof Error ? err.message : err);
  }
}

/**
 * Regenerate `.squad/ceremonies.md` from all active ceremonies in DB.
 *
 * This file is read by the coordinator (squad.agent.md) to know which
 * ceremonies to trigger and when. Format: one ## section per ceremony.
 */
export async function rebuildCeremoniesMd(projectId: string, squadPath: string): Promise<void> {
  if (isInternalSquadWorkspacePath(squadPath)) return;

  try {
    const db = getDb();
    const ceremonies = await db
      .select({
        name: schema.workflows.name,
        slug: schema.workflows.slug,
        description: schema.workflows.description,
        triggerKind: schema.workflows.triggerKind,
        triggerConfig: schema.workflows.triggerConfig,
        kind: schema.workflows.kind,
        status: schema.workflows.status,
      })
      .from(schema.workflows)
      .where(
        and(
          eq(schema.workflows.projectId, projectId),
          inArray(schema.workflows.status, ['active', 'draft']),
        ),
      )
      .orderBy(schema.workflows.name);

    const executableCeremonies = ceremonies.filter((c) => c.kind !== 'narrative');

    let content: string;
    if (executableCeremonies.length === 0) {
      content = `# Ceremonies

> Team meetings that happen before or after work. Each squad configures their own.

_No ceremonies configured yet. Create a ceremony in Squadboard and it will appear here._
`;
    } else {
      const sections = executableCeremonies.map((c) => {
        const triggerConfig = (c.triggerConfig ?? {}) as Record<string, unknown>;
        const when = resolveCeremonyWhen(c.triggerKind, triggerConfig);
        const condition = resolveCeremonyCondition(c.triggerKind, triggerConfig);
        const desc = c.description?.trim() ? `\n${c.description}\n` : '';
        const yamlRef = `\`.squad/ceremonies/${c.slug}.yaml\``;

        return [
          `## ${c.name}`,
          '',
          ...(desc ? [desc] : []),
          '| Field | Value |',
          '|-------|-------|',
          `| **Trigger** | ${triggerKindLabel(c.triggerKind)} |`,
          `| **When** | ${when} |`,
          `| **Condition** | ${condition} |`,
          `| **Status** | ${c.status} |`,
          `| **Definition** | ${yamlRef} |`,
        ].join('\n');
      });

      content = [
        '# Ceremonies',
        '',
        '> Team meetings that happen before or after work. Each squad configures their own.',
        '> Ceremony definitions are in `.squad/ceremonies/*.yaml` — edit them directly or via Squadboard.',
        '',
        sections.join('\n\n'),
        '',
      ].join('\n');
    }

    const ceremoniesMdPath = path.join(squadPath, 'ceremonies.md');
    await ensureDir(squadPath);
    await fs.writeFile(ceremoniesMdPath, content, 'utf-8');
    console.info(`[squad-writeback] rebuilt ceremonies.md (${executableCeremonies.length} ceremonies)`);
  } catch (err) {
    console.warn('[squad-writeback] rebuildCeremoniesMd failed:', err instanceof Error ? err.message : err);
  }
}

function triggerKindLabel(triggerKind: string): string {
  switch (triggerKind) {
    case 'on_issue_entry': return 'Issue entry';
    case 'on_schedule': return 'Scheduled (cron)';
    case 'on_event': return 'GitHub event';
    case 'manual': return 'Manual';
    case 'agent-signal': return 'Agent signal';
    default: return triggerKind;
  }
}

function resolveCeremonyWhen(triggerKind: string, triggerConfig: Record<string, unknown>): string {
  if (triggerKind === 'on_issue_entry') return 'before work';
  if (triggerKind === 'on_schedule') return 'scheduled';
  if (triggerKind === 'on_event') return 'on event';
  if (triggerKind === 'agent-signal') {
    const signal = typeof triggerConfig.signalName === 'string' ? triggerConfig.signalName : 'any signal';
    return `on signal: ${signal}`;
  }
  return 'manual';
}

function resolveCeremonyCondition(triggerKind: string, triggerConfig: Record<string, unknown>): string {
  if (triggerKind === 'on_schedule') {
    const schedule = typeof triggerConfig.schedule === 'string' ? triggerConfig.schedule : '';
    return schedule || 'see YAML';
  }
  if (triggerKind === 'on_event') {
    const event = typeof triggerConfig.event === 'string' ? triggerConfig.event : '';
    return event || 'see YAML';
  }
  if (triggerKind === 'on_issue_entry') return 'any issue column entry';
  if (triggerKind === 'agent-signal') {
    const signal = typeof triggerConfig.signalName === 'string' ? triggerConfig.signalName : '';
    return signal || 'see YAML';
  }
  return 'explicit invocation';
}

// ---------------------------------------------------------------------------
// Ceremony import: Disk → DB
// ---------------------------------------------------------------------------

/**
 * Scan `.squad/ceremonies/*.yaml` and import any files not already in DB.
 *
 * This is the disk→DB direction, analogous to syncAgentsFromDisk for agents.
 * Called on GET /api/projects/:id/ceremonies (best-effort, never throws).
 *
 * Returns a summary of what was imported.
 */
export async function syncCeremoniesFromDisk(
  projectId: string,
  squadPath: string,
): Promise<{ imported: number; skipped: number; errors: number }> {
  if (isInternalSquadWorkspacePath(squadPath)) {
    return { imported: 0, skipped: 0, errors: 0 };
  }

  const ceremoniesDir = path.join(squadPath, 'ceremonies');
  let files: string[];

  try {
    const entries = await fs.readdir(ceremoniesDir, { withFileTypes: true });
    files = entries
      .filter((e) => e.isFile() && (e.name.endsWith('.yaml') || e.name.endsWith('.yml')))
      .map((e) => path.join(ceremoniesDir, e.name));
  } catch {
    // Directory doesn't exist — nothing to import.
    return { imported: 0, skipped: 0, errors: 0 };
  }

  let imported = 0;
  let skipped = 0;
  let errors = 0;

  for (const filePath of files) {
    try {
      const yamlText = await fs.readFile(filePath, 'utf-8');
      const result = await importCeremonyFromYaml(yamlText, projectId, {
        sourceMarker: `disk:${path.basename(filePath)}`,
      });
      if (result.created) {
        imported++;
        console.info(`[squad-writeback] imported ceremony from disk: ${filePath}`);
      } else {
        skipped++;
      }
    } catch (err) {
      errors++;
      console.warn(`[squad-writeback] failed to import ceremony ${filePath}:`, err instanceof Error ? err.message : err);
    }
  }

  return { imported, skipped, errors };
}

// ---------------------------------------------------------------------------
// High-level helpers used by routes
// ---------------------------------------------------------------------------

/**
 * Best-effort: write agent charter + rebuild team.md after an agent mutation.
 * Never throws — failures are logged.
 */
export async function syncAgentToFs(agent: AgentRow): Promise<void> {
  // Derive squadPath from DB instead of brittle charterPath string splitting.
  const squadPath = await resolveSquadPath(agent.projectId);
  if (!squadPath) return;
  await writeAgentCharterToDisk(agent);
  await rebuildTeamMd(agent.projectId, squadPath);
}

/**
 * Best-effort: write ceremony YAML + rebuild ceremonies.md after a ceremony mutation.
 * Never throws — failures are logged.
 */
export async function syncCeremonyToFs(
  ceremonyId: string,
  projectId: string,
  squadPath: string,
): Promise<void> {
  await writeCeremonyToDisk(ceremonyId, squadPath);
  await rebuildCeremoniesMd(projectId, squadPath);
}

/**
 * Best-effort: remove ceremony YAML + rebuild ceremonies.md after a ceremony delete.
 * Never throws — failures are logged.
 */
export async function removeCeremonyFromFs(
  slug: string,
  projectId: string,
  squadPath: string,
): Promise<void> {
  await removeCeremonyFromDisk(slug, squadPath);
  await rebuildCeremoniesMd(projectId, squadPath);
}

/**
 * Resolve squadPath for a projectId and run the given action.
 * If the project has no path, action is skipped silently.
 */
export async function withSquadPath(
  projectId: string,
  action: (squadPath: string) => Promise<void>,
): Promise<void> {
  try {
    const squadPath = await resolveSquadPath(projectId);
    if (squadPath) await action(squadPath);
  } catch (err) {
    console.warn('[squad-writeback] withSquadPath failed:', err instanceof Error ? err.message : err);
  }
}
