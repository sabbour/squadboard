/**
 * routes/github-sync.ts — Demo 15: GitHub sync configuration + control endpoints.
 *
 * GET    /api/projects/:id/github         — sync config + status (token redacted)
 * PUT    /api/projects/:id/github         — enable / configure sync
 * DELETE /api/projects/:id/github         — disable sync, clear credentials
 * POST   /api/projects/:id/github/sync    — trigger full push of all issues
 * GET    /api/projects/:id/github/log     — last 50 sync log entries
 * POST   /api/projects/:id/github/webhook — ingest GitHub webhook events
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { getDb, getPool, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';
import { GitHubSync, startSyncLoop, stopSyncLoop } from '../github/sync.js';
import { ingestWebhookIssue } from '../github/sync-hook.js';

const router = Router({ mergeParams: true });

// ─── Helpers ──────────────────────────────────────────────────────────────────

function redactToken(token: string | null): string | null {
  if (!token || token.length < 4) return token;
  return `****${token.slice(-4)}`;
}

function handleError(res: Response, err: unknown) {
  console.error('[github-sync] error:', err);
  res.status(500).json({ error: 'Internal server error' });
}

async function getProject(projectId: string) {
  const db = getDb();
  const [project] = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .limit(1);
  return project ?? null;
}

// ─── GET /api/projects/:id/github ────────────────────────────────────────────

router.get('/', async (req: Request, res: Response) => {
  try {
    const project = await getProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    res.json({
      githubSyncEnabled: project.githubSyncEnabled ?? false,
      githubOwner: project.githubOwner ?? null,
      githubRepo: project.githubRepo ?? null,
      githubToken: redactToken(project.githubToken ?? null),
      githubSyncLastAt: project.githubSyncLastAt ?? null,
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ─── PUT /api/projects/:id/github ────────────────────────────────────────────

router.put('/', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const { token, owner, repo } = req.body as {
      token?: string;
      owner?: string;
      repo?: string;
    };

    if (!token || !owner || !repo) {
      res.status(400).json({ error: 'token, owner, and repo are required' });
      return;
    }

    const project = await getProject(id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    await db
      .update(schema.projects)
      .set({
        githubSyncEnabled: true,
        githubToken: token,
        githubOwner: owner,
        githubRepo: repo,
        updatedAt: new Date(),
      })
      .where(eq(schema.projects.id, id));

    // (Re)start the sync loop for this project
    startSyncLoop(id, token, owner, repo);

    res.json({
      githubSyncEnabled: true,
      githubOwner: owner,
      githubRepo: repo,
      githubToken: redactToken(token),
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ─── DELETE /api/projects/:id/github ─────────────────────────────────────────

router.delete('/', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;

    const project = await getProject(id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    await db
      .update(schema.projects)
      .set({
        githubSyncEnabled: false,
        githubToken: null,
        githubOwner: null,
        githubRepo: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.projects.id, id));

    stopSyncLoop(id);

    res.json({ githubSyncEnabled: false });
  } catch (err) {
    handleError(res, err);
  }
});

// ─── POST /api/projects/:id/github/sync ──────────────────────────────────────

router.post('/sync', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const project = await getProject(id);

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    if (
      !project.githubSyncEnabled ||
      !project.githubToken ||
      !project.githubOwner ||
      !project.githubRepo
    ) {
      res.status(409).json({ error: 'GitHub sync is not configured for this project' });
      return;
    }

    const sync = new GitHubSync(
      id,
      project.githubToken,
      project.githubOwner,
      project.githubRepo,
    );

    const result = await sync.pushAllIssues();

    res.json({ ok: true, ...result });
  } catch (err) {
    handleError(res, err);
  }
});

// ─── GET /api/projects/:id/github/log ────────────────────────────────────────

router.get('/log', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const pool = getPool();

    const { rows } = await pool.query(
      `SELECT id, project_id, direction, entity_type, entity_id,
              github_number, status, error_msg, synced_at
         FROM github_sync_log
        WHERE project_id = $1
        ORDER BY synced_at DESC
        LIMIT 50`,
      [id],
    );

    res.json(rows);
  } catch (err) {
    handleError(res, err);
  }
});

// ─── POST /api/projects/:id/github/webhook ───────────────────────────────────
//
// Ingest GitHub webhook events (issues event type).
// GitHub sends a JSON body with `action` and `issue` fields.
// In production you'd verify the X-Hub-Signature-256 header.

router.post('/webhook', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const project = await getProject(id);

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const ghEvent = req.headers['x-github-event'] as string | undefined;

    // Only handle "issues" events for now
    if (ghEvent !== 'issues') {
      res.json({ ok: true, ignored: true, event: ghEvent });
      return;
    }

    const { action, issue: ghIssue } = req.body as {
      action: string;
      issue: {
        number: number;
        title: string;
        body: string | null;
        state: string;
        html_url: string;
        node_id: string;
        updated_at: string;
      };
    };

    await ingestWebhookIssue(id, action, ghIssue);

    res.json({ ok: true, action, number: ghIssue.number });
  } catch (err) {
    handleError(res, err);
  }
});

export default router;
