import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  assertRalphMonitorState,
  getRalphMonitorStatus,
  runRalphMonitorSweep,
  updateRalphMonitorSettings,
  type RalphMonitorState,
} from '../services/ralph-monitor.js';

export const projectRalphMonitorRouter = Router({ mergeParams: true });

function handleError(res: Response, err: unknown): void {
  const status = (err as Error & { status?: number }).status ?? 500;
  res.status(status).json({ error: err instanceof Error ? err.message : 'Internal server error' });
}

projectRalphMonitorRouter.get('/', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params as Record<string, string>;
    const status = await getRalphMonitorStatus(projectId);
    if (!status) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    res.json(status);
  } catch (err) {
    handleError(res, err);
  }
});

projectRalphMonitorRouter.patch('/', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params as Record<string, string>;
    const body = (req.body ?? {}) as {
      enabled?: unknown;
      autoMergeEnabled?: unknown;
      state?: unknown;
    };

    if (body.enabled !== undefined && typeof body.enabled !== 'boolean') {
      res.status(400).json({ error: '`enabled` must be a boolean' });
      return;
    }
    if (body.autoMergeEnabled !== undefined && typeof body.autoMergeEnabled !== 'boolean') {
      res.status(400).json({ error: '`autoMergeEnabled` must be a boolean' });
      return;
    }

    const enabled = typeof body.enabled === 'boolean' ? body.enabled : undefined;
    const autoMergeEnabled = typeof body.autoMergeEnabled === 'boolean' ? body.autoMergeEnabled : undefined;
    let state: RalphMonitorState | undefined;
    if (body.state !== undefined) {
      assertRalphMonitorState(body.state);
      state = body.state;
    }

    const status = await updateRalphMonitorSettings(projectId, {
      ...(enabled !== undefined ? { enabled } : {}),
      ...(autoMergeEnabled !== undefined ? { autoMergeEnabled } : {}),
      ...(state !== undefined ? { state } : {}),
    });

    if (!status) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    res.json(status);
  } catch (err) {
    handleError(res, err);
  }
});

projectRalphMonitorRouter.post('/sweep', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params as Record<string, string>;
    const result = await runRalphMonitorSweep(projectId);
    if (!result) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
});
