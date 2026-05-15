/**
 * team-portability.ts — Phase 19 team export/import routes
 *
 * Mounts at /api/projects/:id/team
 *
 * POST /export                             → { ok, data: { payload: TeamPayload } }
 * POST /import                             → { ok, data: { imported, skipped } }
 * POST /save-as-template                   → { ok, data: { template: { id, kind, name, description, createdAt } } }
 * POST /instantiate-template/:templateId   → { ok, data: { imported, skipped } }
 *
 * Wave 10 B7: previously /export returned the bare TeamPayload at `data` and
 * /save-as-template returned `{ templateId }`, both of which mismatched the
 * client hooks `useExportTeam` (reads `.payload`) and `useSaveTeamAsTemplate`
 * (reads `.template`). Aligned with the project-portability conventions so
 * the team round-trip survives the same Hockney r5 envelope contract.
 */
import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { exportTeam, importTeam, saveAsTemplate, instantiateTemplate, } from '../services/templates/team-template.js';
const router = Router({ mergeParams: true });
async function fetchTemplateSummary(id) {
    const db = getDb();
    const [row] = await db
        .select()
        .from(schema.templates)
        .where(eq(schema.templates.id, id))
        .limit(1);
    if (!row)
        return null;
    return {
        id: row.id,
        kind: row.kind,
        name: row.name,
        description: row.description ?? null,
        createdAt: row.createdAt,
    };
}
// ---------------------------------------------------------------------------
// POST /api/projects/:id/team/export
// ---------------------------------------------------------------------------
router.post('/export', async (req, res) => {
    try {
        const projectId = req.params.id;
        const payload = await exportTeam(projectId);
        res.json({ ok: true, data: { payload } });
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        res.status(500).json({ ok: false, error: msg });
    }
});
// ---------------------------------------------------------------------------
// POST /api/projects/:id/team/import
// Body: { payload: TeamPayload, force?: boolean }
// ---------------------------------------------------------------------------
router.post('/import', async (req, res) => {
    try {
        const projectId = req.params.id;
        const { payload, force } = req.body;
        if (!payload || !Array.isArray(payload.agents)) {
            res.status(400).json({ ok: false, error: '`payload.agents` array is required' });
            return;
        }
        const result = await importTeam(projectId, payload, { force: Boolean(force) });
        res.json({ ok: true, data: result });
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        res.status(500).json({ ok: false, error: msg });
    }
});
// ---------------------------------------------------------------------------
// POST /api/projects/:id/team/save-as-template
// Body: { name: string, description?: string }
// ---------------------------------------------------------------------------
router.post('/save-as-template', async (req, res) => {
    try {
        const projectId = req.params.id;
        const { name, description } = req.body;
        if (!name?.trim()) {
            res.status(400).json({ ok: false, error: '`name` is required' });
            return;
        }
        const { templateId, storagePath, storageError } = await saveAsTemplate(projectId, name.trim(), description);
        const template = await fetchTemplateSummary(templateId);
        res.status(201).json({
            ok: true,
            data: {
                template: template ?? {
                    id: templateId,
                    kind: 'team',
                    name: name.trim(),
                    description: description ?? null,
                    createdAt: new Date().toISOString(),
                },
                // Stream D — D7
                storagePath,
                storageError,
            },
        });
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        res.status(500).json({ ok: false, error: msg });
    }
});
// ---------------------------------------------------------------------------
// POST /api/projects/:id/team/instantiate-template/:templateId
// Body: { force?: boolean }
// ---------------------------------------------------------------------------
router.post('/instantiate-template/:templateId', async (req, res) => {
    try {
        const projectId = req.params.id;
        const templateId = req.params.templateId;
        const { force } = req.body;
        const result = await instantiateTemplate(projectId, templateId, { force: Boolean(force) });
        res.json({ ok: true, data: result });
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const status = err instanceof Error && err.message.includes('not found') ? 404 : 500;
        res.status(status).json({ ok: false, error: msg });
    }
});
export default router;
//# sourceMappingURL=team-portability.js.map