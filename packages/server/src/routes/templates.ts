/**
 * templates.ts — Phase 19 Templates CRUD routes
 *
 * Mounts at /api/templates
 *
 * GET    /                              list all templates; filter by ?kind=workflow|team|project
 * GET    /builtin-projects              list built-in project bundle templates (scanned from bundles/)
 * POST   /builtin-projects/:id/apply   apply a built-in bundle to create a new project
 * GET    /:id                          get single template (with full payload)
 * DELETE /:id                          delete template
 *
 * Response envelope (uniform with the other portability routes — see
 * packages/client/src/api/templates.ts r5 contract):
 *
 *   GET  /                          { ok: true, data: { templates: TemplateSummary[] } }
 *   GET  /builtin-projects          { ok: true, data: { templates: BuiltinBundleSummary[] } }
 *   POST /builtin-projects/:id/apply { ok: true, data: { project: { id, name }, result: ApplyResult, scaffold } }
 *   GET  /:id                       { ok: true, data: { template: TemplateDetail } }
 *   DELETE /:id                     { ok: true, data: { template: TemplateSummary } }
 *
 * Wave 10 B1: previously these returned `{ data: rows }` / `{ data: tmpl }`
 * which caused `useTemplates`/`useTemplate` (which read `.data.templates` /
 * `.data.template`) to silently see `undefined` → empty list → "No project
 * templates yet" even when project templates existed, breaking the entire
 * Create-from-template flow on the Projects page.
 *
 * Wave 16 (Hockney): added /builtin-projects routes backed by builtin-bundles.ts scanner.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import {
  getBuiltinBundles,
  getBuiltinBundle,
  getBuiltinBundleDir,
} from '../services/builtin-bundles.js';
import { applyBundle } from '../services/bundle-loader.js';
import { normalizeSquadPath, scaffoldSquadFromBundle } from '../services/setup-lifecycle.js';

const router = Router();

// Pick only the summary columns the client needs in list views — `payload` is
// often large (full project bundle) and is only required from GET /:id.
function toSummary(row: typeof schema.templates.$inferSelect) {
  return {
    id:          row.id,
    kind:        row.kind,
    name:        row.name,
    description: row.description ?? null,
    createdAt:   row.createdAt,
    // Stream D — D7: expose projectId so the Templates page can offer a
    // "My templates" filter scoped to the active project.
    projectId:   row.projectId ?? null,
  };
}

// ---------------------------------------------------------------------------
// GET /api/templates
// ---------------------------------------------------------------------------
router.get('/', async (req: Request, res: Response) => {
  try {
    const db  = getDb();
    const { kind } = req.query as Record<string, string | undefined>;

    const rows = kind
      ? await db.select().from(schema.templates).where(eq(schema.templates.kind, kind))
      : await db.select().from(schema.templates);

    res.json({ ok: true, data: { templates: rows.map(toSummary) } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

// ---------------------------------------------------------------------------
// GET /api/templates/builtin-projects
// Returns the list of built-in project bundles scanned from bundles/ at
// the workspace root.  Must be declared BEFORE /:id to avoid Express
// swallowing "builtin-projects" as an id param.
// ---------------------------------------------------------------------------
router.get('/builtin-projects', async (_req: Request, res: Response) => {
  try {
    const bundles = await getBuiltinBundles();
    res.json({ ok: true, data: { templates: bundles } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

// ---------------------------------------------------------------------------
// POST /api/templates/builtin-projects/:bundleId/apply
// Apply a built-in bundle to create a new project.
// Body: { squadPath: string, name?: string }
// ---------------------------------------------------------------------------
router.post('/builtin-projects/:bundleId/apply', async (req: Request, res: Response) => {
  try {
    const { bundleId } = req.params as { bundleId: string };
    const { squadPath, name } = req.body as { squadPath?: string; name?: string };

    if (!squadPath?.trim()) {
      res.status(400).json({ ok: false, error: '`squadPath` is required' });
      return;
    }

    const bundle = await getBuiltinBundle(bundleId);
    if (!bundle) {
      res.status(404).json({ ok: false, error: `Built-in bundle "${bundleId}" not found` });
      return;
    }

    const bundleDir = await getBuiltinBundleDir(bundleId);

    // Derive the final project name: caller-supplied > bundle.project.name > bundle.manifest.name
    const projectName = name?.trim() || bundle.project?.name || bundle.manifest.name;

    const targetSquadPath = normalizeSquadPath(squadPath);

    const bundleToApply: typeof bundle = {
      ...bundle,
      project: {
        ...(bundle.project ?? { name: projectName }),
        name: projectName,
        settings: {
          ...(bundle.project?.settings ?? {}),
          squadPath: targetSquadPath,
        },
      },
    };

    const result = await applyBundle(bundleToApply, {
      bundleDir: bundleDir ?? process.cwd(),
    });

    if (!result.meta.projectId) {
      res.status(500).json({ ok: false, error: 'Bundle applied but no project was created', result });
      return;
    }

    const scaffold = await scaffoldSquadFromBundle(bundleToApply, {
      squadPath: targetSquadPath,
      projectName,
    });

    res.json({
      ok: true,
      data: {
        project: { id: result.meta.projectId, name: projectName },
        result,
        scaffold,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

// ---------------------------------------------------------------------------
// GET /api/templates/:id
// ---------------------------------------------------------------------------
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const [tmpl] = await db
      .select()
      .from(schema.templates)
      .where(eq(schema.templates.id, req.params.id as string))
      .limit(1);

    if (!tmpl) {
      res.status(404).json({ ok: false, error: 'Template not found' });
      return;
    }
    res.json({
      ok: true,
      data: {
        template: {
          ...toSummary(tmpl),
          payload: tmpl.payload,
        },
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/templates/:id
// ---------------------------------------------------------------------------
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const deleted = await db
      .delete(schema.templates)
      .where(eq(schema.templates.id, req.params.id as string))
      .returning();

    if (!deleted.length) {
      res.status(404).json({ ok: false, error: 'Template not found' });
      return;
    }
    res.json({ ok: true, data: { template: toSummary(deleted[0]) } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

export default router;
