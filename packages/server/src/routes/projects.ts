import { Router } from 'express';
import type { Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';

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

  const db = getDb();
  const [created] = await db
    .insert(schema.projects)
    .values({ name, path })
    .returning();

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
  const { defaultModel } = (req.body ?? {}) as { defaultModel?: string | null };
  const updates: Partial<typeof schema.projects.$inferInsert> = {};

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

export default router;
