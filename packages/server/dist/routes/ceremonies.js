/**
 * ceremonies.ts — Phase 10 ceremony API surface
 *
 * Ceremonies are the unification of workflows + scheduled jobs + event
 * reactions + narrative documentation. The DB tables stay named
 * `workflows*` for migration cost reasons (see Phase 10 plan); the rename
 * happens at the API + UI boundary.
 *
 * Mounts:
 *   ceremoniesRouter        → /api/projects/:projectId/ceremonies
 *   ceremoniesTopRouter     → /api/ceremonies          (templates, validate)
 *
 * Endpoints (project-scoped):
 *   GET    /                         list (filters: kind, triggerKind)
 *   POST   /                         create (yamlContent + triggerKind + …)
 *   GET    /:id                      get + active version + versions[]
 *   PATCH  /:id                      update name/desc/triggerKind/triggerConfig/kind/yaml
 *   DELETE /:id                      archive (deactivate all versions)
 *   POST   /:id/run                  ad-hoc spawn (Run-now button)
 *   POST   /:id/preview-cron         { cronExpr, timezone?, count? } → next N
 *   POST   /:id/convert              501 (Phase 11 narrative → executable)
 *   GET    /:id/schedules            list ceremony_schedules
 *   POST   /:id/schedules            create
 *   PATCH  /:id/schedules/:sId       update
 *   DELETE /:id/schedules/:sId       delete
 *
 * Endpoints (top-level):
 *   GET    /templates                bundled templates
 *   POST   /validate                 { yamlContent } → { valid, errors }
 */
import { Router } from 'express';
import { eq, and, sql } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { parseWorkflowYaml, validateWorkflowYaml } from '../services/workflow-parser.js';
import { spawnCeremonyRun, previewNextFireTimes, computeNextFire, } from '../services/ceremony-scheduler.js';
import { convertNarrativeToExecutable } from '../services/narrative-bridge.js';
import { getBuiltinTemplates } from '../workflows/templates/index.js';
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const VALID_TRIGGER_KINDS = ['on_issue_entry', 'on_schedule', 'on_event', 'manual'];
const VALID_KINDS = ['workflow', 'ceremony', 'review_policy', 'narrative'];
function handleError(res, err) {
    console.error('[ceremonies] error:', err);
    const msg = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: msg });
}
function isValidTriggerKind(s) {
    return typeof s === 'string' && VALID_TRIGGER_KINDS.includes(s);
}
function isValidKind(s) {
    return typeof s === 'string' && VALID_KINDS.includes(s);
}
function slugify(name) {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}
// ---------------------------------------------------------------------------
// ceremoniesRouter — project-scoped
// ---------------------------------------------------------------------------
export const ceremoniesRouter = Router({ mergeParams: true });
// GET / — list ceremonies for a project (filters: kind, triggerKind)
ceremoniesRouter.get('/', async (req, res) => {
    try {
        const { projectId } = req.params;
        const { kind, triggerKind } = req.query;
        const db = getDb();
        const conditions = [eq(schema.workflows.projectId, projectId)];
        if (kind)
            conditions.push(eq(schema.workflows.kind, kind));
        if (triggerKind)
            conditions.push(eq(schema.workflows.triggerKind, triggerKind));
        const rows = await db
            .select()
            .from(schema.workflows)
            .where(and(...conditions));
        res.json(rows);
    }
    catch (err) {
        handleError(res, err);
    }
});
// POST / — create a ceremony.
// Body: { yamlContent, triggerKind?, triggerConfig?, kind? }
ceremoniesRouter.post('/', async (req, res) => {
    try {
        const { projectId } = req.params;
        const { yamlContent, triggerKind = 'on_issue_entry', triggerConfig = {}, kind = 'ceremony', } = req.body;
        if (!yamlContent) {
            res.status(400).json({ error: '`yamlContent` is required' });
            return;
        }
        if (!isValidTriggerKind(triggerKind)) {
            res.status(400).json({ error: `triggerKind must be one of: ${VALID_TRIGGER_KINDS.join(', ')}` });
            return;
        }
        if (!isValidKind(kind)) {
            res.status(400).json({ error: `kind must be one of: ${VALID_KINDS.join(', ')}` });
            return;
        }
        const { valid, errors } = validateWorkflowYaml(yamlContent);
        if (!valid) {
            res.status(422).json({ error: 'Invalid ceremony YAML', errors });
            return;
        }
        const definition = await parseWorkflowYaml(yamlContent);
        const slug = slugify(definition.name);
        const db = getDb();
        const [workflow] = await db
            .insert(schema.workflows)
            .values({
            projectId,
            name: definition.name,
            slug,
            description: definition.description,
            triggerKind,
            triggerConfig,
            kind,
        })
            .returning();
        const [version] = await db
            .insert(schema.workflowVersions)
            .values({
            workflowId: workflow.id,
            version: 1,
            yamlContent,
            jsonSchema: definition.outputSchema ? JSON.stringify(definition.outputSchema) : null,
            isActive: true,
        })
            .returning();
        res.status(201).json({ ceremony: workflow, version });
    }
    catch (err) {
        handleError(res, err);
    }
});
// GET /:id
ceremoniesRouter.get('/:id', async (req, res) => {
    try {
        const { projectId, id } = req.params;
        const db = getDb();
        const [workflow] = await db
            .select()
            .from(schema.workflows)
            .where(and(eq(schema.workflows.id, id), eq(schema.workflows.projectId, projectId)))
            .limit(1);
        if (!workflow) {
            res.status(404).json({ error: 'Ceremony not found' });
            return;
        }
        const versions = await db
            .select()
            .from(schema.workflowVersions)
            .where(eq(schema.workflowVersions.workflowId, id));
        const activeVersion = versions.find((v) => v.isActive) ?? versions[versions.length - 1] ?? null;
        res.json({ ceremony: workflow, activeVersion, versions });
    }
    catch (err) {
        handleError(res, err);
    }
});
// PATCH /:id — update metadata + (optionally) yaml. New yaml ⇒ new version.
ceremoniesRouter.patch('/:id', async (req, res) => {
    try {
        const { projectId, id } = req.params;
        const body = req.body;
        if (body.triggerKind !== undefined && !isValidTriggerKind(body.triggerKind)) {
            res.status(400).json({ error: `triggerKind must be one of: ${VALID_TRIGGER_KINDS.join(', ')}` });
            return;
        }
        if (body.kind !== undefined && !isValidKind(body.kind)) {
            res.status(400).json({ error: `kind must be one of: ${VALID_KINDS.join(', ')}` });
            return;
        }
        const db = getDb();
        const [workflow] = await db
            .select()
            .from(schema.workflows)
            .where(and(eq(schema.workflows.id, id), eq(schema.workflows.projectId, projectId)))
            .limit(1);
        if (!workflow) {
            res.status(404).json({ error: 'Ceremony not found' });
            return;
        }
        let newVersion = null;
        if (body.yamlContent !== undefined) {
            const { valid, errors } = validateWorkflowYaml(body.yamlContent);
            if (!valid) {
                res.status(422).json({ error: 'Invalid ceremony YAML', errors });
                return;
            }
            const definition = await parseWorkflowYaml(body.yamlContent);
            const existing = await db
                .select({ version: schema.workflowVersions.version })
                .from(schema.workflowVersions)
                .where(eq(schema.workflowVersions.workflowId, id));
            const nextVer = existing.length > 0 ? Math.max(...existing.map((v) => v.version)) + 1 : 1;
            await db
                .update(schema.workflowVersions)
                .set({ isActive: false })
                .where(and(eq(schema.workflowVersions.workflowId, id), eq(schema.workflowVersions.isActive, true)));
            const [created] = await db
                .insert(schema.workflowVersions)
                .values({
                workflowId: id,
                version: nextVer,
                yamlContent: body.yamlContent,
                jsonSchema: definition.outputSchema ? JSON.stringify(definition.outputSchema) : null,
                isActive: true,
            })
                .returning();
            newVersion = created;
            // Auto-sync ceremony name/description from YAML when yaml is updated.
            if (body.name === undefined)
                body.name = definition.name;
            if (body.description === undefined && definition.description) {
                body.description = definition.description;
            }
        }
        const updates = { updatedAt: new Date() };
        if (body.name !== undefined) {
            updates.name = body.name;
            updates.slug = slugify(body.name);
        }
        if (body.description !== undefined)
            updates.description = body.description;
        if (body.triggerKind !== undefined)
            updates.triggerKind = body.triggerKind;
        if (body.triggerConfig !== undefined)
            updates.triggerConfig = body.triggerConfig;
        if (body.kind !== undefined)
            updates.kind = body.kind;
        const [updated] = await db
            .update(schema.workflows)
            .set(updates)
            .where(eq(schema.workflows.id, id))
            .returning();
        res.json({ ceremony: updated, version: newVersion });
    }
    catch (err) {
        handleError(res, err);
    }
});
// DELETE /:id — archive (deactivate all versions). Schedules cascade-deleted.
ceremoniesRouter.delete('/:id', async (req, res) => {
    try {
        const { projectId, id } = req.params;
        const db = getDb();
        const [workflow] = await db
            .select()
            .from(schema.workflows)
            .where(and(eq(schema.workflows.id, id), eq(schema.workflows.projectId, projectId)))
            .limit(1);
        if (!workflow) {
            res.status(404).json({ error: 'Ceremony not found' });
            return;
        }
        await db
            .update(schema.workflowVersions)
            .set({ isActive: false })
            .where(eq(schema.workflowVersions.workflowId, id));
        res.json({ message: 'Ceremony archived', ceremonyId: id });
    }
    catch (err) {
        handleError(res, err);
    }
});
// POST /:id/run — ad-hoc spawn (Run-now button). Body may include
// { anchorIssueId?: string }.
ceremoniesRouter.post('/:id/run', async (req, res) => {
    try {
        const { projectId, id } = req.params;
        const { anchorIssueId } = (req.body ?? {});
        const db = getDb();
        const [workflow] = await db
            .select()
            .from(schema.workflows)
            .where(and(eq(schema.workflows.id, id), eq(schema.workflows.projectId, projectId)))
            .limit(1);
        if (!workflow) {
            res.status(404).json({ error: 'Ceremony not found' });
            return;
        }
        const runId = await spawnCeremonyRun(id, {
            trigger: 'manual',
            anchorIssueId,
        });
        if (!runId) {
            res.status(409).json({
                error: 'Could not spawn ceremony run — no active version, no anchor issue, or kind=narrative',
            });
            return;
        }
        res.status(201).json({ workflowRunId: runId, message: 'Ceremony run started' });
    }
    catch (err) {
        handleError(res, err);
    }
});
// POST /:id/preview-cron — body { cronExpr, timezone?, count? }
// Returns the next N fire times. Used by the rich editor.
ceremoniesRouter.post('/:id/preview-cron', (req, res) => {
    try {
        const { cronExpr, timezone, count } = req.body;
        if (!cronExpr || typeof cronExpr !== 'string') {
            res.status(400).json({ error: '`cronExpr` is required' });
            return;
        }
        const n = Math.min(Math.max(typeof count === 'number' ? count : 3, 1), 10);
        const next = previewNextFireTimes(cronExpr, n, timezone ?? 'UTC');
        res.json({ cronExpr, timezone: timezone ?? 'UTC', next });
    }
    catch (err) {
        res
            .status(400)
            .json({ error: 'Invalid cron expression', details: err instanceof Error ? err.message : String(err) });
    }
});
// POST /:id/convert — 501 stub for Phase 11
ceremoniesRouter.post('/:id/convert', async (req, res) => {
    try {
        const { id } = req.params;
        await convertNarrativeToExecutable(id);
        // Should never reach here in Phase 10.
        res.status(200).json({ ceremonyId: id });
    }
    catch (err) {
        if (err instanceof Error && err.message.includes('NotImplemented')) {
            res.status(501).json({
                error: 'narrative-bridge not yet implemented (Phase 11)',
            });
            return;
        }
        handleError(res, err);
    }
});
// ---------------------------------------------------------------------------
// Schedule CRUD — /:id/schedules
// ---------------------------------------------------------------------------
ceremoniesRouter.get('/:id/schedules', async (req, res) => {
    try {
        const { id } = req.params;
        const db = getDb();
        const rows = await db
            .select()
            .from(schema.ceremonySchedules)
            .where(eq(schema.ceremonySchedules.workflowId, id));
        res.json(rows);
    }
    catch (err) {
        handleError(res, err);
    }
});
ceremoniesRouter.post('/:id/schedules', async (req, res) => {
    try {
        const { id } = req.params;
        const { cronExpr, timezone, enabled } = req.body;
        if (!cronExpr || typeof cronExpr !== 'string') {
            res.status(400).json({ error: '`cronExpr` is required' });
            return;
        }
        const tz = typeof timezone === 'string' && timezone.length > 0 ? timezone : 'UTC';
        let nextFire;
        try {
            nextFire = computeNextFire(cronExpr, tz);
        }
        catch (err) {
            res.status(400).json({
                error: 'Invalid cron expression',
                details: err instanceof Error ? err.message : String(err),
            });
            return;
        }
        const db = getDb();
        const [row] = await db
            .insert(schema.ceremonySchedules)
            .values({
            workflowId: id,
            cronExpr,
            timezone: tz,
            nextFireAt: nextFire,
            enabled: enabled ?? true,
        })
            .returning();
        res.status(201).json(row);
    }
    catch (err) {
        handleError(res, err);
    }
});
ceremoniesRouter.patch('/:id/schedules/:sId', async (req, res) => {
    try {
        const { sId } = req.params;
        const body = req.body;
        const db = getDb();
        const [existing] = await db
            .select()
            .from(schema.ceremonySchedules)
            .where(eq(schema.ceremonySchedules.id, sId))
            .limit(1);
        if (!existing) {
            res.status(404).json({ error: 'Schedule not found' });
            return;
        }
        const updates = {
            updatedAt: new Date(),
        };
        if (body.timezone !== undefined)
            updates.timezone = body.timezone;
        if (body.enabled !== undefined)
            updates.enabled = body.enabled;
        if (body.cronExpr !== undefined) {
            try {
                updates.nextFireAt = computeNextFire(body.cronExpr, body.timezone ?? existing.timezone ?? 'UTC');
            }
            catch (err) {
                res.status(400).json({
                    error: 'Invalid cron expression',
                    details: err instanceof Error ? err.message : String(err),
                });
                return;
            }
            updates.cronExpr = body.cronExpr;
        }
        const [updated] = await db
            .update(schema.ceremonySchedules)
            .set(updates)
            .where(eq(schema.ceremonySchedules.id, sId))
            .returning();
        res.json(updated);
    }
    catch (err) {
        handleError(res, err);
    }
});
ceremoniesRouter.delete('/:id/schedules/:sId', async (req, res) => {
    try {
        const { sId } = req.params;
        const db = getDb();
        await db
            .delete(schema.ceremonySchedules)
            .where(eq(schema.ceremonySchedules.id, sId));
        res.json({ message: 'Schedule deleted', scheduleId: sId });
    }
    catch (err) {
        handleError(res, err);
    }
});
// ---------------------------------------------------------------------------
// Top-level /api/ceremonies router (templates, validate)
// ---------------------------------------------------------------------------
export const ceremoniesTopRouter = Router();
ceremoniesTopRouter.get('/templates', (_req, res) => {
    res.json({ ok: true, data: getBuiltinTemplates() });
});
ceremoniesTopRouter.post('/validate', (req, res) => {
    const { yamlContent } = req.body;
    if (typeof yamlContent !== 'string') {
        res.status(400).json({ valid: false, errors: ['`yamlContent` is required'] });
        return;
    }
    const result = validateWorkflowYaml(yamlContent);
    res.json(result);
});
// Re-export sql for unused-import suppression in TS strict mode
void sql;
//# sourceMappingURL=ceremonies.js.map