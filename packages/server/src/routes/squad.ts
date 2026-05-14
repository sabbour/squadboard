import { Router, Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { discoverSquadDirectories, validateSquadDir } from '../services/squad-discovery.js';
import { linkProjectToSquad } from '../services/project-squad.js';
import { getDb, schema } from '../db/index.js';

const router = Router();

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

export default router;
