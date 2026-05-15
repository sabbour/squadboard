import { Router } from 'express';
import type { Request, Response } from 'express';
import { getPool } from '../db/index.js';

const router = Router({ mergeParams: true });

// Default column metadata seeded on first project access.
const COLUMN_DEFAULTS = [
  {
    columnId: 'backlog',
    label: 'Backlog',
    description: 'Captured but not yet committed to. Things you\'re considering.',
    color: '#6e7681',
    position: 0,
  },
  {
    columnId: 'todo',
    label: 'To Do',
    description: 'Committed work, ready to pick up. The next thing on deck.',
    color: '#1f6feb',
    position: 1,
  },
  {
    columnId: 'in_progress',
    label: 'In Progress',
    description: 'Actively being worked on by an agent or human.',
    color: '#fb950b',
    position: 2,
  },
  {
    columnId: 'in_review',
    label: 'In Review',
    description: 'Work complete; awaiting review or feedback.',
    color: '#8957e5',
    position: 3,
  },
  {
    columnId: 'done',
    label: 'Done',
    description: 'Shipped. Closed. Out of scope.',
    color: '#238636',
    position: 4,
  },
];

// Color must be exactly '#' + 6 hex digits.
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function handleError(res: Response, err: unknown) {
  console.error('[column-meta] error:', err);
  res.status(500).json({ ok: false, error: 'Internal server error' });
}

/** Inserts the 5 default rows for a project if they don't exist yet. */
async function seedDefaults(projectId: string): Promise<void> {
  const pool = getPool();
  for (const d of COLUMN_DEFAULTS) {
    await pool.query(
      `INSERT INTO column_meta (project_id, column_id, label, description, color, position)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (project_id, column_id) DO NOTHING`,
      [projectId, d.columnId, d.label, d.description, d.color, d.position],
    );
  }
}

// GET /api/projects/:projectId/columns
router.get('/', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params as Record<string, string>;
    const pool = getPool();

    await seedDefaults(projectId);

    const { rows } = await pool.query(
      `SELECT id, column_id AS "columnId", label, description, color, position
       FROM column_meta
       WHERE project_id = $1
       ORDER BY position ASC`,
      [projectId],
    );

    res.json({ ok: true, data: rows });
  } catch (err) {
    handleError(res, err);
  }
});

// PATCH /api/projects/:projectId/columns/:columnId
router.patch('/:columnId', async (req: Request, res: Response) => {
  try {
    const { projectId, columnId } = req.params as Record<string, string>;
    const { label, description, color } = req.body as {
      label?: unknown;
      description?: unknown;
      color?: unknown;
    };

    // Validate inputs
    if (label !== undefined) {
      if (typeof label !== 'string' || label.trim().length === 0 || label.length > 80) {
        res.status(400).json({ ok: false, error: 'label must be a non-empty string of max 80 chars' });
        return;
      }
    }
    if (description !== undefined && description !== null) {
      if (typeof description !== 'string' || description.length > 1000) {
        res.status(400).json({ ok: false, error: 'description must be a string of max 1000 chars' });
        return;
      }
    }
    if (color !== undefined) {
      if (typeof color !== 'string' || !COLOR_RE.test(color)) {
        res.status(400).json({ ok: false, error: 'color must be a 6-digit hex string like #1f6feb' });
        return;
      }
    }

    const pool = getPool();

    // Ensure the row exists (seed if needed)
    await seedDefaults(projectId);

    const sets: string[] = ['updated_at = NOW()'];
    const params: unknown[] = [projectId, columnId];
    let idx = 3;

    if (label !== undefined) { sets.push(`label = $${idx++}`); params.push((label as string).trim()); }
    if (description !== undefined) { sets.push(`description = $${idx++}`); params.push(description); }
    if (color !== undefined) { sets.push(`color = $${idx++}`); params.push(color); }

    const { rows } = await pool.query(
      `UPDATE column_meta
       SET ${sets.join(', ')}
       WHERE project_id = $1 AND column_id = $2
       RETURNING id, column_id AS "columnId", label, description, color, position`,
      params,
    );

    if (rows.length === 0) {
      res.status(404).json({ ok: false, error: 'Column not found' });
      return;
    }

    res.json({ ok: true, data: rows[0] });
  } catch (err) {
    handleError(res, err);
  }
});

// POST /api/projects/:projectId/columns/reset
router.post('/reset', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params as Record<string, string>;
    const pool = getPool();

    await pool.query(`DELETE FROM column_meta WHERE project_id = $1`, [projectId]);
    await seedDefaults(projectId);

    const { rows } = await pool.query(
      `SELECT id, column_id AS "columnId", label, description, color, position
       FROM column_meta
       WHERE project_id = $1
       ORDER BY position ASC`,
      [projectId],
    );

    res.json({ ok: true, data: rows });
  } catch (err) {
    handleError(res, err);
  }
});

export default router;
