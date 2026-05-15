/**
 * review-policies.ts — Phase 8 REST surface
 *
 *   GET    /api/projects/:projectId/review-policies/presets
 *     → { system: ReviewPolicyPreset[], project: ReviewPolicyPreset[] }
 *
 *   POST   /api/projects/:projectId/review-policies/presets
 *     body { slug, name, description?, payload }
 *     → ReviewPolicyPreset (creates a project-scope preset)
 *
 *   PATCH  /api/projects/:projectId/review-policies/presets/:slug
 *     body { name?, description?, payload? }
 *     → ReviewPolicyPreset (project-scope only; system rejected)
 *
 *   DELETE /api/projects/:projectId/review-policies/presets/:slug
 *     → { ok: true } (project-scope only)
 *
 *   GET    /api/projects/:projectId/review-policies/default
 *     → { default: ReviewPolicyPayload | null, sources, warnings }
 *       Returns the resolved project-scope policy with the system default
 *       merged in, plus the per-field source map (board scope is never
 *       loaded here — only project + system_default contribute).
 *
 *   PUT    /api/projects/:projectId/review-policies/default
 *     body { payload }
 *     → ReviewPolicyDefault (upserts the project default)
 *
 *   DELETE /api/projects/:projectId/review-policies/default
 *     → { ok: true } (clears the project default; resolver falls back to
 *       system_default for that project)
 *
 * Board-scope writes are intentionally rejected with 400 until the boards
 * table lands (Phase 8 boards work).
 */
import { Router } from 'express';
import { eq, and, or, isNull, sql } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { validatePolicyPayload, loadProjectDefault, resolvePolicyForDeliverable, } from '../services/review-policy-resolver.js';
const router = Router({ mergeParams: true });
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function badRequest(res, error, details) {
    res.status(400).json({ ok: false, error, details });
}
function notFound(res, error) {
    res.status(404).json({ ok: false, error });
}
async function ensureProjectExists(projectId) {
    const db = getDb();
    const rows = await db
        .select({ id: schema.projects.id })
        .from(schema.projects)
        .where(eq(schema.projects.id, projectId))
        .limit(1);
    return rows.length > 0;
}
// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------
router.get('/presets', async (req, res) => {
    const { projectId } = req.params;
    if (!(await ensureProjectExists(projectId))) {
        notFound(res, 'Project not found');
        return;
    }
    const db = getDb();
    const rows = await db
        .select()
        .from(schema.reviewPolicyPresets)
        .where(or(eq(schema.reviewPolicyPresets.scope, 'system'), and(eq(schema.reviewPolicyPresets.scope, 'project'), eq(schema.reviewPolicyPresets.projectId, projectId))));
    const system = rows.filter((r) => r.scope === 'system').sort(byName);
    const project = rows.filter((r) => r.scope === 'project').sort(byName);
    res.json({ ok: true, data: { system, project } });
});
router.post('/presets', async (req, res) => {
    const { projectId } = req.params;
    if (!(await ensureProjectExists(projectId))) {
        notFound(res, 'Project not found');
        return;
    }
    const body = (req.body ?? {});
    const slug = typeof body.slug === 'string' ? body.slug.trim() : '';
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!slug || !/^[a-z0-9_-]+$/.test(slug)) {
        badRequest(res, 'slug must be a non-empty string of [a-z0-9_-]');
        return;
    }
    if (!name) {
        badRequest(res, 'name is required');
        return;
    }
    const validated = validatePolicyPayload(body.payload);
    if (!validated.ok) {
        badRequest(res, 'invalid payload', validated.errors);
        return;
    }
    const db = getDb();
    // Reject if a project preset with this slug already exists.
    const existing = await db
        .select({ id: schema.reviewPolicyPresets.id })
        .from(schema.reviewPolicyPresets)
        .where(and(eq(schema.reviewPolicyPresets.scope, 'project'), eq(schema.reviewPolicyPresets.projectId, projectId), eq(schema.reviewPolicyPresets.slug, slug)))
        .limit(1);
    if (existing.length > 0) {
        res.status(409).json({ ok: false, error: `preset with slug '${slug}' already exists` });
        return;
    }
    const [created] = await db
        .insert(schema.reviewPolicyPresets)
        .values({
        scope: 'project',
        projectId,
        slug,
        name,
        description: typeof body.description === 'string' ? body.description : null,
        payload: validated.payload,
    })
        .returning();
    res.status(201).json({ ok: true, data: created });
});
router.patch('/presets/:slug', async (req, res) => {
    const { projectId, slug } = req.params;
    if (!(await ensureProjectExists(projectId))) {
        notFound(res, 'Project not found');
        return;
    }
    const db = getDb();
    const [existing] = await db
        .select()
        .from(schema.reviewPolicyPresets)
        .where(and(eq(schema.reviewPolicyPresets.scope, 'project'), eq(schema.reviewPolicyPresets.projectId, projectId), eq(schema.reviewPolicyPresets.slug, slug)))
        .limit(1);
    if (!existing) {
        notFound(res, `project preset '${slug}' not found (system presets are immutable)`);
        return;
    }
    const body = (req.body ?? {});
    const updates = { updatedAt: new Date() };
    if (typeof body.name === 'string')
        updates['name'] = body.name.trim();
    if (typeof body.description === 'string')
        updates['description'] = body.description;
    if (body.payload !== undefined) {
        const validated = validatePolicyPayload(body.payload);
        if (!validated.ok) {
            badRequest(res, 'invalid payload', validated.errors);
            return;
        }
        updates['payload'] = validated.payload;
    }
    const [updated] = await db
        .update(schema.reviewPolicyPresets)
        .set(updates)
        .where(eq(schema.reviewPolicyPresets.id, existing.id))
        .returning();
    res.json({ ok: true, data: updated });
});
router.delete('/presets/:slug', async (req, res) => {
    const { projectId, slug } = req.params;
    if (!(await ensureProjectExists(projectId))) {
        notFound(res, 'Project not found');
        return;
    }
    const db = getDb();
    const result = await db
        .delete(schema.reviewPolicyPresets)
        .where(and(eq(schema.reviewPolicyPresets.scope, 'project'), eq(schema.reviewPolicyPresets.projectId, projectId), eq(schema.reviewPolicyPresets.slug, slug)))
        .returning({ id: schema.reviewPolicyPresets.id });
    if (result.length === 0) {
        notFound(res, `project preset '${slug}' not found`);
        return;
    }
    res.json({ ok: true });
});
// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------
router.get('/default', async (req, res) => {
    const { projectId } = req.params;
    if (!(await ensureProjectExists(projectId))) {
        notFound(res, 'Project not found');
        return;
    }
    const projectDefault = await loadProjectDefault(projectId);
    const resolved = resolvePolicyForDeliverable({ project: projectDefault });
    res.json({
        ok: true,
        data: {
            stored: projectDefault ?? null,
            resolved: resolved.policy,
            sources: resolved.sources,
            warnings: resolved.warnings,
        },
    });
});
router.put('/default', async (req, res) => {
    const { projectId } = req.params;
    if (!(await ensureProjectExists(projectId))) {
        notFound(res, 'Project not found');
        return;
    }
    const body = (req.body ?? {});
    const validated = validatePolicyPayload(body.payload);
    if (!validated.ok) {
        badRequest(res, 'invalid payload', validated.errors);
        return;
    }
    const db = getDb();
    // Upsert via the partial unique index on (scope, scope_id).
    await db
        .insert(schema.reviewPolicyDefaults)
        .values({
        scope: 'project',
        scopeId: projectId,
        payload: validated.payload,
    })
        .onConflictDoUpdate({
        target: [schema.reviewPolicyDefaults.scope, schema.reviewPolicyDefaults.scopeId],
        set: {
            payload: validated.payload,
            updatedAt: new Date(),
        },
    });
    const [row] = await db
        .select()
        .from(schema.reviewPolicyDefaults)
        .where(and(eq(schema.reviewPolicyDefaults.scope, 'project'), eq(schema.reviewPolicyDefaults.scopeId, projectId)))
        .limit(1);
    res.json({ ok: true, data: row });
});
router.delete('/default', async (req, res) => {
    const { projectId } = req.params;
    if (!(await ensureProjectExists(projectId))) {
        notFound(res, 'Project not found');
        return;
    }
    const db = getDb();
    await db
        .delete(schema.reviewPolicyDefaults)
        .where(and(eq(schema.reviewPolicyDefaults.scope, 'project'), eq(schema.reviewPolicyDefaults.scopeId, projectId)));
    res.json({ ok: true });
});
// Future: GET/PUT/DELETE /default/board/:boardId — wired once boards land.
// Kept here as a placeholder so the surface is one-stop.
router.put('/default/board/:boardId', (_req, res) => {
    badRequest(res, 'board-scope review-policy defaults are not yet supported (boards table not yet shipped)');
});
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function byName(a, b) {
    return a.name.localeCompare(b.name);
}
// Touch sql to silence an unused-import lint if drizzle-kit ever adds one.
void sql;
void isNull;
export default router;
//# sourceMappingURL=review-policies.js.map