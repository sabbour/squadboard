/**
 * routes/starters.ts
 *
 * Bundled Squad-IRL starter projects served from local disk (no network).
 *
 *   GET  /api/starters              → catalogue
 *   GET  /api/starters/:slug        → meta + readme + plan + source
 *   GET  /api/starters/:slug/plan   → just the provisioning plan
 *   POST /api/starters/:slug/use    → materialise as a new Squadboard project
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import {
  getStarter,
  getStarterPlan,
  listStarters,
} from '../services/starter-projects.js';
import { materialiseIrlPlan } from '../services/irl-mapper.js';
import { assertProjectPathAvailable } from '../services/project-path-uniqueness.js';

export const startersRouter = Router();

startersRouter.get('/', async (_req: Request, res: Response) => {
  try {
    const starters = await listStarters();
    res.json({ ok: true, data: starters });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: 'starters_unavailable',
      message: (err as Error).message,
    });
  }
});

startersRouter.get('/:slug', async (req: Request, res: Response) => {
  const slug = req.params.slug as string;
  try {
    const detail = await getStarter(slug);
    if (!detail) {
      res.status(404).json({ ok: false, error: 'starter_not_found' });
      return;
    }
    res.json({ ok: true, data: detail });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: 'starter_read_failed',
      message: (err as Error).message,
    });
  }
});

startersRouter.get('/:slug/plan', async (req: Request, res: Response) => {
  const slug = req.params.slug as string;
  try {
    const plan = await getStarterPlan(slug);
    if (!plan) {
      res.status(404).json({ ok: false, error: 'starter_not_found' });
      return;
    }
    res.json({ ok: true, data: plan });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: 'starter_read_failed',
      message: (err as Error).message,
    });
  }
});

interface UseStarterBody {
  /** Optional Squadboard project name. Defaults to the starter title. */
  projectName?: string;
  /** Optional absolute path where the .squad/ directory should live. */
  projectPath?: string;
}

startersRouter.post('/:slug/use', async (req: Request, res: Response) => {
  const slug = req.params.slug as string;
  const body = (req.body ?? {}) as UseStarterBody;

  let detail;
  try {
    detail = await getStarter(slug);
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: 'starter_read_failed',
      message: (err as Error).message,
    });
    return;
  }
  if (!detail) {
    res.status(404).json({ ok: false, error: 'starter_not_found' });
    return;
  }

  const projectName = (body.projectName ?? detail.meta.title).slice(0, 200) || slug;
  const projectPath = await resolveProjectPath(body.projectPath, slug);
  let squadPath: string;
  try {
    squadPath = await assertProjectPathAvailable(projectPath);
  } catch (err) {
    res.status((err as Error & { status?: number }).status ?? 500).json({
      ok: false,
      error: (err as Error & { code?: string }).code ?? 'project_path_unavailable',
      message: err instanceof Error ? err.message : String(err),
      projectId: (err as Error & { projectId?: string }).projectId,
    });
    return;
  }

  // Refuse if the target path already has anything in it that would collide.
  try {
    const existing = await fs.readdir(projectPath).catch(() => [] as string[]);
    if (existing.length > 0) {
      res.status(409).json({
        ok: false,
        error: 'path_not_empty',
        message: `Refusing to use non-empty path ${projectPath}`,
      });
      return;
    }
  } catch {
    // dir doesn't exist yet — fine, materialiser will create it
  }

  const db = getDb();
  const [project] = await db
    .insert(schema.projects)
    .values({ name: projectName, path: squadPath })
    .returning();
  if (!project) {
    res.status(500).json({ ok: false, error: 'project_insert_failed' });
    return;
  }

  let result;
  try {
    result = await materialiseIrlPlan(project.id, projectPath, detail.plan);
  } catch (err) {
    // Best-effort rollback on partial failure.
    await db.delete(schema.projects).where(eq(schema.projects.id, project.id)).catch(() => {});
    await fs.rm(projectPath, { recursive: true, force: true }).catch(() => {});
    res.status(500).json({
      ok: false,
      error: 'materialise_failed',
      message: (err as Error).message,
    });
    return;
  }

  res.status(201).json({
    ok: true,
    data: {
      project,
      result,
      plan: {
        agents: detail.plan.agents.map((a) => ({ name: a.name, role: a.role })),
        routingRules: detail.plan.routingRules.length,
        ceremonies: detail.plan.ceremonies.length,
        warnings: detail.plan.warnings,
      },
    },
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function resolveProjectPath(provided: string | undefined, slug: string): Promise<string> {
  if (provided && path.isAbsolute(provided)) return provided;

  const home = os.homedir();
  const base = path.join(home, '.squadboard', 'projects');
  await fs.mkdir(base, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return path.join(base, `${slug}-${stamp}`);
}
