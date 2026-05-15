/**
 * templates.ts — Phase 19 Templates CRUD routes
 *
 * Mounts at /api/templates
 *
 * GET    /              list all templates; filter by ?kind=workflow|team|project
 * GET    /:id           get single template
 * DELETE /:id           delete template
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { eq, and } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';

const router = Router();

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

    res.json({ ok: true, data: rows });
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
    res.json({ ok: true, data: tmpl });
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
    res.json({ ok: true, data: deleted[0] });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

export default router;
