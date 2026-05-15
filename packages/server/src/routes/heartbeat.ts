/**
 * routes/heartbeat.ts — Phase 3 Heartbeat
 *
 * GET  /api/heartbeat                     — returns heartbeat.getStatus()
 * POST /api/heartbeat/sweeps/:id/run      — manual tick(id) ("Run now" UI button)
 * PATCH /api/heartbeat/sweeps/:id         — toggle enabled flag (per-sweep UI toggle)
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { heartbeat } from '../engine/heartbeat.js';

const router = Router();

/** GET /api/heartbeat — full status snapshot. */
router.get('/', (_req: Request, res: Response): void => {
  res.json(heartbeat.getStatus());
});

/** POST /api/heartbeat/sweeps/:id/run — manually trigger one sweep. */
router.post('/sweeps/:id/run', (req: Request, res: Response): void => {
  const id = req.params['id'] as string;
  heartbeat
    .tick(id)
    .then(() => res.json({ ok: true, sweepId: id }))
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(404).json({ ok: false, error: msg });
    });
});

/** PATCH /api/heartbeat/sweeps/:id — toggle enabled. Body: { enabled: boolean } */
router.patch('/sweeps/:id', (req: Request, res: Response): void => {
  const id = req.params['id'] as string;
  const { enabled } = req.body as { enabled?: boolean };
  if (typeof enabled !== 'boolean') {
    res.status(400).json({ ok: false, error: '`enabled` must be a boolean' });
    return;
  }
  try {
    heartbeat.setSweepEnabled(id, enabled);
    res.json({ ok: true, sweepId: id, enabled });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(404).json({ ok: false, error: msg });
  }
});

export default router;
