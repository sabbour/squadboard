/**
 * team-portability.ts — Phase 19 team export/import routes
 *
 * Mounts at /api/projects/:id/team
 *
 * POST /export                             → { ok, data: TeamPayload }
 * POST /import                             → { ok, data: { imported, skipped } }
 * POST /save-as-template                   → { ok, data: { templateId } }
 * POST /instantiate-template/:templateId   → { ok, data: { imported, skipped } }
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  exportTeam,
  importTeam,
  saveAsTemplate,
  instantiateTemplate,
  type TeamPayload,
} from '../services/templates/team-template.js';

const router = Router({ mergeParams: true });

// ---------------------------------------------------------------------------
// POST /api/projects/:id/team/export
// ---------------------------------------------------------------------------
router.post('/export', async (req: Request, res: Response) => {
  try {
    const projectId = req.params.id as string;
    const payload = await exportTeam(projectId);
    res.json({ ok: true, data: payload });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

// ---------------------------------------------------------------------------
// POST /api/projects/:id/team/import
// Body: { payload: TeamPayload, force?: boolean }
// ---------------------------------------------------------------------------
router.post('/import', async (req: Request, res: Response) => {
  try {
    const projectId = req.params.id as string;
    const { payload, force } = req.body as { payload: TeamPayload; force?: boolean };

    if (!payload || !Array.isArray(payload.agents)) {
      res.status(400).json({ ok: false, error: '`payload.agents` array is required' });
      return;
    }

    const result = await importTeam(projectId, payload, { force: Boolean(force) });
    res.json({ ok: true, data: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

// ---------------------------------------------------------------------------
// POST /api/projects/:id/team/save-as-template
// Body: { name: string, description?: string }
// ---------------------------------------------------------------------------
router.post('/save-as-template', async (req: Request, res: Response) => {
  try {
    const projectId = req.params.id as string;
    const { name, description } = req.body as { name?: string; description?: string };

    if (!name?.trim()) {
      res.status(400).json({ ok: false, error: '`name` is required' });
      return;
    }

    const templateId = await saveAsTemplate(projectId, name.trim(), description);
    res.status(201).json({ ok: true, data: { templateId } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

// ---------------------------------------------------------------------------
// POST /api/projects/:id/team/instantiate-template/:templateId
// Body: { force?: boolean }
// ---------------------------------------------------------------------------
router.post('/instantiate-template/:templateId', async (req: Request, res: Response) => {
  try {
    const projectId  = req.params.id as string;
    const templateId = req.params.templateId as string;
    const { force }  = req.body as { force?: boolean };

    const result = await instantiateTemplate(projectId, templateId, { force: Boolean(force) });
    res.json({ ok: true, data: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = err instanceof Error && err.message.includes('not found') ? 404 : 500;
    res.status(status).json({ ok: false, error: msg });
  }
});

export default router;
