/**
 * routes/heartbeat.ts — Phase 3 Heartbeat + Wave 10 B3
 *
 * GET   /api/heartbeat                     — alias of /status (legacy)
 * GET   /api/heartbeat/status              — full snapshot (active flag, last
 *                                            tick, per-sweep state, recent ring)
 * GET   /api/heartbeat/sweeps?since=N      — incremental ring of recent sweep
 *                                            results since seq cursor N
 * POST  /api/heartbeat/sweeps/:id/run      — manual tick(id) ("Run now")
 * PATCH /api/heartbeat/sweeps/:id          — toggle enabled flag
 *
 * Wave 10 B3: the Heartbeat page (packages/client/src/pages/Heartbeat.tsx) was
 * a placeholder that always rendered "service not yet active". This route file
 * now provides the data plane the page needs; the page wires to /status on
 * mount and polls /sweeps?since=cursor for incremental updates.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { heartbeat } from '../engine/heartbeat.js';
import { getHeartbeatSnapshot, getRecentSweeps } from '../services/heartbeat.js';

const router = Router();

/** GET /api/heartbeat — legacy alias of /status. */
router.get('/', (req: Request, res: Response): void => {
  const projectId = typeof req.query['projectId'] === 'string' ? req.query['projectId'] : undefined;
  res.json(getHeartbeatSnapshot(projectId));
});

/** GET /api/heartbeat/status — full snapshot for the Heartbeat page. */
router.get('/status', (req: Request, res: Response): void => {
  const projectId = typeof req.query['projectId'] === 'string' ? req.query['projectId'] : undefined;
  res.json(getHeartbeatSnapshot(projectId));
});

/** GET /api/heartbeat/sweeps?since=N&limit=M — incremental ring buffer. */
router.get('/sweeps', (req: Request, res: Response): void => {
  const sinceRaw = req.query['since'];
  const limitRaw = req.query['limit'];
  const projectId = typeof req.query['projectId'] === 'string' ? req.query['projectId'] : undefined;
  const since = typeof sinceRaw === 'string' ? Number(sinceRaw) : undefined;
  const limit = typeof limitRaw === 'string' ? Number(limitRaw) : undefined;
  res.json(getRecentSweeps({
    since: Number.isFinite(since) ? since : undefined,
    limit: Number.isFinite(limit) ? limit : undefined,
    projectId,
  }));
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

/**
 * GET /api/heartbeat/config — effective per-sweep cadence config.
 *
 * Returns the intervalMs + enabled flag for every registered sweep AFTER
 * heartbeat.config.json overrides have been applied at boot. Use this to
 * verify which overrides took effect without restarting verbose logging.
 */
router.get('/config', (_req: Request, res: Response): void => {
  res.json({
    configPath: 'packages/server/heartbeat.config.json',
    sweeps: heartbeat.getEffectiveIntervals(),
  });
});

export default router;
