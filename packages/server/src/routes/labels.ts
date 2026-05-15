import { Router } from 'express';
import type { Request, Response } from 'express';
import * as issuesService from '../services/issues.js';

const router = Router({ mergeParams: true });

function handleError(res: Response, err: unknown) {
  if (err instanceof Error && (err as { status?: number }).status) {
    const status = (err as unknown as { status: number }).status;
    res.status(status).json({ error: err.message });
    return;
  }
  console.error('[labels] unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
}

// GET /api/projects/:projectId/labels
router.get('/', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params as Record<string, string>;
    const rows = await issuesService.listLabels(projectId);
    res.json(rows);
  } catch (err) {
    handleError(res, err);
  }
});

// POST /api/projects/:projectId/labels
router.post('/', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params as Record<string, string>;
    const { name, color } = req.body as { name: string; color?: string };
    const created = await issuesService.createLabel(projectId, name, color);
    res.status(201).json(created);
  } catch (err) {
    handleError(res, err);
  }
});

export default router;
