import fs from 'node:fs/promises';
import path from 'node:path';
import { parseTeamRoster, validateSquadDir } from './squad-discovery.js';
// TODO: import { db } from '../db/index.js' once Hockney creates it
/**
 * Link a project to its .squad/ directory.
 * Writes the squadPath into the projects row identified by projectId.
 *
 * Idempotent: calling twice with the same args is a no-op.
 */
export async function linkProjectToSquad(projectId, squadPath) {
    const validation = await validateSquadDir(squadPath);
    if (!validation.valid) {
        throw new Error(`Cannot link project ${projectId}: invalid .squad/ dir — ${validation.errors.join(', ')}`);
    }
    // TODO: once db is available:
    // await db
    //   .update(projects)
    //   .set({ squadPath })
    //   .where(eq(projects.id, projectId));
    //
    // For now we persist the link in a local JSON sidecar so the service
    // is usable before Hockney's schema lands.
    await persistLinkSidecar(projectId, squadPath);
}
/**
 * Get the Squad context for a project: reads team.md and decisions.md.
 */
export async function getSquadContext(projectId) {
    const squadPath = await resolveSquadPath(projectId);
    if (!squadPath) {
        throw new Error(`No .squad/ directory linked to project ${projectId}`);
    }
    const teamMembers = await parseTeamRoster(squadPath).catch(() => []);
    const recentDecisions = await readRecentDecisions(squadPath);
    return { squadPath, teamMembers, recentDecisions };
}
// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------
/** Sidecar file path for project→squad links (temporary until DB is wired). */
function sidecarPath() {
    // Stored adjacent to this file at runtime; adjust when DB lands.
    return path.resolve(process.cwd(), '.squad-links.json');
}
async function loadSidecar() {
    try {
        const raw = await fs.readFile(sidecarPath(), 'utf-8');
        return JSON.parse(raw);
    }
    catch {
        return {};
    }
}
async function persistLinkSidecar(projectId, squadPath) {
    const links = await loadSidecar();
    if (links[projectId] === squadPath)
        return; // idempotent
    links[projectId] = squadPath;
    await fs.writeFile(sidecarPath(), JSON.stringify(links, null, 2), 'utf-8');
}
async function resolveSquadPath(projectId) {
    // TODO: once DB lands, query projects table first:
    // const row = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    // if (row[0]?.squadPath) return row[0].squadPath;
    const links = await loadSidecar();
    return links[projectId] ?? null;
}
/**
 * Extract the most recent decision entries from decisions.md or the decisions/inbox/*.md files.
 * Returns up to 5 plain-text summaries.
 */
async function readRecentDecisions(squadPath) {
    const lines = [];
    // Try flat decisions.md first
    const decisionsMd = path.join(squadPath, 'decisions.md');
    try {
        const content = await fs.readFile(decisionsMd, 'utf-8');
        for (const line of content.split('\n')) {
            const trimmed = line.trim();
            if (trimmed.startsWith('### ')) {
                lines.push(trimmed.replace(/^###\s+/, ''));
                if (lines.length >= 5)
                    break;
            }
        }
    }
    catch {
        // decisions.md absent — fall through to inbox dir
    }
    if (lines.length < 5) {
        // Supplement from decisions/inbox/*.md file names (quick, cheap)
        const inboxDir = path.join(squadPath, 'decisions', 'inbox');
        try {
            const entries = await fs.readdir(inboxDir);
            for (const entry of entries.filter((e) => e.endsWith('.md')).slice(0, 5 - lines.length)) {
                lines.push(entry.replace(/\.md$/, '').replace(/-/g, ' '));
            }
        }
        catch {
            // No inbox — that's fine
        }
    }
    return lines.slice(0, 5);
}
//# sourceMappingURL=project-squad.js.map