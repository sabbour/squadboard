import { Router } from 'express';
import * as issuesService from '../services/issues.js';
const router = Router({ mergeParams: true });
function handleError(res, err) {
    if (err instanceof Error && err.status) {
        const status = err.status;
        res.status(status).json({ error: err.message });
        return;
    }
    console.error('[labels] unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
}
// GET /api/projects/:projectId/labels
router.get('/', async (req, res) => {
    try {
        const { projectId } = req.params;
        const rows = await issuesService.listLabels(projectId);
        res.json(rows);
    }
    catch (err) {
        handleError(res, err);
    }
});
// POST /api/projects/:projectId/labels
router.post('/', async (req, res) => {
    try {
        const { projectId } = req.params;
        const { name, color } = req.body;
        const created = await issuesService.createLabel(projectId, name, color);
        res.status(201).json(created);
    }
    catch (err) {
        handleError(res, err);
    }
});
export default router;
//# sourceMappingURL=labels.js.map