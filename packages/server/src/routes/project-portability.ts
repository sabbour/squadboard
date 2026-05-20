/**
 * project-portability.ts — Phase 19 project export/import routes
 *
 * POST /api/projects/:id/export                          → { ok, data: { payload: ProjectPayload } }
 * POST /api/projects/import                              → { ok, data: { project: { id, name } } }
 * POST /api/projects/:id/save-as-template                → { ok, data: { template: { id, name, ... } } }
 * POST /api/projects/instantiate-template/:templateId    → { ok, data: { project: { id, name } } }
 *
 * NOTE: The routes that take a project ID are mounted AFTER the static /import
 * and /instantiate-template/:templateId routes to avoid Express treating
 * "import" as an `:id` param.  Both are registered on the same router which
 * is mounted at /api/projects — Express will match top-to-bottom.
 *
 * Wave 10 B1: previously these returned `{ projectId }` / `{ templateId }` /
 * the raw `ProjectPayload`, which mismatched the client hooks that read
 * `.data.project.id`, `.data.template`, and `.data.payload` — the entire
 * Create-from-template happy path crashed at `result.id` after a successful
 * server insert. The server is now the source of truth for the envelope shape.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import {
  exportProject,
  importProject,
  saveAsTemplate,
  instantiateTemplate,
  type ProjectPayload,
} from '../services/templates/project-template.js';

const router = Router({ mergeParams: true });

async function fetchProjectSummary(id: string): Promise<{ id: string; name: string } | null> {
  const db = getDb();
  const [row] = await db
    .select({ id: schema.projects.id, name: schema.projects.name })
    .from(schema.projects)
    .where(eq(schema.projects.id, id))
    .limit(1);
  return row ?? null;
}

async function fetchTemplateSummary(id: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.templates)
    .where(eq(schema.templates.id, id))
    .limit(1);
  if (!row) return null;
  return {
    id:          row.id,
    kind:        row.kind,
    name:        row.name,
    description: row.description ?? null,
    createdAt:   row.createdAt,
  };
}

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
    const project = await fetchProjectSummary(projectId);
    res.status(201).json({
      ok: true,
      data: { project: project ?? { id: projectId, name: newName } },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = (err as Error & { status?: number }).status ?? 500;
    res.status(status).json({ ok: false, error: msg });
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

    const requestedName = name?.trim() || 'Imported Project';
    const projectId = await instantiateTemplate(
      templateId,
      requestedName,
      squadPath.trim(),
    );
    const project = await fetchProjectSummary(projectId);
    res.status(201).json({
      ok: true,
      data: { project: project ?? { id: projectId, name: requestedName } },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = (err as Error & { status?: number }).status
      ?? (err instanceof Error && err.message.includes('not found') ? 404 : 500);
    res.status(status).json({ ok: false, error: msg });
  }
});

// ---------------------------------------------------------------------------
// POST /api/projects/:id/export
// ---------------------------------------------------------------------------
router.post('/:id/export', async (req: Request, res: Response) => {
  try {
    const payload = await exportProject(req.params.id as string);
    res.json({ ok: true, data: { payload } });
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

    const { templateId, storagePath, storageError } = await saveAsTemplate(
      projectId,
      name.trim(),
      description,
    );
    const template = await fetchTemplateSummary(templateId);
    res.status(201).json({
      ok: true,
      data: {
        template: template ?? { id: templateId, kind: 'project', name: name.trim(), description: description ?? null, createdAt: new Date().toISOString() },
        // Stream D — D7: surface the on-disk mirror path so the dialog can show
        // "Saved to: …" beneath the success toast.
        storagePath,
        storageError,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = err instanceof Error && err.message.includes('not found') ? 404 : 500;
    res.status(status).json({ ok: false, error: msg });
  }
});

export default router;
