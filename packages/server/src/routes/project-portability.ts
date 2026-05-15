/**
 * project-portability.ts — Phase 19 project export/import routes
 *
 * POST /api/projects/:id/export                          → { ok, data: ProjectPayload }
 * POST /api/projects/import                              → { ok, data: { projectId } }
 * POST /api/projects/:id/save-as-template                → { ok, data: { templateId } }
 * POST /api/projects/instantiate-template/:templateId    → { ok, data: { projectId } }
 *
 * NOTE: The routes that take a project ID are mounted AFTER the static /import
 * and /instantiate-template/:templateId routes to avoid Express treating
 * "import" as an `:id` param.  Both are registered on the same router which
 * is mounted at /api/projects — Express will match top-to-bottom.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  exportProject,
  importProject,
  saveAsTemplate,
  instantiateTemplate,
  type ProjectPayload,
} from '../services/templates/project-template.js';

const router = Router({ mergeParams: true });

// ---------------------------------------------------------------------------
// POST /api/projects/import
// Body: { payload: ProjectPayload, name: string, squadPath: string }
// ---------------------------------------------------------------------------
router.post('/import', async (req: Request, res: Response) => {
  try {
    const { payload, name, squadPath } = req.body as {
      payload: ProjectPayload;
      name?: string;
      squadPath?: string;
    };

    if (!payload?.meta) {
      res.status(400).json({ ok: false, error: '`payload` with `.meta` is required' });
      return;
    }
    if (!squadPath?.trim()) {
      res.status(400).json({ ok: false, error: '`squadPath` is required' });
      return;
    }

    const newName = name?.trim() || payload.meta.name;
    const projectId = await importProject(payload, newName, squadPath.trim());
    res.status(201).json({ ok: true, data: { projectId } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

// ---------------------------------------------------------------------------
// POST /api/projects/instantiate-template/:templateId
// Body: { name?: string, squadPath: string }
// ---------------------------------------------------------------------------
router.post('/instantiate-template/:templateId', async (req: Request, res: Response) => {
  try {
    const templateId = req.params.templateId as string;
    const { name, squadPath } = req.body as { name?: string; squadPath?: string };

    if (!squadPath?.trim()) {
      res.status(400).json({ ok: false, error: '`squadPath` is required' });
      return;
    }

    const projectId = await instantiateTemplate(
      templateId,
      name?.trim() || 'Imported Project',
      squadPath.trim(),
    );
    res.status(201).json({ ok: true, data: { projectId } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = err instanceof Error && err.message.includes('not found') ? 404 : 500;
    res.status(status).json({ ok: false, error: msg });
  }
});

// ---------------------------------------------------------------------------
// POST /api/projects/:id/export
// ---------------------------------------------------------------------------
router.post('/:id/export', async (req: Request, res: Response) => {
  try {
    const payload = await exportProject(req.params.id as string);
    res.json({ ok: true, data: payload });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = err instanceof Error && err.message.includes('not found') ? 404 : 500;
    res.status(status).json({ ok: false, error: msg });
  }
});

// ---------------------------------------------------------------------------
// POST /api/projects/:id/save-as-template
// Body: { name: string, description?: string }
// ---------------------------------------------------------------------------
router.post('/:id/save-as-template', async (req: Request, res: Response) => {
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
    const status = err instanceof Error && err.message.includes('not found') ? 404 : 500;
    res.status(status).json({ ok: false, error: msg });
  }
});

export default router;
