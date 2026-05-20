import { Router } from 'express';
import type { Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  getDb,
  getPool,
  isPgliteCatalogCorruptionError,
  schema,
  withPgliteOidRetry,
} from '../db/index.js';
import { createProject } from '../services/project-init.js';
import { suggestProjectSetup } from '../services/setup-lifecycle.js';
import { isInternalSquadWorkspacePath } from '../services/squad-path-safety.js';
import { assertProjectPathAvailable } from '../services/project-path-uniqueness.js';

const router = Router();

function errorPayload(err: unknown): Record<string, unknown> {
  const typed = err as Error & {
    code?: string;
    projectId?: string;
    projectName?: string;
    path?: string;
  };
  return {
    error: err instanceof Error ? err.message : String(err),
    ...(typed.code ? { code: typed.code } : {}),
    ...(typed.projectId ? { projectId: typed.projectId } : {}),
    ...(typed.projectName ? { projectName: typed.projectName } : {}),
    ...(typed.path ? { path: typed.path } : {}),
  };
}

function errorStatus(err: unknown): number {
  return (err as Error & { status?: number }).status ?? 500;
}

router.get('/', async (_req: Request, res: Response) => {
  const db = getDb();
  const rows = await db.select().from(schema.projects);
  res.json(rows.filter((project) => !isInternalSquadWorkspacePath(project.path)));
});

router.post('/', async (req: Request, res: Response) => {
  const { name, path } = req.body as { name: string; path: string };

  if (!name || !path) {
    res.status(400).json({ error: '`name` and `path` are required' });
    return;
  }

  try {
    const created = await createProject({ name, path });
    res.status(201).json(created);
  } catch (err) {
    res.status(errorStatus(err)).json(errorPayload(err));
  }
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
  const { name, description, defaultModel, costModel, path: projectPath, squadPath } = (req.body ?? {}) as {
    name?: string | null;
    description?: string | null;
    defaultModel?: string | null;
    costModel?: string | null;
    path?: string | null;
    squadPath?: string | null;
  };
  const updates: Partial<typeof schema.projects.$inferInsert> = {};
  const projectId = req.params.id as string;

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

  // Cost model toggle. Keep gh_multipliers as a legacy alias for AI Credits.
  if (costModel !== undefined) {
    if (costModel === null || costModel === '') {
      updates.costModel = null;
    } else if (costModel === 'usd' || costModel === 'ai_credits' || costModel === 'gh_multipliers') {
      updates.costModel = costModel;
    } else {
      res.status(400).json({ error: "costModel must be 'usd', 'ai_credits', 'gh_multipliers', or null" });
      return;
    }
  }

  const requestedPath = projectPath ?? squadPath;
  if (requestedPath !== undefined) {
    if (typeof requestedPath !== 'string' || requestedPath.trim() === '') {
      res.status(400).json({ error: '`path` must be a non-empty string' });
      return;
    }
    try {
      updates.path = await assertProjectPathAvailable(requestedPath, { excludeProjectId: projectId });
    } catch (err) {
      res.status(errorStatus(err)).json(errorPayload(err));
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
    .where(eq(schema.projects.id, projectId))
    .returning();

  if (!updated) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  res.json(updated);
});

// ---------------------------------------------------------------------------
// DELETE /api/projects/:id
//
// Body (optional JSON): { deleteFolder?: boolean }
//   deleteFolder = false (default) → removes metadata only; folder untouched.
//   deleteFolder = true            → additionally removes the project folder
//                                   from disk after extensive safety checks.
//
// Response: JSON 200 { ok: true, deleted: { metadata: true, folder: string|false, folderError?: string } }
// ---------------------------------------------------------------------------

/**
 * Resolve the underlying project folder from the registered path.
 *
 * When `projectPath` ends with `.squad` (the typical convention), the folder
 * is the *parent* of that directory. Otherwise the path is used as-is.
 *
 * Returns an error string when the path is absent, unsafe, or points outside
 * a recognised project directory.
 */
async function resolveSafeFolderPath(
  projectPath: string,
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  if (!projectPath || projectPath.trim() === '') {
    return { ok: false, error: 'Project has no path configured' };
  }

  const rawProjectPath = projectPath.trim();
  if (!path.isAbsolute(rawProjectPath)) {
    return { ok: false, error: 'Project path must be absolute' };
  }

  const resolved = path.resolve(rawProjectPath);

  // If the registered path is the .squad directory itself, operate on its parent.
  const folderPath =
    resolved === '/.squad' ||
    resolved.endsWith('/.squad') ||
    resolved.endsWith(path.sep + '.squad')
      ? path.dirname(resolved)
      : resolved;

  // Refuse to delete filesystem anchors.
  if (folderPath === '/') {
    return { ok: false, error: 'Refusing to delete the root directory' };
  }

  const home = os.homedir();
  if (folderPath === home) {
    return { ok: false, error: 'Refusing to delete the home directory' };
  }

  const cwd = process.cwd();
  // Refuse if the folder IS the cwd, or if it is an ancestor of the cwd
  // (which would take out the running server's working directory / repo root).
  if (folderPath === cwd || cwd.startsWith(folderPath + path.sep)) {
    return {
      ok: false,
      error: 'Refusing to delete the server working directory or one of its ancestors',
    };
  }

  // Refuse if the folder is an ancestor of the home directory.
  if (home.startsWith(folderPath + path.sep)) {
    return { ok: false, error: 'Refusing to delete an ancestor of the home directory' };
  }

  // Verify the folder exists and is a directory.
  try {
    const stat = await fs.stat(folderPath);
    if (!stat.isDirectory()) {
      return { ok: false, error: 'Project path is not a directory' };
    }
  } catch {
    return { ok: false, error: 'Project folder does not exist on disk' };
  }

  // Require a .squad subdirectory to confirm this is a managed project folder,
  // guarding against accidental deletion of unrelated directories.
  const squadDir = path.join(folderPath, '.squad');
  try {
    await fs.stat(squadDir);
  } catch {
    return {
      ok: false,
      error: 'Project folder does not contain a .squad directory — refusing to delete',
    };
  }

  return { ok: true, path: folderPath };
}

async function deleteProjectMetadataWithPgliteTriggerBypass(projectId: string): Promise<void> {
  const pool = getPool();
  let replicationRoleChanged = false;

  await pool.query('BEGIN');
  try {
    await pool.query('DELETE FROM settings WHERE project_id::text = $1', [projectId]);
    await pool.query('SET session_replication_role = replica');
    replicationRoleChanged = true;
    const result = await pool.query('DELETE FROM projects WHERE id::text = $1', [projectId]);
    if ((result.rowCount ?? 0) === 0) {
      throw new Error('Project not found during PGlite trigger-bypass deletion');
    }
    await pool.query('SET session_replication_role = origin');
    replicationRoleChanged = false;
    await pool.query('COMMIT');
  } catch (err) {
    if (replicationRoleChanged) {
      try {
        await pool.query('SET session_replication_role = origin');
      } catch (resetErr) {
        console.error('[projects] failed to restore session_replication_role:', resetErr);
      }
    }
    try {
      await pool.query('ROLLBACK');
    } catch (rollbackErr) {
      console.error('[projects] failed to roll back trigger-bypass project delete:', rollbackErr);
    }
    throw err;
  }
}

router.delete('/:id', async (req: Request, res: Response) => {
  const deleteFolder = (req.body as { deleteFolder?: unknown })?.deleteFolder === true;

  // Fetch the row first — we need the path for the optional folder delete
  // and to return a 404 before touching anything.
  //
  // withPgliteOidRetry handles transient PGlite stale-OID failures by clearing
  // prepared statements and, if needed, reopening the PGlite connection.
  let project: typeof schema.projects.$inferSelect | undefined;
  try {
    const rows = await withPgliteOidRetry(() => {
      const db = getDb();
      return db
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.id, req.params.id as string));
    });
    project = rows[0];
    if (!project) {
      const db = getDb();
      const allProjects = await db.select().from(schema.projects);
      project = allProjects.find((candidate) => candidate.id === req.params.id);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[projects] DELETE lookup failed:', msg);
    res.status(500).json({ ok: false, error: `Database error during project lookup: ${msg}` });
    return;
  }

  if (!project) {
    res.status(404).json({ ok: false, error: 'Project not found' });
    return;
  }

  // Validate the folder path *before* making any mutations, so a bad path
  // never leaves the metadata in a half-deleted state.
  let resolvedFolderPath: string | null = null;
  if (deleteFolder) {
    const guard = await resolveSafeFolderPath(project.path);
    if (!guard.ok) {
      res.status(400).json({ ok: false, error: guard.error });
      return;
    }
    resolvedFolderPath = guard.path;
  }

  // Delete project-scoped settings first (no CASCADE on this FK), then the
  // project row (all other child tables carry CASCADE).
  // Same stale-OID retry guard covers both deletes as a single atomic unit.
  const projectToDelete = project;
  try {
    await withPgliteOidRetry(async () => {
      const db = getDb();
      await db.delete(schema.settings).where(eq(schema.settings.projectId, projectToDelete.id));
      await db.delete(schema.projects).where(eq(schema.projects.id, projectToDelete.id));
    });
  } catch (err) {
    if (isPgliteCatalogCorruptionError(err)) {
      try {
        console.warn(
          '[projects] DELETE native cascade hit PGlite catalog corruption; using metadata-only trigger bypass',
          err,
        );
        await deleteProjectMetadataWithPgliteTriggerBypass(projectToDelete.id);
      } catch (fallbackErr) {
        const msg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
        console.error('[projects] DELETE trigger-bypass fallback failed:', msg);
        res
          .status(500)
          .json({ ok: false, error: `Database error during project deletion fallback: ${msg}` });
        return;
      }
    } else {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[projects] DELETE mutation failed:', msg);
      res.status(500).json({ ok: false, error: `Database error during project deletion: ${msg}` });
      return;
    }
  }

  const remainingProjects = await getDb().select().from(schema.projects);
  if (remainingProjects.some((candidate) => candidate.id === projectToDelete.id)) {
    try {
      console.warn(
        '[projects] DELETE native path returned without removing the row; using metadata-only trigger bypass',
      );
      await deleteProjectMetadataWithPgliteTriggerBypass(projectToDelete.id);
    } catch (fallbackErr) {
      const msg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
      console.error('[projects] DELETE trigger-bypass fallback failed:', msg);
      res
        .status(500)
        .json({ ok: false, error: `Database error during project deletion fallback: ${msg}` });
      return;
    }
  }

  // Optionally remove the folder from disk — only after metadata is gone.
  let folderDeleted: string | false = false;
  let folderError: string | undefined;
  if (deleteFolder && resolvedFolderPath) {
    try {
      await fs.rm(resolvedFolderPath, { recursive: true, force: true });
      folderDeleted = resolvedFolderPath;
    } catch (err) {
      folderError = err instanceof Error ? err.message : String(err);
    }
  }

  res.json({ ok: true, deleted: { metadata: true, folder: folderDeleted, folderError } });
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
