/**
 * services/skills.ts — Phase 13
 *
 * CRUD + per-agent assignment for the project-scoped Skills registry.
 * A "skill" is a prompt-augmentation snippet (`promptAddendum`) that gets
 * prepended to an agent's effective system prompt when the skill is
 * assigned. Skills can be cloned from the bundled curated library
 * (`data/curated-skills.json`) or authored from scratch.
 */
import { and, eq, inArray } from 'drizzle-orm';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb, schema } from '../db/index.js';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CURATED_PATH = path.resolve(__dirname, '..', 'data', 'curated-skills.json');
let _curatedCache = null;
export async function loadCuratedSkills() {
    if (_curatedCache)
        return _curatedCache;
    const raw = await fs.readFile(CURATED_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    _curatedCache = parsed;
    return parsed;
}
export async function listSkills(projectId) {
    const db = getDb();
    return db
        .select()
        .from(schema.skills)
        .where(eq(schema.skills.projectId, projectId))
        .orderBy(schema.skills.category, schema.skills.name);
}
export async function getSkill(projectId, skillId) {
    const db = getDb();
    const rows = await db
        .select()
        .from(schema.skills)
        .where(and(eq(schema.skills.projectId, projectId), eq(schema.skills.id, skillId)))
        .limit(1);
    return rows[0] ?? null;
}
export async function createSkill(projectId, input) {
    const db = getDb();
    const [row] = await db
        .insert(schema.skills)
        .values({
        projectId,
        key: input.key,
        name: input.name,
        description: input.description ?? null,
        category: input.category ?? null,
        promptAddendum: input.promptAddendum,
        curatedKey: input.curatedKey ?? null,
    })
        .returning();
    return row;
}
export async function updateSkill(projectId, skillId, input) {
    const db = getDb();
    const patch = { updatedAt: new Date() };
    if (input.key !== undefined)
        patch.key = input.key;
    if (input.name !== undefined)
        patch.name = input.name;
    if (input.description !== undefined)
        patch.description = input.description;
    if (input.category !== undefined)
        patch.category = input.category;
    if (input.promptAddendum !== undefined)
        patch.promptAddendum = input.promptAddendum;
    const [row] = await db
        .update(schema.skills)
        .set(patch)
        .where(and(eq(schema.skills.projectId, projectId), eq(schema.skills.id, skillId)))
        .returning();
    return row ?? null;
}
export async function deleteSkill(projectId, skillId) {
    const db = getDb();
    const result = await db
        .delete(schema.skills)
        .where(and(eq(schema.skills.projectId, projectId), eq(schema.skills.id, skillId)))
        .returning({ id: schema.skills.id });
    return result.length > 0;
}
/**
 * Clone a curated skill into the project's skills registry. Idempotent:
 * if a skill with the same `key` already exists in the project, returns
 * the existing row instead of creating a duplicate.
 */
export async function cloneCuratedSkill(projectId, curatedKey) {
    const curated = await loadCuratedSkills();
    const entry = curated.find((c) => c.key === curatedKey);
    if (!entry) {
        const err = new Error(`Curated skill not found: ${curatedKey}`);
        err.status = 404;
        throw err;
    }
    const db = getDb();
    const existing = await db
        .select()
        .from(schema.skills)
        .where(and(eq(schema.skills.projectId, projectId), eq(schema.skills.key, entry.key)))
        .limit(1);
    if (existing[0])
        return existing[0];
    return createSkill(projectId, {
        key: entry.key,
        name: entry.name,
        description: entry.description,
        category: entry.category,
        promptAddendum: entry.promptAddendum,
        curatedKey: entry.key,
    });
}
// ---------------------------------------------------------------------------
// Agent assignment
// ---------------------------------------------------------------------------
export async function listAgentSkills(projectId, agentId) {
    const db = getDb();
    return db
        .select({
        id: schema.skills.id,
        projectId: schema.skills.projectId,
        key: schema.skills.key,
        name: schema.skills.name,
        description: schema.skills.description,
        category: schema.skills.category,
        promptAddendum: schema.skills.promptAddendum,
        curatedKey: schema.skills.curatedKey,
        createdAt: schema.skills.createdAt,
        updatedAt: schema.skills.updatedAt,
        assignedAt: schema.agentSkills.assignedAt,
    })
        .from(schema.agentSkills)
        .innerJoin(schema.skills, eq(schema.agentSkills.skillId, schema.skills.id))
        .where(and(eq(schema.agentSkills.agentId, agentId), eq(schema.skills.projectId, projectId)))
        .orderBy(schema.skills.category, schema.skills.name);
}
export async function assignSkillsToAgent(projectId, agentId, skillIds) {
    if (skillIds.length === 0)
        return { assigned: [], skipped: [] };
    const db = getDb();
    // Validate that every skillId actually belongs to this project.
    const valid = await db
        .select({ id: schema.skills.id })
        .from(schema.skills)
        .where(and(eq(schema.skills.projectId, projectId), inArray(schema.skills.id, skillIds)));
    const validIds = new Set(valid.map((r) => r.id));
    const skipped = skillIds.filter((id) => !validIds.has(id));
    if (validIds.size === 0)
        return { assigned: [], skipped };
    const inserted = await db
        .insert(schema.agentSkills)
        .values(Array.from(validIds).map((skillId) => ({ agentId, skillId })))
        .onConflictDoNothing()
        .returning({ skillId: schema.agentSkills.skillId });
    return { assigned: inserted.map((r) => r.skillId), skipped };
}
export async function unassignSkillFromAgent(agentId, skillId) {
    const db = getDb();
    const result = await db
        .delete(schema.agentSkills)
        .where(and(eq(schema.agentSkills.agentId, agentId), eq(schema.agentSkills.skillId, skillId)))
        .returning({ skillId: schema.agentSkills.skillId });
    return result.length > 0;
}
//# sourceMappingURL=skills.js.map