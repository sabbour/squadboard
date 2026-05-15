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
import { heartbeat } from '../engine/heartbeat.js';
import { getHeartbeatSnapshot, getRecentSweeps } from '../services/heartbeat.js';
const router = Router();
/** GET /api/heartbeat — legacy alias of /status. */
router.get('/', (_req, res) => {
    res.json(getHeartbeatSnapshot());
});
/** GET /api/heartbeat/status — full snapshot for the Heartbeat page. */
router.get('/status', (_req, res) => {
    res.json(getHeartbeatSnapshot());
});
/** GET /api/heartbeat/sweeps?since=N&limit=M — incremental ring buffer. */
router.get('/sweeps', (req, res) => {
    const sinceRaw = req.query['since'];
    const limitRaw = req.query['limit'];
    const since = typeof sinceRaw === 'string' ? Number(sinceRaw) : undefined;
    const limit = typeof limitRaw === 'string' ? Number(limitRaw) : undefined;
    res.json(getRecentSweeps({
        since: Number.isFinite(since) ? since : undefined,
        limit: Number.isFinite(limit) ? limit : undefined,
    }));
});
/** POST /api/heartbeat/sweeps/:id/run — manually trigger one sweep. */
router.post('/sweeps/:id/run', (req, res) => {
    const id = req.params['id'];
    heartbeat
        .tick(id)
        .then(() => res.json({ ok: true, sweepId: id }))
        .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        res.status(404).json({ ok: false, error: msg });
    });
});
/** PATCH /api/heartbeat/sweeps/:id — toggle enabled. Body: { enabled: boolean } */
router.patch('/sweeps/:id', (req, res) => {
    const id = req.params['id'];
    const { enabled } = req.body;
    if (typeof enabled !== 'boolean') {
        res.status(400).json({ ok: false, error: '`enabled` must be a boolean' });
        return;
    }
    try {
        heartbeat.setSweepEnabled(id, enabled);
        res.json({ ok: true, sweepId: id, enabled });
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        res.status(404).json({ ok: false, error: msg });
    }
});
export default router;
//# sourceMappingURL=heartbeat.js.map