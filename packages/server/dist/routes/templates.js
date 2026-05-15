/**
 * templates.ts — Phase 19 Templates CRUD routes
 *
 * Mounts at /api/templates
 *
 * GET    /              list all templates; filter by ?kind=workflow|team|project
 * GET    /:id           get single template (with full payload)
 * DELETE /:id           delete template
 *
 * Response envelope (uniform with the other portability routes — see
 * packages/client/src/api/templates.ts r5 contract):
 *
 *   GET  /               { ok: true, data: { templates: TemplateSummary[] } }
 *   GET  /:id            { ok: true, data: { template: TemplateDetail } }
 *   DELETE /:id          { ok: true, data: { template: TemplateSummary } }
 *
 * Wave 10 B1: previously these returned `{ data: rows }` / `{ data: tmpl }`
 * which caused `useTemplates`/`useTemplate` (which read `.data.templates` /
 * `.data.template`) to silently see `undefined` → empty list → "No project
 * templates yet" even when project templates existed, breaking the entire
 * Create-from-template flow on the Projects page.
 */
import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
const router = Router();
// Pick only the summary columns the client needs in list views — `payload` is
// often large (full project bundle) and is only required from GET /:id.
function toSummary(row) {
    return {
        id: row.id,
        kind: row.kind,
        name: row.name,
        description: row.description ?? null,
        createdAt: row.createdAt,
        // Stream D — D7: expose projectId so the Templates page can offer a
        // "My templates" filter scoped to the active project.
        projectId: row.projectId ?? null,
    };
}
// ---------------------------------------------------------------------------
// GET /api/templates
// ---------------------------------------------------------------------------
router.get('/', async (req, res) => {
    try {
        const db = getDb();
        const { kind } = req.query;
        const rows = kind
            ? await db.select().from(schema.templates).where(eq(schema.templates.kind, kind))
            : await db.select().from(schema.templates);
        res.json({ ok: true, data: { templates: rows.map(toSummary) } });
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        res.status(500).json({ ok: false, error: msg });
    }
});
// ---------------------------------------------------------------------------
// GET /api/templates/:id
// ---------------------------------------------------------------------------
router.get('/:id', async (req, res) => {
    try {
        const db = getDb();
        const [tmpl] = await db
            .select()
            .from(schema.templates)
            .where(eq(schema.templates.id, req.params.id))
            .limit(1);
        if (!tmpl) {
            res.status(404).json({ ok: false, error: 'Template not found' });
            return;
        }
        res.json({
            ok: true,
            data: {
                template: {
                    ...toSummary(tmpl),
                    payload: tmpl.payload,
                },
            },
        });
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        res.status(500).json({ ok: false, error: msg });
    }
});
// ---------------------------------------------------------------------------
// DELETE /api/templates/:id
// ---------------------------------------------------------------------------
router.delete('/:id', async (req, res) => {
    try {
        const db = getDb();
        const deleted = await db
            .delete(schema.templates)
            .where(eq(schema.templates.id, req.params.id))
            .returning();
        if (!deleted.length) {
            res.status(404).json({ ok: false, error: 'Template not found' });
            return;
        }
        res.json({ ok: true, data: { template: toSummary(deleted[0]) } });
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        res.status(500).json({ ok: false, error: msg });
    }
});
export default router;
//# sourceMappingURL=templates.js.map