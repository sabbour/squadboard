/**
 * routes/flow.ts — Phase 12 flow visualisation endpoints.
 *
 * GET /api/projects/:projectId/issues/:issueId/flow
 *   → per-task DAG payload (see services/flow.ts:IssueFlow).
 *
 * GET /api/projects/:projectId/flow
 *   → project-level kanban-with-active-run payload
 *     (see services/flow.ts:ProjectFlow).
 *
 * Both endpoints are read-only aggregators. Phase 16 will add edit
 * affordances on top of these payloads.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import * as flowService from '../services/flow.js';

function handleError(res: Response, err: unknown) {
  const status = (err as { status?: unknown })?.status;
  if (err instanceof Error && typeof status === 'number') {
    res.status(status).json({ error: err.message });
    return;
  }
  console.error('[flow] unhandled error:', err);
  res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' });
}

// ---------------------------------------------------------------------------
// Project-scoped router — mounted at /api/projects/:projectId/flow
// ---------------------------------------------------------------------------

export const projectFlowRouter = Router({ mergeParams: true });

projectFlowRouter.get('/', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params as Record<string, string>;
    const payload = await flowService.getProjectFlow(projectId);
    res.json(payload);
  } catch (err) {
    handleError(res, err);
  }
});

// ---------------------------------------------------------------------------
// Issue-scoped router — mounted at /api/projects/:projectId/issues/:issueId/flow
// ---------------------------------------------------------------------------

export const issueFlowRouter = Router({ mergeParams: true });

issueFlowRouter.get('/', async (req: Request, res: Response) => {
  try {
    const { projectId, issueId } = req.params as Record<string, string>;
    const payload = await flowService.getIssueFlow(projectId, issueId);
    res.json(payload);
  } catch (err) {
    handleError(res, err);
  }
});
