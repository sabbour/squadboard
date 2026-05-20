import { Router, Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { discoverSquadDirectories, validateSquadDir } from '../services/squad-discovery.js';
import { linkProjectToSquad } from '../services/project-squad.js';
import { assertSafeSquadScaffoldTarget, scaffoldSquad } from '../services/setup-lifecycle.js';
import { getDb, schema } from '../db/index.js';
import { assertProjectPathAvailable, findProjectBySquadPath } from '../services/project-path-uniqueness.js';

const router = Router();

function errorBody(err: unknown): Record<string, unknown> {
  const typed = err as Error & { code?: string; projectId?: string; projectName?: string; path?: string };
  return {
    ok: false,
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
    res.status(errorStatus(err)).json(errorBody(err));
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
    res.status(errorStatus(err)).json(errorBody(err));
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
    const project = await registerProject(squadPath, projectName, 'filesystem');

    res.status(201).json({
      ok: true,
      data: { projectId: project.projectId, name: project.projectName, squadPath: project.squadPath },
    });
  } catch (err) {
    res.status(errorStatus(err)).json(errorBody(err));
  }
});

async function registerProject(
  squadPath: string,
  projectName: string,
  storageProviderMode: 'postgresql' | 'filesystem' = 'postgresql',
): Promise<{ projectId: string; projectName: string; squadPath: string }> {
  const db = getDb();
  const owner = await findProjectBySquadPath(squadPath);
  let project: typeof schema.projects.$inferSelect | undefined;
  if (owner) {
    const existing = await db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, owner.id))
      .limit(1);
    project = existing[0];
  }
  if (!project) {
    const safePath = await assertProjectPathAvailable(squadPath);
    const [inserted] = await db
      .insert(schema.projects)
      .values({ name: projectName, path: safePath, storageProviderMode })
      .returning();
    project = inserted;
  } else {
    const safePath = await assertProjectPathAvailable(squadPath, { excludeProjectId: project.id });
    const updates: Partial<typeof schema.projects.$inferInsert> = {};
    if (!project.storageProviderMode) updates.storageProviderMode = storageProviderMode;
    if (project.path !== safePath) updates.path = safePath;
    if (Object.keys(updates).length > 0) {
      const [updated] = await db
        .update(schema.projects)
        .set(updates)
        .where(eq(schema.projects.id, project.id))
        .returning();
      project = updated ?? project;
    }
  }

  await linkProjectToSquad(project.id, project.path);
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

    const squadPath = assertSafeSquadScaffoldTarget(path.join(dirPath, '.squad'));
    await assertProjectPathAvailable(squadPath);

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
    res.status(errorStatus(err)).json(errorBody(err));
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
    const squadPath = assertSafeSquadScaffoldTarget(path.join(projectPath, '.squad'));
    await assertProjectPathAvailable(squadPath);

    // Reject if project directory already exists
    try {
      await fs.stat(projectPath);
      res.status(409).json({ ok: false, error: `${projectPath} already exists` });
      return;
    } catch {
      // Not found — proceed
    }

    await fs.mkdir(projectPath, { recursive: true });
    await scaffoldSquad({ squadPath, projectName });
    const registration = await registerProject(squadPath, projectName);

    res.status(201).json({
      ok: true,
      data: { ...registration, projectPath },
    });
  } catch (err) {
    res.status(errorStatus(err)).json(errorBody(err));
  }
});

export default router;
