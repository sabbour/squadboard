/**
 * templates.ts — Phase 19 Templates CRUD routes
 *
 * Mounts at /api/templates
 *
 * GET    /                              list all templates; filter by ?kind=workflow|team|project
 * GET    /builtin-projects                     list generic built-in Project Templates
 * POST   /builtin-projects/:id/apply           apply a Project Template to create a project
 * GET    /squadboard-apps                      list domain-specific Squadboard Apps
 * POST   /squadboard-apps/:id/apply            install a local Squadboard App as a project
 * POST   /squadboard-apps/install-from-github  clone a GitHub Squadboard App and install as a project
 * GET    /:id                                  get single template (with full payload)
 * DELETE /:id                                  delete template
 *
 * Response envelope (uniform with the other portability routes — see
 * packages/client/src/api/templates.ts r5 contract):
 *
 *   GET  /                                      { ok: true, data: { templates: TemplateSummary[] } }
 *   GET  /builtin-projects                      { ok: true, data: { templates: BuiltinBundleSummary[] } }
 *   POST /builtin-projects/:id/apply            { ok: true, data: { project: { id, name }, result: ApplyResult, scaffold } }
 *   GET  /squadboard-apps                       { ok: true, data: { apps: BuiltinBundleSummary[] } }
 *   POST /squadboard-apps/:id/apply             { ok: true, data: { project: { id, name }, result: ApplyResult, scaffold } }
 *   POST /squadboard-apps/install-from-github   { ok: true, data: { project: { id, name }, result: ApplyResult, scaffold } }
 *   GET  /:id                                   { ok: true, data: { template: TemplateDetail } }
 *   DELETE /:id                                 { ok: true, data: { template: TemplateSummary } }
 *
 * Wave 10 B1: previously these returned `{ data: rows }` / `{ data: tmpl }`
 * which caused `useTemplates`/`useTemplate` (which read `.data.templates` /
 * `.data.template`) to silently see `undefined` → empty list → "No project
 * templates yet" even when project templates existed, breaking the entire
 * Create-from-template flow on the Projects page.
 *
 * Wave 16 (Hockney): added /builtin-projects routes backed by builtin-bundles.ts scanner.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import {
  getBuiltinProjectTemplateBundles,
  getBuiltinSquadboardApps,
  getBuiltinBundle,
  getBuiltinBundleDir,
} from '../services/builtin-bundles.js';
import { applyBundle, loadBundle } from '../services/bundle-loader.js';
import { assertSafeSquadScaffoldTarget, scaffoldSquadFromBundle } from '../services/setup-lifecycle.js';
import type { SquadboardBundle } from '@sabbour/squadboard-sdk/bundle';

const router = Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const APP_INSTALL_SCRATCH_DIR = join(REPO_ROOT, '.squad', '.scratch', 'app-installs');

// Pick only the summary columns the client needs in list views — `payload` is
// often large (full project bundle) and is only required from GET /:id.
function toSummary(row: typeof schema.templates.$inferSelect) {
  return {
    id:          row.id,
    kind:        row.kind,
    name:        row.name,
    description: row.description ?? null,
    createdAt:   row.createdAt,
    // Stream D — D7: expose projectId so the Templates page can offer a
    // "My templates" filter scoped to the active project.
    projectId:   row.projectId ?? null,
  };
}

function parseGitHubRepoUrl(repoUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(repoUrl.trim());
  } catch {
    throw Object.assign(new Error('Enter a valid GitHub repository URL.'), { status: 400 });
  }

  if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== 'github.com') {
    throw Object.assign(new Error('Only https://github.com/<owner>/<repo> URLs are supported.'), { status: 400 });
  }

  const match = parsed.pathname.match(/^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/);
  if (!match) {
    throw Object.assign(new Error('GitHub URL must point to a repository, not a file or deep link.'), { status: 400 });
  }

  return `https://github.com/${match[1]}/${match[2]}.git`;
}

function normalizeAppPath(appPath?: string): string {
  const trimmed = (appPath ?? '').trim().replace(/^\/+|\/+$/g, '');
  if (!trimmed) return '';
  if (trimmed.split('/').some((part) => part === '..' || part === '.')) {
    throw Object.assign(new Error('App path cannot contain . or .. segments.'), { status: 400 });
  }
  return trimmed;
}

function normalizeRef(ref?: string): string | null {
  const trimmed = ref?.trim();
  if (!trimmed) return null;
  if (!/^[A-Za-z0-9._/-]{1,100}$/.test(trimmed)) {
    throw Object.assign(new Error('Git ref can only contain letters, numbers, dots, underscores, slashes, and hyphens.'), { status: 400 });
  }
  return trimmed;
}

function runGit(args: string[], cwd?: string): Promise<void> {
  return new Promise((resolveRun, reject) => {
    const child = spawn('git', args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf-8');
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolveRun();
        return;
      }
      reject(new Error(stderr.trim() || `git exited with status ${code}`));
    });
  });
}

async function ensureNewProjectName(projectName: string): Promise<void> {
  const db = getDb();
  const existing = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(eq(schema.projects.name, projectName))
    .limit(1);

  if (existing.length > 0) {
    throw Object.assign(
      new Error(`A project named "${projectName}" already exists. Choose a unique project name to install this Squadboard App as a new project.`),
      { status: 409 },
    );
  }
}

async function assertSquadboardAppManifest(appDir: string): Promise<void> {
  const manifestPath = join(appDir, 'squadapp.json');
  try {
    const raw = await readFile(manifestPath, 'utf-8');
    let manifest: Record<string, unknown>;
    try {
      manifest = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      throw Object.assign(new Error('squadapp.json must be valid JSON.'), { status: 400 });
    }
    const kind = typeof manifest['kind'] === 'string' ? manifest['kind'] : 'project-template';
    if (kind !== 'squadboard-app') {
      throw Object.assign(
        new Error('GitHub repo contains a project template, not a Squadboard App. Use Projects -> Create from template for generic templates.'),
        { status: 400 },
      );
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }
    throw err;
  }
}

async function applyBundleAsProject(
  bundle: SquadboardBundle,
  bundleDir: string,
  input: { squadPath?: string; name?: string; requireNewProject?: boolean },
) {
  if (!input.squadPath?.trim()) {
    throw Object.assign(new Error('`squadPath` is required'), { status: 400 });
  }
  if (!isAbsolute(input.squadPath.trim())) {
    throw Object.assign(new Error('`squadPath` must be an absolute project folder or .squad path'), { status: 400 });
  }

  const projectName = input.name?.trim() || bundle.project?.name || bundle.manifest.name;
  const targetSquadPath = assertSafeSquadScaffoldTarget(input.squadPath);
  if (input.requireNewProject) {
    await ensureNewProjectName(projectName);
  }
  const bundleToApply: SquadboardBundle = {
    ...bundle,
    project: {
      ...(bundle.project ?? { name: projectName }),
      name: projectName,
      settings: {
        ...(bundle.project?.settings ?? {}),
        squadPath: targetSquadPath,
      },
    },
  };

  const result = await applyBundle(bundleToApply, { bundleDir });
  if (!result.meta.projectId) {
    throw new Error('Bundle applied but no project was created');
  }

  const scaffold = await scaffoldSquadFromBundle(bundleToApply, {
    squadPath: targetSquadPath,
    projectName,
  });

  return {
    project: { id: result.meta.projectId, name: projectName },
    result,
    scaffold,
  };
}

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

    res.json({ ok: true, data: { templates: rows.map(toSummary) } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

// ---------------------------------------------------------------------------
// GET /api/templates/builtin-projects
// Returns the list of built-in project bundles scanned from bundles/ at
// the workspace root.  Must be declared BEFORE /:id to avoid Express
// swallowing "builtin-projects" as an id param.
// ---------------------------------------------------------------------------
router.get('/builtin-projects', async (_req: Request, res: Response) => {
  try {
    const bundles = await getBuiltinProjectTemplateBundles();
    res.json({ ok: true, data: { templates: bundles } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

// ---------------------------------------------------------------------------
// GET /api/templates/squadboard-apps
// Returns installable, domain-specific Squadboard Apps. Project templates stay
// generic and are exposed through /builtin-projects only.
// ---------------------------------------------------------------------------
router.get('/squadboard-apps', async (_req: Request, res: Response) => {
  try {
    const apps = await getBuiltinSquadboardApps();
    res.json({ ok: true, data: { apps } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

// ---------------------------------------------------------------------------
// POST /api/templates/builtin-projects/:bundleId/apply
// Apply a built-in bundle to create a new project.
// Body: { squadPath: string, name?: string }
// ---------------------------------------------------------------------------
router.post('/builtin-projects/:bundleId/apply', async (req: Request, res: Response) => {
  try {
    const { bundleId } = req.params as { bundleId: string };
    const { squadPath, name } = req.body as { squadPath?: string; name?: string };

    const bundle = await getBuiltinBundle(bundleId);
    if (!bundle) {
      res.status(404).json({ ok: false, error: `Built-in bundle "${bundleId}" not found` });
      return;
    }

    const bundleDir = await getBuiltinBundleDir(bundleId);
    const applied = await applyBundleAsProject(bundle, bundleDir ?? process.cwd(), { name, squadPath });

    res.json({
      ok: true,
      data: applied,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = (err as Error & { status?: number }).status ?? 500;
    res.status(status).json({ ok: false, error: msg });
  }
});

// ---------------------------------------------------------------------------
// POST /api/templates/squadboard-apps/:bundleId/apply
// Apply a built-in/reference Squadboard App to create a project.
// ---------------------------------------------------------------------------
router.post('/squadboard-apps/:bundleId/apply', async (req: Request, res: Response) => {
  try {
    const { bundleId } = req.params as { bundleId: string };
    const { squadPath, name } = req.body as { squadPath?: string; name?: string };

    const appIds = new Set((await getBuiltinSquadboardApps()).map((app) => app.bundleId));
    if (!appIds.has(bundleId)) {
      res.status(404).json({ ok: false, error: `Squadboard App "${bundleId}" not found` });
      return;
    }

    const bundle = await getBuiltinBundle(bundleId);
    const bundleDir = await getBuiltinBundleDir(bundleId);
    if (!bundle || !bundleDir) {
      res.status(404).json({ ok: false, error: `Squadboard App "${bundleId}" not found` });
      return;
    }

    const applied = await applyBundleAsProject(bundle, bundleDir, { name, squadPath, requireNewProject: true });
    res.json({ ok: true, data: applied });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = (err as Error & { status?: number }).status ?? 500;
    res.status(status).json({ ok: false, error: msg });
  }
});

// ---------------------------------------------------------------------------
// POST /api/templates/squadboard-apps/install-from-github
// Clone a GitHub repo, load squad-bundle.json from root or appPath, and apply
// it as a new project. The UI warns users to trust the source first.
// ---------------------------------------------------------------------------
router.post('/squadboard-apps/install-from-github', async (req: Request, res: Response) => {
  const { repoUrl, ref, appPath, squadPath, name } = req.body as {
    repoUrl?: string;
    ref?: string;
    appPath?: string;
    squadPath?: string;
    name?: string;
  };

  if (!repoUrl?.trim()) {
    res.status(400).json({ ok: false, error: '`repoUrl` is required' });
    return;
  }

  let tempRoot: string | null = null;
  try {
    const cloneUrl = parseGitHubRepoUrl(repoUrl);
    const safeRef = normalizeRef(ref);
    const safeAppPath = normalizeAppPath(appPath);
    await mkdir(APP_INSTALL_SCRATCH_DIR, { recursive: true });
    tempRoot = await mkdtemp(join(APP_INSTALL_SCRATCH_DIR, 'github-'));
    const cloneDir = join(tempRoot, 'repo');
    const cloneArgs = ['clone', '--depth', '1', '--filter=blob:none'];
    if (safeRef) cloneArgs.push('--branch', safeRef, '--single-branch');
    cloneArgs.push(cloneUrl, cloneDir);
    await runGit(cloneArgs);

    const appDir = resolve(cloneDir, safeAppPath);
    await assertSquadboardAppManifest(appDir);
    const bundlePath = resolve(appDir, 'squad-bundle.json');
    const { bundle, bundleDir } = await loadBundle(bundlePath);
    const applied = await applyBundleAsProject(bundle, bundleDir, { name, squadPath, requireNewProject: true });
    res.json({ ok: true, data: applied });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = (err as Error & { status?: number }).status ?? 500;
    res.status(status).json({ ok: false, error: msg });
  } finally {
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
    }
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
    res.json({
      ok: true,
      data: {
        template: {
          ...toSummary(tmpl),
          payload: tmpl.payload,
        },
      },
    });
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
    res.json({ ok: true, data: { template: toSummary(deleted[0]) } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

export default router;
