import { Router } from 'express';
import type { Request, Response } from 'express';
import { getPool } from '../db/index.js';

const router = Router({ mergeParams: true });

// Semantic roll-up values.
const VALID_SEMANTICS = ['backlog', 'ready', 'in_progress', 'review', 'done', 'custom'] as const;
type Semantic = typeof VALID_SEMANTICS[number];

// Default column metadata seeded on first project access.
const COLUMN_DEFAULTS: Array<{
  columnId: string; label: string; description: string;
  color: string; position: number; semantic: Semantic; isDefault: boolean;
}> = [
  {
    columnId: 'backlog',
    label: 'Backlog',
    description: 'Captured but not yet committed to. Things you\'re considering.',
    color: '#6e7681',
    position: 0,
    semantic: 'backlog',
    isDefault: true,
  },
  {
    columnId: 'ready',
    label: 'Ready',
    description: 'Committed work that the coordinator and Ralph monitor may pick up next.',
    color: '#1f6feb',
    position: 1,
    semantic: 'ready',
    isDefault: false,
  },
  {
    columnId: 'in_progress',
    label: 'In Progress',
    description: 'Actively being worked on by an agent or human.',
    color: '#fb950b',
    position: 2,
    semantic: 'in_progress',
    isDefault: false,
  },
  {
    columnId: 'in_review',
    label: 'In Review',
    description: 'Work complete; awaiting review or feedback.',
    color: '#8957e5',
    position: 3,
    semantic: 'review',
    isDefault: false,
  },
  {
    columnId: 'done',
    label: 'Done',
    description: 'Shipped. Closed. Out of scope.',
    color: '#238636',
    position: 4,
    semantic: 'done',
    isDefault: false,
  },
];

// Color must be exactly '#' + 6 hex digits.
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
// Column ID: lowercase alphanumeric, hyphens, underscores, 1–40 chars.
const COLUMN_ID_RE = /^[a-z0-9_-]{1,40}$/;

function handleError(res: Response, err: unknown) {
  console.error('[column-meta] error:', err);
  res.status(500).json({ ok: false, error: 'Internal server error' });
}

/** Inserts the 5 default rows for a project if they don't exist yet. */
async function seedDefaults(projectId: string): Promise<void> {
  const pool = getPool();
  for (const d of COLUMN_DEFAULTS) {
    await pool.query(
      `INSERT INTO column_meta (project_id, column_id, label, description, color, position, semantic, is_default)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (project_id, column_id) DO NOTHING`,
      [projectId, d.columnId, d.label, d.description, d.color, d.position, d.semantic, d.isDefault],
    );
  }
}

/** Converts a raw DB row to the camelCase API shape. */
function rowToApi(row: Record<string, unknown>) {
  return {
    id:          row.id,
    columnId:    row.columnId   ?? row.column_id,
    label:       row.label,
    description: row.description ?? null,
    color:       row.color,
    position:    row.position,
    semantic:    row.semantic   ?? 'custom',
    isDefault:   row.isDefault  ?? row.is_default ?? false,
  };
}

// ---------------------------------------------------------------------------
// GET /api/projects/:projectId/columns
// ---------------------------------------------------------------------------
router.get('/', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params as Record<string, string>;
    const pool = getPool();

    await seedDefaults(projectId);

    const { rows } = await pool.query(
      `SELECT id, column_id AS "columnId", label, description, color, position,
              semantic, is_default AS "isDefault"
       FROM column_meta
       WHERE project_id = $1
       ORDER BY position ASC`,
      [projectId],
    );

    res.json({ ok: true, data: rows.map(rowToApi) });
  } catch (err) {
    handleError(res, err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/projects/:projectId/columns  — create a new column
// Must be registered before /:columnId routes.
// ---------------------------------------------------------------------------
router.post('/', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params as Record<string, string>;
    const { columnId, label, description, color, position, semantic } = req.body as {
      columnId?: unknown;
      label?: unknown;
      description?: unknown;
      color?: unknown;
      position?: unknown;
      semantic?: unknown;
    };

    // Validate columnId
    if (typeof columnId !== 'string' || !COLUMN_ID_RE.test(columnId)) {
      res.status(400).json({ ok: false, error: 'columnId must match ^[a-z0-9_-]{1,40}$' });
      return;
    }
    // Validate label
    if (typeof label !== 'string' || label.trim().length === 0 || label.length > 80) {
      res.status(400).json({ ok: false, error: 'label must be a non-empty string of max 80 chars' });
      return;
    }
    // Validate description (optional)
    if (description !== undefined && description !== null) {
      if (typeof description !== 'string' || description.length > 1000) {
        res.status(400).json({ ok: false, error: 'description must be a string of max 1000 chars' });
        return;
      }
    }
    // Validate color
    if (typeof color !== 'string' || !COLOR_RE.test(color)) {
      res.status(400).json({ ok: false, error: 'color must be a 6-digit hex string like #1f6feb' });
      return;
    }
    // Validate semantic (optional, default 'custom')
    const resolvedSemantic: Semantic = (semantic === undefined ? 'custom' : semantic) as Semantic;
    if (!VALID_SEMANTICS.includes(resolvedSemantic)) {
      res.status(400).json({ ok: false, error: `semantic must be one of: ${VALID_SEMANTICS.join(', ')}` });
      return;
    }
    // Validate position (optional)
    if (position !== undefined && (typeof position !== 'number' || !Number.isInteger(position) || position < 0)) {
      res.status(400).json({ ok: false, error: 'position must be a non-negative integer' });
      return;
    }

    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Determine target position: end+1 by default.
      let targetPosition: number;
      if (typeof position === 'number') {
        targetPosition = position;
        // Shift existing columns at or above targetPosition.
        await client.query(
          `UPDATE column_meta SET position = position + 1, updated_at = NOW()
           WHERE project_id = $1 AND position >= $2`,
          [projectId, targetPosition],
        );
      } else {
        const { rows: maxRows } = await client.query<{ max: number }>(
          `SELECT COALESCE(MAX(position), -1) AS max FROM column_meta WHERE project_id = $1`,
          [projectId],
        );
        targetPosition = (maxRows[0]?.max ?? -1) + 1;
      }

      const { rows } = await client.query(
        `INSERT INTO column_meta (project_id, column_id, label, description, color, position, semantic, is_default)
         VALUES ($1, $2, $3, $4, $5, $6, $7, false)
         RETURNING id, column_id AS "columnId", label, description, color, position,
                   semantic, is_default AS "isDefault"`,
        [projectId, columnId, (label as string).trim(), description ?? null, color, targetPosition, resolvedSemantic],
      );

      await client.query('COMMIT');
      res.status(201).json({ ok: true, data: rowToApi(rows[0]) });
    } catch (err: unknown) {
      await client.query('ROLLBACK');
      if (
        err instanceof Error &&
        'code' in err &&
        (err as NodeJS.ErrnoException).code === '23505'
      ) {
        res.status(409).json({ ok: false, error: `Column '${columnId as string}' already exists for this project` });
        return;
      }
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    handleError(res, err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/projects/:projectId/columns/reset  — restore the 5 defaults
// Must be registered before /:columnId routes.
// ---------------------------------------------------------------------------
router.post('/reset', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params as Record<string, string>;
    const pool = getPool();

    await pool.query(`DELETE FROM column_meta WHERE project_id = $1`, [projectId]);
    await seedDefaults(projectId);

    const { rows } = await pool.query(
      `SELECT id, column_id AS "columnId", label, description, color, position,
              semantic, is_default AS "isDefault"
       FROM column_meta
       WHERE project_id = $1
       ORDER BY position ASC`,
      [projectId],
    );

    res.json({ ok: true, data: rows.map(rowToApi) });
  } catch (err) {
    handleError(res, err);
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/projects/:projectId/columns/reorder  — bulk position rewrite
// Must be registered before /:columnId to avoid Express swallowing 'reorder'.
// ---------------------------------------------------------------------------
router.patch('/reorder', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params as Record<string, string>;
    const { order } = req.body as { order?: unknown };

    if (!Array.isArray(order) || order.length === 0 || !order.every((id) => typeof id === 'string')) {
      res.status(400).json({ ok: false, error: '`order` must be a non-empty array of column id strings' });
      return;
    }

    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      for (let i = 0; i < order.length; i++) {
        await client.query(
          `UPDATE column_meta SET position = $1, updated_at = NOW()
           WHERE project_id = $2 AND column_id = $3`,
          [i, projectId, order[i]],
        );
      }

      const { rows } = await client.query(
        `SELECT id, column_id AS "columnId", label, description, color, position,
                semantic, is_default AS "isDefault"
         FROM column_meta
         WHERE project_id = $1
         ORDER BY position ASC`,
        [projectId],
      );

      await client.query('COMMIT');
      res.json({ ok: true, data: rows.map(rowToApi) });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    handleError(res, err);
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/projects/:projectId/columns/:columnId  — update a column
// ---------------------------------------------------------------------------
router.patch('/:columnId', async (req: Request, res: Response) => {
  try {
    const { projectId, columnId } = req.params as Record<string, string>;
    const { label, description, color, semantic, isDefault } = req.body as {
      label?: unknown;
      description?: unknown;
      color?: unknown;
      semantic?: unknown;
      isDefault?: unknown;
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
    if (semantic !== undefined) {
      if (!VALID_SEMANTICS.includes(semantic as Semantic)) {
        res.status(400).json({ ok: false, error: `semantic must be one of: ${VALID_SEMANTICS.join(', ')}` });
        return;
      }
    }

    const pool = getPool();

    // Ensure the row exists (seed if needed)
    await seedDefaults(projectId);

    const sets: string[] = ['updated_at = NOW()'];
    const params: unknown[] = [projectId, columnId];
    let idx = 3;

    if (label !== undefined)       { sets.push(`label = $${idx++}`);       params.push((label as string).trim()); }
    if (description !== undefined) { sets.push(`description = $${idx++}`); params.push(description); }
    if (color !== undefined)       { sets.push(`color = $${idx++}`);       params.push(color); }
    if (semantic !== undefined)    { sets.push(`semantic = $${idx++}`);    params.push(semantic); }

    // isDefault=true: clear all other columns for this project first, then set this one.
    if (isDefault === true) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `UPDATE column_meta SET is_default = false, updated_at = NOW() WHERE project_id = $1`,
          [projectId],
        );
        sets.push(`is_default = true`);
        const { rows } = await client.query(
          `UPDATE column_meta
           SET ${sets.join(', ')}
           WHERE project_id = $1 AND column_id = $2
           RETURNING id, column_id AS "columnId", label, description, color, position,
                     semantic, is_default AS "isDefault"`,
          params,
        );
        await client.query('COMMIT');
        if (rows.length === 0) {
          res.status(404).json({ ok: false, error: 'Column not found' });
          return;
        }
        res.json({ ok: true, data: rowToApi(rows[0]) });
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
      return;
    }

    if (isDefault === false) {
      sets.push(`is_default = false`);
    }

    const { rows } = await pool.query(
      `UPDATE column_meta
       SET ${sets.join(', ')}
       WHERE project_id = $1 AND column_id = $2
       RETURNING id, column_id AS "columnId", label, description, color, position,
                 semantic, is_default AS "isDefault"`,
      params,
    );

    if (rows.length === 0) {
      res.status(404).json({ ok: false, error: 'Column not found' });
      return;
    }

    res.json({ ok: true, data: rowToApi(rows[0]) });
  } catch (err) {
    handleError(res, err);
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/projects/:projectId/columns/:columnId
// Issues in this column must be reassigned: pass ?reassignTo=<columnId>.
// Returns 409 if issues exist but reassignTo is missing.
// ---------------------------------------------------------------------------
router.delete('/:columnId', async (req: Request, res: Response) => {
  try {
    const { projectId, columnId } = req.params as Record<string, string>;
    const { reassignTo } = req.query as Record<string, string>;

    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Check the column exists.
      const { rows: colRows } = await client.query<{ id: string }>(
        `SELECT id FROM column_meta WHERE project_id = $1 AND column_id = $2`,
        [projectId, columnId],
      );
      if (colRows.length === 0) {
        await client.query('ROLLBACK');
        res.status(404).json({ ok: false, error: 'Column not found' });
        return;
      }

      // Guard: must not delete the last column.
      const { rows: countRows } = await client.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM column_meta WHERE project_id = $1`,
        [projectId],
      );
      if (parseInt(countRows[0].count, 10) <= 1) {
        await client.query('ROLLBACK');
        res.status(409).json({ ok: false, error: 'Cannot delete the last column in a project' });
        return;
      }

      // Count issues in this column.
      const { rows: issueCountRows } = await client.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM issues WHERE project_id = $1 AND status = $2 AND archived = 0`,
        [projectId, columnId],
      );
      const issueCount = parseInt(issueCountRows[0].count, 10);

      if (issueCount > 0) {
        if (!reassignTo) {
          await client.query('ROLLBACK');
          res.status(409).json({
            ok: false,
            error: `Column has ${issueCount} issue${issueCount === 1 ? '' : 's'}; pass reassignTo=<columnId>`,
            count: issueCount,
          });
          return;
        }
        // Validate reassignTo column exists for this project.
        const { rows: targetRows } = await client.query<{ id: string }>(
          `SELECT id FROM column_meta WHERE project_id = $1 AND column_id = $2`,
          [projectId, reassignTo],
        );
        if (targetRows.length === 0) {
          await client.query('ROLLBACK');
          res.status(400).json({ ok: false, error: `reassignTo column '${reassignTo}' not found` });
          return;
        }
        // Atomically move all issues to the target column.
        await client.query(
          `UPDATE issues SET status = $1, updated_at = NOW()
           WHERE project_id = $2 AND status = $3 AND archived = 0`,
          [reassignTo, projectId, columnId],
        );
      }

      // Delete the column.
      await client.query(
        `DELETE FROM column_meta WHERE project_id = $1 AND column_id = $2`,
        [projectId, columnId],
      );

      // If this was the default column, assign default to the lowest-position remaining column.
      await client.query(
        `UPDATE column_meta SET is_default = true, updated_at = NOW()
         WHERE id = (
           SELECT id FROM column_meta
           WHERE project_id = $1 AND is_default = false
           ORDER BY position ASC
           LIMIT 1
         )
         AND NOT EXISTS (
           SELECT 1 FROM column_meta WHERE project_id = $1 AND is_default = true
         )`,
        [projectId],
      );

      await client.query('COMMIT');
      res.json({ ok: true });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    handleError(res, err);
  }
});

export default router;
