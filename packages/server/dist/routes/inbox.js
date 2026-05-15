/**
 * routes/inbox.ts — Phase 14 quick-capture REST surface.
 *
 *   GET    /api/inbox                 list (filters: ?status, ?projectId, ?userId, ?limit, ?offset)
 *   GET    /api/inbox/:id             single
 *   POST   /api/inbox                 create draft
 *   POST   /api/inbox/:id/formulate   call LLM to fill formulated*
 *   PATCH  /api/inbox/:id             user edits to formulated fields
 *   POST   /api/inbox/:id/publish     create issue, status=published
 *   DELETE /api/inbox/:id             status=discarded (soft delete)
 */
import { Router } from 'express';
import * as inboxService from '../services/inbox.js';
const router = Router();
function handleError(res, err) {
    const status = err?.status;
    const llmRaw = err?.llmRaw;
    if (err instanceof Error && typeof status === 'number') {
        const body = { error: err.message };
        if (typeof llmRaw === 'string')
            body.llmRaw = llmRaw;
        res.status(status).json(body);
        return;
    }
    console.error('[inbox] unhandled error:', err);
    res.status(500).json({
        error: err instanceof Error ? err.message : 'Internal server error',
    });
}
// GET /api/inbox
router.get('/', async (req, res) => {
    try {
        const { status, projectId, userId, limit, offset } = req.query;
        const rows = await inboxService.listInboxItems({
            status: status,
            projectId: projectId || undefined,
            userId: userId || undefined,
            limit: limit ? parseInt(limit, 10) : undefined,
            offset: offset ? parseInt(offset, 10) : undefined,
        });
        res.json(rows);
    }
    catch (err) {
        handleError(res, err);
    }
});
// GET /api/inbox/:id
router.get('/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const row = await inboxService.getInboxItem(id);
        if (!row) {
            res.status(404).json({ error: 'inbox item not found' });
            return;
        }
        res.json(row);
    }
    catch (err) {
        handleError(res, err);
    }
});
// POST /api/inbox
router.post('/', async (req, res) => {
    try {
        const { originalDraft, suggestedProjectId, userId } = req.body;
        if (!originalDraft || typeof originalDraft !== 'string') {
            res.status(400).json({ error: '`originalDraft` is required' });
            return;
        }
        const created = await inboxService.createInboxItem({
            originalDraft,
            suggestedProjectId: suggestedProjectId ?? null,
            userId: userId ?? null,
        });
        res.status(201).json(created);
    }
    catch (err) {
        handleError(res, err);
    }
});
// POST /api/inbox/:id/formulate
router.post('/:id/formulate', async (req, res) => {
    try {
        const id = req.params.id;
        const updated = await inboxService.formulateInboxItem(id);
        res.json(updated);
    }
    catch (err) {
        handleError(res, err);
    }
});
// PATCH /api/inbox/:id
router.patch('/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const updated = await inboxService.updateInboxItem(id, req.body);
        res.json(updated);
    }
    catch (err) {
        handleError(res, err);
    }
});
// POST /api/inbox/:id/publish
router.post('/:id/publish', async (req, res) => {
    try {
        const id = req.params.id;
        const { projectId, columnSlug } = req.body;
        if (!projectId) {
            res.status(400).json({ error: '`projectId` is required' });
            return;
        }
        const result = await inboxService.publishInboxItem(id, {
            projectId,
            columnSlug: (columnSlug ?? 'backlog'),
        });
        res.status(201).json(result);
    }
    catch (err) {
        handleError(res, err);
    }
});
// DELETE /api/inbox/:id  (soft delete → status='discarded')
router.delete('/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const updated = await inboxService.discardInboxItem(id);
        res.json(updated);
    }
    catch (err) {
        handleError(res, err);
    }
});
export default router;
//# sourceMappingURL=inbox.js.map