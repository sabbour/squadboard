/**
 * GET /api/casting/universes
 *   Lists universes available for the Hire Team flow (from the SDK CastingEngine).
 *   The actual cast is performed via POST /api/projects/:id/agents/hire-team/propose.
 */
import { Router, type Request, type Response } from 'express';
import { listUniverses } from '../services/casting-engine.js';

const router = Router();

router.get('/universes', (_req: Request, res: Response) => {
  res.json({ ok: true, data: listUniverses() });
});

export default router;
