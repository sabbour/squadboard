import { Router, Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { discoverSquadDirectories, validateSquadDir } from '../services/squad-discovery.js';
import { linkProjectToSquad } from '../services/project-squad.js';
import { scaffoldSquad } from '../services/setup-lifecycle.js';
import { getDb, schema } from '../db/index.js';

const router = Router();

/**
 * GET /api/squad/home
 * Returns the server process's home directory.
 */
router.get('/home', (_req: Request, res: Response) => {
  res.json({ path: os.homedir() });
});

/**
 * GET /api/squad/discover
 * Trigger a filesystem scan and return all discovered .squad/ directories.
 * Accepts an optional `paths` query param (comma-separated) for extra roots.
 */
router.get('/discover', async (req: Request, res: Response) => {
  try {
    const extraPaths = req.query.paths
      ? String(req.query.paths)
          .split(',')
          .map((p) => p.trim())
          .filter(Boolean)
      : [];

    const directories = await discoverSquadDirectories(extraPaths);
    res.json({ ok: true, data: directories });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message });
  }
});

/**
 * GET /api/squad/validate?path=/some/path
 * Validate a manually-entered path as a .squad/ directory.
 */
router.get('/validate', async (req: Request, res: Response) => {
  const rawPath = req.query.path;
  if (!rawPath || typeof rawPath !== 'string') {
    res.status(400).json({ ok: false, error: 'Query param "path" is required' });
    return;
  }

  try {
    const result = await validateSquadDir(rawPath);
    res.json({ ok: true, data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message });
  }
});

/**
 * POST /api/squad/register
 * Register a discovered .squad/ path as a project (creates a projects row).
 *
 * Body: { path: string; name?: string }
 */
router.post('/register', async (req: Request, res: Response) => {
  const { path: squadPath, name } = req.body as { path?: string; name?: string };

  if (!squadPath) {
    res.status(400).json({ ok: false, error: 'Body field "path" is required' });
    return;
  }

  try {
    // Validate before registering
    const validation = await validateSquadDir(squadPath);
    if (!validation.valid) {
      res.status(422).json({ ok: false, error: 'Invalid .squad/ directory', details: validation.errors });
      return;
    }

    const projectName = name ?? squadPath.split('/').at(-2) ?? 'unnamed';
    const db = getDb();

    // Upsert: if this path is already registered, return the existing project.
    const existing = await db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.path, squadPath))
      .limit(1);

    let project = existing[0];

    if (!project) {
      const [inserted] = await db
        .insert(schema.projects)
        .values({ name: projectName, path: squadPath })
        .returning();
      project = inserted;
    }

    // Link sidecar (idempotent — Kobayashi's service uses this for getSquadContext)
    await linkProjectToSquad(project.id, squadPath);

    res.status(201).json({
      ok: true,
      data: { projectId: project.id, name: project.name, squadPath: project.path },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message });
  }
});

async function registerProject(
  squadPath: string,
  projectName: string,
): Promise<{ projectId: string; projectName: string; squadPath: string }> {
  const db = getDb();
  const existing = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.path, squadPath))
    .limit(1);

  let project = existing[0];
  if (!project) {
    const [inserted] = await db
      .insert(schema.projects)
      .values({ name: projectName, path: squadPath })
      .returning();
    project = inserted;
  }

  await linkProjectToSquad(project.id, squadPath);
  return { projectId: project.id, projectName: project.name, squadPath: project.path };
}

/**
 * POST /api/squad/init
 * Scaffold .squad/ into an existing directory and register it as a project.
 *
 * Body: { path: string; projectName?: string }
 */
router.post('/init', async (req: Request, res: Response) => {
  const { path: dirPath, projectName } = req.body as { path?: string; projectName?: string };

  if (!dirPath) {
    res.status(400).json({ ok: false, error: 'Body field "path" is required' });
    return;
  }

  try {
    // Verify the target directory exists
    try {
      const stat = await fs.stat(dirPath);
      if (!stat.isDirectory()) {
        res.status(422).json({ ok: false, error: 'Directory does not exist' });
        return;
      }
    } catch {
      res.status(422).json({ ok: false, error: 'Directory does not exist' });
      return;
    }

    const squadPath = path.join(dirPath, '.squad');

    // Reject if .squad/ already exists
    try {
      await fs.stat(squadPath);
      res.status(409).json({ ok: false, error: '.squad/ already exists at this path' });
      return;
    } catch {
      // Not found — proceed
    }

    const name = projectName ?? path.basename(dirPath);
    await scaffoldSquad({ squadPath, projectName: name });
    const data = await registerProject(squadPath, name);

    res.status(201).json({ ok: true, data });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message });
  }
});

/**
 * POST /api/squad/create
 * Create a new project directory, scaffold .squad/ inside it, and register it.
 *
 * Body: { parentPath: string; projectName: string }
 */
router.post('/create', async (req: Request, res: Response) => {
  const { parentPath, projectName } = req.body as { parentPath?: string; projectName?: string };

  if (!parentPath || !projectName) {
    res.status(400).json({ ok: false, error: 'Body fields "parentPath" and "projectName" are required' });
    return;
  }

  try {
    // Verify parentPath exists
    try {
      const stat = await fs.stat(parentPath);
      if (!stat.isDirectory()) {
        res.status(422).json({ ok: false, error: `Parent directory does not exist: ${parentPath}` });
        return;
      }
    } catch {
      res.status(422).json({ ok: false, error: `Parent directory does not exist: ${parentPath}` });
      return;
    }

    const projectPath = path.join(parentPath, projectName);

    // Reject if project directory already exists
    try {
      await fs.stat(projectPath);
      res.status(409).json({ ok: false, error: `${projectPath} already exists` });
      return;
    } catch {
      // Not found — proceed
    }

    await fs.mkdir(projectPath, { recursive: true });
    const squadPath = path.join(projectPath, '.squad');
    await scaffoldSquad({ squadPath, projectName });
    const registration = await registerProject(squadPath, projectName);

    res.status(201).json({
      ok: true,
      data: { ...registration, projectPath },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message });
  }
});

export default router;
