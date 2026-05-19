import { Router } from 'express';
import type { Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { createProject } from '../services/project-init.js';
import { suggestProjectSetup } from '../services/setup-lifecycle.js';

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  const db = getDb();
  const rows = await db.select().from(schema.projects);
  res.json(rows);
});

router.post('/', async (req: Request, res: Response) => {
  const { name, path } = req.body as { name: string; path: string };

  if (!name || !path) {
    res.status(400).json({ error: '`name` and `path` are required' });
    return;
  }

  const created = await createProject({ name, path });

  res.status(201).json(created);
});

router.get('/:id', async (req: Request, res: Response) => {
  const db = getDb();
  const [project] = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, req.params.id as string));

  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  res.json(project);
});

router.patch('/:id', async (req: Request, res: Response) => {
  const { name, description, defaultModel, costModel } = (req.body ?? {}) as {
    name?: string | null;
    description?: string | null;
    defaultModel?: string | null;
    costModel?: string | null;
  };
  const updates: Partial<typeof schema.projects.$inferInsert> = {};

  // W27 — future-patch-project-fields: allow renaming and describing a project.
  if (name !== undefined) {
    if (typeof name !== 'string' || name.trim() === '') {
      res.status(400).json({ error: '`name` must be a non-empty string' });
      return;
    }
    updates.name = name.trim();
  }

  if (description !== undefined) {
    if (description === null || description === '') {
      updates.description = null;
    } else if (typeof description !== 'string') {
      res.status(400).json({ error: '`description` must be a string or null' });
      return;
    } else if (description.length > 4000) {
      res.status(400).json({ error: '`description` must not exceed 4000 characters' });
      return;
    } else {
      updates.description = description;
    }
  }

  if (defaultModel !== undefined) {
    let normalized: string | null = null;
    if (typeof defaultModel === 'string') {
      const trimmed = defaultModel.trim();
      if (trimmed === '' || trimmed.toLowerCase() === 'auto') {
        normalized = null;
      } else {
        normalized = trimmed;
      }
    }
    updates.defaultModel = normalized;
  }

  // Stream D — D6: cost model toggle. 'usd' | 'gh_multipliers' | null (use env default).
  if (costModel !== undefined) {
    if (costModel === null || costModel === '') {
      updates.costModel = null;
    } else if (costModel === 'usd' || costModel === 'gh_multipliers') {
      updates.costModel = costModel;
    } else {
      res.status(400).json({ error: "costModel must be 'usd', 'gh_multipliers', or null" });
      return;
    }
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: 'No supported fields to update' });
    return;
  }

  const db = getDb();
  const [updated] = await db
    .update(schema.projects)
    .set(updates)
    .where(eq(schema.projects.id, req.params.id as string))
    .returning();

  if (!updated) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  res.json(updated);
});

router.delete('/:id', async (req: Request, res: Response) => {
  const db = getDb();
  const deleted = await db
    .delete(schema.projects)
    .where(eq(schema.projects.id, req.params.id as string))
    .returning();

  if (deleted.length === 0) {
    res.status(404).json({ ok: false, error: 'Project not found' });
    return;
  }

  res.status(204).send();
});

// ---------------------------------------------------------------------------
// POST /suggest
// LLM-backed setup proposal with deterministic built-in bundle fallback.
// ---------------------------------------------------------------------------
router.post('/suggest', async (req: Request, res: Response) => {
  const { description = '' } = (req.body ?? {}) as { description?: string };

  if (typeof description !== 'string') {
    res.status(400).json({ error: '`description` must be a string' });
    return;
  }

  try {
    const suggestion = await suggestProjectSetup(description);
    res.json(suggestion);
  } catch (err) {
    const status = (err as Error & { status?: number }).status ?? 500;
    res.status(status).json({ error: err instanceof Error ? err.message : 'Internal server error' });
  }
});

export default router;
