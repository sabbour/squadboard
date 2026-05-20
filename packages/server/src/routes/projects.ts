import { Router } from 'express';
import type { Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
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

router.delete('/:id', async (req: Request, res: Response) => {
  const deleteFolder = (req.body as { deleteFolder?: unknown })?.deleteFolder === true;

  const db = getDb();

  // Fetch the row first — we need the path for the optional folder delete
  // and to return a 404 before touching anything.
  const [project] = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, req.params.id as string));

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

  // Delete project-scoped settings first (no CASCADE on this FK).
  await db.delete(schema.settings).where(eq(schema.settings.projectId, project.id));

  // Delete the project row (all other child tables carry CASCADE).
  await db.delete(schema.projects).where(eq(schema.projects.id, project.id));

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
