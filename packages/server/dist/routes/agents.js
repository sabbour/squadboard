import { Router } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { eq, and } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { parseCharter, writeCharter, computeCharterHash } from '../services/charter-compiler.js';
import { syncAgentsFromDisk } from '../services/agent-sync.js';
import { formulateAgentDraft, formulateTeamDraft } from '../services/hire-formulator.js';
import { castTeam, buildPersonaSection } from '../services/casting-engine.js';
const router = Router({ mergeParams: true });
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const KEBAB_RE = /^[a-z][a-z0-9-]*$/;
async function resolveSquadPath(projectId) {
    const db = getDb();
    const [project] = await db
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.id, projectId))
        .limit(1);
    return project?.path ?? null;
}
// ---------------------------------------------------------------------------
// GET /api/projects/:projectId/agents
// List agents, optionally filtered by ?status=active|disabled|retired
// ---------------------------------------------------------------------------
router.get('/', async (req, res) => {
    const { projectId } = req.params;
    const { status } = req.query;
    const db = getDb();
    const conditions = [eq(schema.agents.projectId, projectId)];
    if (status && typeof status === 'string') {
        conditions.push(eq(schema.agents.status, status));
    }
    // Trigger a sync from disk before returning so the list is always fresh.
    const squadPath = await resolveSquadPath(projectId);
    if (squadPath) {
        await syncAgentsFromDisk(projectId, squadPath).catch(() => { });
    }
    const rows = await db
        .select()
        .from(schema.agents)
        .where(conditions.length === 1 ? conditions[0] : and(...conditions));
    res.json({ ok: true, data: rows });
});
// ---------------------------------------------------------------------------
// POST /api/projects/:projectId/agents  — hire a new agent
// Body: { name, role, model?, expertise[] }
// ---------------------------------------------------------------------------
router.post('/', async (req, res) => {
    const { projectId } = req.params;
    const { name, role, model, expertise } = req.body;
    if (!name || !role) {
        res.status(400).json({ ok: false, error: '`name` and `role` are required' });
        return;
    }
    if (!KEBAB_RE.test(name)) {
        res.status(400).json({
            ok: false,
            error: '`name` must be kebab-case (lowercase letters, digits, hyphens; must start with a letter)',
        });
        return;
    }
    const squadPath = await resolveSquadPath(projectId);
    if (!squadPath) {
        res.status(404).json({ ok: false, error: 'Project not found or has no .squad/ path' });
        return;
    }
    const agentDir = path.join(squadPath, 'agents', name);
    const charterPath = path.join(agentDir, 'charter.md');
    const historyPath = path.join(agentDir, 'history.md');
    const db = getDb();
    // Collision check
    const collision = await db
        .select()
        .from(schema.agents)
        .where(and(eq(schema.agents.projectId, projectId), eq(schema.agents.name, name)))
        .limit(1);
    if (collision.length > 0) {
        res.status(409).json({ ok: false, error: `Agent "${name}" already exists in this project` });
        return;
    }
    // Also check on disk
    try {
        await fs.access(agentDir);
        res.status(409).json({ ok: false, error: `Agent folder .squad/agents/${name} already exists on disk` });
        return;
    }
    catch {
        // Good — folder does not exist yet
    }
    // Create files atomically: directory first, then charter, then history
    await fs.mkdir(agentDir, { recursive: true });
    await writeCharter(charterPath, {
        name,
        role,
        model,
        expertise: expertise ?? [],
    });
    const historyContent = `# ${name} — History\n\n## Core Context\n\n- **Role:** ${role}\n- **Joined:** 2026-05-14T09:23:41Z\n\n## Learnings\n\n<!-- Append learnings below -->\n`;
    await fs.writeFile(historyPath, historyContent, 'utf-8');
    const charterHash = await computeCharterHash(charterPath);
    const [inserted] = await db
        .insert(schema.agents)
        .values({
        projectId,
        name,
        role,
        model: model ?? null,
        status: 'active',
        charterPath,
        historyPath,
        charterHash,
    })
        .returning();
    res.status(201).json({ ok: true, data: inserted });
});
// ---------------------------------------------------------------------------
// POST /api/projects/:projectId/agents/formulate
// AI-formulate an agent draft from a brief prose description. Does NOT
// persist — returns { agent: {name,role,expertise,model}, modelUsed }.
// ---------------------------------------------------------------------------
router.post('/formulate', async (req, res) => {
    try {
        const { projectId } = req.params;
        const { draft } = (req.body ?? {});
        if (!draft || typeof draft !== 'string') {
            res.status(400).json({ ok: false, error: '`draft` is required' });
            return;
        }
        const db = getDb();
        const existing = await db
            .select({ name: schema.agents.name })
            .from(schema.agents)
            .where(eq(schema.agents.projectId, projectId));
        const existingNames = existing.map((r) => r.name);
        const result = await formulateAgentDraft(projectId, draft, existingNames);
        res.json({ ok: true, data: result });
    }
    catch (err) {
        const status = err.status ?? 500;
        if (status >= 500)
            console.error('[agents/formulate] unhandled:', err);
        res.status(status).json({
            ok: false,
            error: err instanceof Error ? err.message : 'Internal server error',
        });
    }
});
// ---------------------------------------------------------------------------
// POST /api/projects/:projectId/agents/team/formulate
// AI-formulate a team-hire configuration (universe, teamSize, requiredRoles)
// from a brief prose description. Does NOT cast — returns the form payload
// for the user to review and submit through the existing propose flow.
// ---------------------------------------------------------------------------
router.post('/team/formulate', async (req, res) => {
    try {
        const { projectId } = req.params;
        const { draft } = (req.body ?? {});
        if (!draft || typeof draft !== 'string') {
            res.status(400).json({ ok: false, error: '`draft` is required' });
            return;
        }
        const result = await formulateTeamDraft(projectId, draft);
        res.json({ ok: true, data: result });
    }
    catch (err) {
        const status = err.status ?? 500;
        if (status >= 500)
            console.error('[team/formulate] unhandled:', err);
        res.status(status).json({
            ok: false,
            error: err instanceof Error ? err.message : 'Internal server error',
        });
    }
});
// ---------------------------------------------------------------------------
// POST /api/projects/:projectId/agents/hire-team/propose
// Cast a themed team from a universe without persisting.
// Body: { universe: string, teamSize?: number, requiredRoles?: string[] }
// Returns: { ok: true, data: { members: CastedMember[] } }
// ---------------------------------------------------------------------------
router.post('/hire-team/propose', async (req, res) => {
    try {
        const { projectId } = req.params;
        const { universe, teamSize, requiredRoles } = (req.body ?? {});
        if (!universe || typeof universe !== 'string') {
            res.status(400).json({ ok: false, error: '`universe` (string) is required' });
            return;
        }
        if (teamSize !== undefined && (typeof teamSize !== 'number' || !Number.isInteger(teamSize) || teamSize < 1)) {
            res.status(400).json({ ok: false, error: '`teamSize` must be a positive integer' });
            return;
        }
        if (requiredRoles !== undefined && !Array.isArray(requiredRoles)) {
            res.status(400).json({ ok: false, error: '`requiredRoles` must be an array of strings' });
            return;
        }
        if (Array.isArray(requiredRoles) && !requiredRoles.every((r) => typeof r === 'string')) {
            res.status(400).json({ ok: false, error: '`requiredRoles` must be an array of strings' });
            return;
        }
        // Verify project exists (consistent with other routes in this file)
        const squadPath = await resolveSquadPath(projectId);
        if (!squadPath) {
            res.status(404).json({ ok: false, error: 'Project not found or has no .squad/ path' });
            return;
        }
        const members = castTeam({
            universe: universe,
            teamSize: typeof teamSize === 'number' ? teamSize : undefined,
            requiredRoles: Array.isArray(requiredRoles)
                ? requiredRoles
                : undefined,
        });
        res.json({ ok: true, data: { members } });
    }
    catch (err) {
        const status = err.status ?? 500;
        if (status >= 500)
            console.error('[hire-team/propose] unhandled:', err);
        res.status(status).json({
            ok: false,
            error: err instanceof Error ? err.message : 'Internal server error',
        });
    }
});
// ---------------------------------------------------------------------------
// POST /api/projects/:projectId/agents/hire-team/confirm
// Materialise a set of casted members as real agents (files + DB rows).
// Body: { members: CastedMember[] }
// Returns: { ok: true, data: { created: Agent[], errors: { agentName, error }[] } }
// Per-member errors are collected and returned; the handler never throws 500.
// ---------------------------------------------------------------------------
router.post('/hire-team/confirm', async (req, res) => {
    try {
        const { projectId } = req.params;
        const { members } = (req.body ?? {});
        if (!Array.isArray(members) || members.length === 0) {
            res.status(400).json({ ok: false, error: '`members` must be a non-empty array' });
            return;
        }
        const squadPath = await resolveSquadPath(projectId);
        if (!squadPath) {
            res.status(404).json({ ok: false, error: 'Project not found or has no .squad/ path' });
            return;
        }
        const db = getDb();
        const created = [];
        const errors = [];
        for (const rawMember of members) {
            const member = rawMember;
            const agentName = member.agentName;
            if (!agentName || !KEBAB_RE.test(agentName)) {
                errors.push({ agentName: agentName ?? '(unknown)', error: 'Invalid or missing agentName' });
                continue;
            }
            const role = member.suggestedRoleId ?? member.role ?? 'developer';
            try {
                // Collision check (DB)
                const collision = await db
                    .select()
                    .from(schema.agents)
                    .where(and(eq(schema.agents.projectId, projectId), eq(schema.agents.name, agentName)))
                    .limit(1);
                if (collision.length > 0) {
                    errors.push({ agentName, error: `Agent "${agentName}" already exists in this project` });
                    continue;
                }
                const agentDir = path.join(squadPath, 'agents', agentName);
                const charterPath = path.join(agentDir, 'charter.md');
                const historyPath = path.join(agentDir, 'history.md');
                // Collision check (disk)
                const diskCollision = await fs.access(agentDir).then(() => true).catch(() => false);
                if (diskCollision) {
                    errors.push({ agentName, error: `Agent folder .squad/agents/${agentName} already exists on disk` });
                    continue;
                }
                await fs.mkdir(agentDir, { recursive: true });
                await writeCharter(charterPath, {
                    name: agentName,
                    role,
                    model: undefined,
                    expertise: [],
                });
                // Append persona section from the cast member's personality / backstory
                const persona = buildPersonaSection(member);
                await fs.appendFile(charterPath, '\n' + persona + '\n', 'utf-8');
                const historyContent = `# ${agentName} — History\n\n## Core Context\n\n- **Role:** ${role}\n- **Joined:** ${new Date().toISOString()}\n\n## Learnings\n\n<!-- Append learnings below -->\n`;
                await fs.writeFile(historyPath, historyContent, 'utf-8');
                const charterHash = await computeCharterHash(charterPath);
                const [inserted] = await db
                    .insert(schema.agents)
                    .values({
                    projectId,
                    name: agentName,
                    role,
                    model: null,
                    status: 'active',
                    charterPath,
                    historyPath,
                    charterHash,
                })
                    .returning();
                created.push(inserted);
            }
            catch (memberErr) {
                errors.push({
                    agentName,
                    error: memberErr instanceof Error ? memberErr.message : 'Unexpected error',
                });
            }
        }
        res.json({ ok: true, data: { created, errors } });
    }
    catch (err) {
        const status = err.status ?? 500;
        if (status >= 500)
            console.error('[hire-team/confirm] unhandled:', err);
        res.status(status).json({
            ok: false,
            error: err instanceof Error ? err.message : 'Internal server error',
        });
    }
});
// ---------------------------------------------------------------------------
// GET /api/projects/:projectId/agents/:id
// Agent details + recent history excerpt (last 20 lines of history.md)
// ---------------------------------------------------------------------------
router.get('/:id', async (req, res) => {
    const { projectId, id } = req.params;
    const db = getDb();
    const [agent] = await db
        .select()
        .from(schema.agents)
        .where(and(eq(schema.agents.projectId, projectId), eq(schema.agents.id, id)))
        .limit(1);
    if (!agent) {
        res.status(404).json({ ok: false, error: 'Agent not found' });
        return;
    }
    let historyExcerpt = null;
    if (agent.historyPath) {
        historyExcerpt = await fs
            .readFile(agent.historyPath, 'utf-8')
            .then((content) => content.split('\n').slice(-20).join('\n'))
            .catch(() => null);
    }
    res.json({ ok: true, data: { ...agent, historyExcerpt } });
});
// ---------------------------------------------------------------------------
// PATCH /api/projects/:projectId/agents/:id
// Update agent fields: role, model, status
// ---------------------------------------------------------------------------
router.patch('/:id', async (req, res) => {
    const { projectId, id } = req.params;
    const { role, model, status } = req.body;
    const db = getDb();
    const [agent] = await db
        .select()
        .from(schema.agents)
        .where(and(eq(schema.agents.projectId, projectId), eq(schema.agents.id, id)))
        .limit(1);
    if (!agent) {
        res.status(404).json({ ok: false, error: 'Agent not found' });
        return;
    }
    const updates = { updatedAt: new Date() };
    if (role !== undefined)
        updates.role = role;
    if (model !== undefined)
        updates.model = model;
    if (status !== undefined)
        updates.status = status;
    const [updated] = await db
        .update(schema.agents)
        .set(updates)
        .where(eq(schema.agents.id, id))
        .returning();
    res.json({ ok: true, data: updated });
});
// ---------------------------------------------------------------------------
// DELETE /api/projects/:projectId/agents/:id
// Disable agent (status='disabled'); file on disk is untouched.
// ---------------------------------------------------------------------------
router.delete('/:id', async (req, res) => {
    const { projectId, id } = req.params;
    const db = getDb();
    const [agent] = await db
        .select()
        .from(schema.agents)
        .where(and(eq(schema.agents.projectId, projectId), eq(schema.agents.id, id)))
        .limit(1);
    if (!agent) {
        res.status(404).json({ ok: false, error: 'Agent not found' });
        return;
    }
    const [updated] = await db
        .update(schema.agents)
        .set({ status: 'disabled', updatedAt: new Date() })
        .where(eq(schema.agents.id, id))
        .returning();
    res.json({ ok: true, data: updated });
});
// ---------------------------------------------------------------------------
// GET /api/projects/:projectId/agents/:id/charter
// Return raw charter.md content
// ---------------------------------------------------------------------------
router.get('/:id/charter', async (req, res) => {
    const { projectId, id } = req.params;
    const db = getDb();
    const [agent] = await db
        .select()
        .from(schema.agents)
        .where(and(eq(schema.agents.projectId, projectId), eq(schema.agents.id, id)))
        .limit(1);
    if (!agent) {
        res.status(404).json({ ok: false, error: 'Agent not found' });
        return;
    }
    const content = await fs.readFile(agent.charterPath, 'utf-8').catch(() => null);
    if (content === null) {
        res.status(404).json({ ok: false, error: 'Charter file not found on disk' });
        return;
    }
    res.json({ ok: true, data: { charterPath: agent.charterPath, content } });
});
// ---------------------------------------------------------------------------
// PATCH /api/projects/:projectId/agents/:id/charter
// Overwrite charter on disk and update hash in DB.
// Body: { content: string }
// ---------------------------------------------------------------------------
router.patch('/:id/charter', async (req, res) => {
    const { projectId, id } = req.params;
    const { content } = req.body;
    if (typeof content !== 'string') {
        res.status(400).json({ ok: false, error: '`content` (string) is required' });
        return;
    }
    const db = getDb();
    const [agent] = await db
        .select()
        .from(schema.agents)
        .where(and(eq(schema.agents.projectId, projectId), eq(schema.agents.id, id)))
        .limit(1);
    if (!agent) {
        res.status(404).json({ ok: false, error: 'Agent not found' });
        return;
    }
    await fs.writeFile(agent.charterPath, content, 'utf-8');
    const newHash = await computeCharterHash(agent.charterPath);
    // Re-parse to keep role/model in sync
    const meta = await parseCharter(agent.charterPath).catch(() => null);
    const [updated] = await db
        .update(schema.agents)
        .set({
        charterHash: newHash,
        role: meta?.role ?? agent.role,
        model: meta?.model ?? agent.model,
        updatedAt: new Date(),
    })
        .where(eq(schema.agents.id, id))
        .returning();
    res.json({ ok: true, data: updated });
});
export default router;
//# sourceMappingURL=agents.js.map