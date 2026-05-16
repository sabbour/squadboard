/**
 * routes/github-sync.ts — Demo 15: GitHub sync configuration + control endpoints.
 *
 * GET    /api/projects/:id/github         — sync config + status (token redacted)
 * PUT    /api/projects/:id/github         — enable / configure sync
 * DELETE /api/projects/:id/github         — disable sync, clear credentials
 * POST   /api/projects/:id/github/sync    — trigger full push of all issues
 * GET    /api/projects/:id/github/log     — last 50 sync log entries
 * POST   /api/projects/:id/github/webhook — ingest GitHub webhook events (expanded G6.1)
 *
 * G6.1 (Wave 18): webhook handler expanded to handle all major GitHub event types.
 * Incoming events are:
 *   1. Signature-validated against the per-project github_webhook_secret (HMAC-SHA256).
 *   2. Persisted to github_events table.
 *   3. Matched to a Squadboard project.
 *   4. Re-emitted on the internal event bus as `github.<event_type>.<action>`.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import type { Request, Response } from 'express';
import { getDb, getPool, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';
import { GitHubSync, startSyncLoop, stopSyncLoop } from '../github/sync.js';
import { ingestWebhookIssue } from '../github/sync-hook.js';
import { eventBus } from '../realtime/event-bus.js';
import { handleLabeledAutoAssign } from './copilot.js';

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
    const project = await getProject(req.params.id as string);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const authType = project.githubAuthType ?? 'pat';

    const base = {
      githubSyncEnabled: project.githubSyncEnabled ?? false,
      githubOwner: project.githubOwner ?? null,
      githubRepo: project.githubRepo ?? null,
      githubSyncLastAt: project.githubSyncLastAt ?? null,
      authType,
    };

    if (authType === 'app') {
      res.json({
        ...base,
        appId: project.githubAppId ?? null,
        installationId: project.githubAppInstallationId ?? null,
        // privateKey is never returned over the API
      });
    } else {
      res.json({
        ...base,
        githubToken: redactToken(project.githubToken ?? null),
      });
    }
  } catch (err) {
    handleError(res, err);
  }
});

// ─── PUT /api/projects/:id/github ────────────────────────────────────────────

router.put('/', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params as Record<string, string>;
    const body = req.body as {
      authType?: string;
      // PAT fields
      token?: string;
      // App fields
      appId?: string;
      installationId?: string;
      privateKey?: string;
      // Common
      owner?: string;
      repo?: string;
    };

    const authType = body.authType ?? 'pat';

    if (!body.owner || !body.repo) {
      res.status(400).json({ error: 'owner and repo are required' });
      return;
    }

    let updates: Record<string, unknown>;

    if (authType === 'app') {
      if (!body.appId || !body.installationId || !body.privateKey) {
        res
          .status(400)
          .json({ error: 'appId, installationId, and privateKey are required for App auth' });
        return;
      }
      updates = {
        githubSyncEnabled: true,
        githubAuthType: 'app',
        githubOwner: body.owner,
        githubRepo: body.repo,
        githubToken: null,
        githubAppId: body.appId,
        githubAppInstallationId: body.installationId,
        githubAppPrivateKey: body.privateKey,
        updatedAt: new Date(),
      };
    } else {
      // PAT (default)
      if (!body.token) {
        res.status(400).json({ error: 'token is required for PAT auth' });
        return;
      }
      updates = {
        githubSyncEnabled: true,
        githubAuthType: 'pat',
        githubOwner: body.owner,
        githubRepo: body.repo,
        githubToken: body.token,
        githubAppId: null,
        githubAppInstallationId: null,
        githubAppPrivateKey: null,
        updatedAt: new Date(),
      };
    }

    const project = await getProject(id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    await db
      .update(schema.projects)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .set(updates as any)
      .where(eq(schema.projects.id, id));

    // (Re)start the sync loop for this project
    startSyncLoop(id);

    if (authType === 'app') {
      res.json({
        githubSyncEnabled: true,
        authType: 'app',
        githubOwner: body.owner,
        githubRepo: body.repo,
        appId: body.appId,
        installationId: body.installationId,
        // privateKey omitted
      });
    } else {
      res.json({
        githubSyncEnabled: true,
        authType: 'pat',
        githubOwner: body.owner,
        githubRepo: body.repo,
        githubToken: redactToken(body.token!),
      });
    }
  } catch (err) {
    handleError(res, err);
  }
});

// ─── DELETE /api/projects/:id/github ─────────────────────────────────────────

router.delete('/', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params as Record<string, string>;

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
    const { id } = req.params as Record<string, string>;
    const project = await getProject(id);

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const authType = project.githubAuthType ?? 'pat';

    const missingConfig =
      !project.githubSyncEnabled ||
      !project.githubOwner ||
      !project.githubRepo ||
      (authType === 'pat' && !project.githubToken) ||
      (authType === 'app' &&
        (!project.githubAppId || !project.githubAppInstallationId || !project.githubAppPrivateKey));

    if (missingConfig) {
      res.status(409).json({ error: 'GitHub sync is not configured for this project' });
      return;
    }

    const sync = await GitHubSync.fromProject(id, project);
    const result = await sync.pushAllIssues();

    res.json({ ok: true, ...result });
  } catch (err) {
    handleError(res, err);
  }
});

// ─── GET /api/projects/:id/github/log ────────────────────────────────────────

router.get('/log', async (req: Request, res: Response) => {
  try {
    const { id } = req.params as Record<string, string>;
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

// ---------------------------------------------------------------------------
// Signature validation helper (G6.4)
// ---------------------------------------------------------------------------

function verifyWebhookSignature(secret: string, rawBody: Buffer, signature: string | undefined): boolean {
  if (!signature) return false;
  // GitHub sends: sha256=<hex>
  const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  try {
    return timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(signature, 'utf8'));
  } catch {
    return false;
  }
}

// Supported event types for full processing (others are accepted but only persisted)
const HANDLED_EVENTS = new Set([
  'pull_request',
  'pull_request_review',
  'pull_request_review_comment',
  'issue_comment',
  'issues',
  'push',
  'workflow_run',
  'check_run',
]);

// ---------------------------------------------------------------------------
// POST /api/projects/:id/github/webhook — expanded webhook handler (G6.1)
// ---------------------------------------------------------------------------
//
// Event handling matrix:
//   pull_request:               opened | closed | reopened | ready_for_review |
//                               review_requested | synchronize
//   pull_request_review:        submitted | dismissed | edited
//   pull_request_review_comment: created | edited | deleted
//   issue_comment:              created | edited | deleted
//   issues:                     opened | closed | reopened | labeled | unlabeled | assigned
//   push:                       any (filtered to project-tracked refs if configured)
//   workflow_run:               completed
//   check_run:                  completed
// ---------------------------------------------------------------------------

router.post('/webhook', async (req: Request, res: Response) => {
  const db = getDb();
  const pool = getPool();
  const { id } = req.params as Record<string, string>;

  try {
    const project = await getProject(id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const ghEvent = (req.headers['x-github-event'] as string | undefined) ?? '';
    const deliveryId = req.headers['x-github-delivery'] as string | undefined;
    const signature = req.headers['x-hub-signature-256'] as string | undefined;

    // ── Signature validation (G6.4) ─────────────────────────────────────────
    const secret = project.githubWebhookSecret;
    if (secret) {
      // req.body is parsed JSON; we need the raw buffer for HMAC. Express raw
      // middleware must be mounted *before* JSON parser to capture rawBody.
      // We fall back to re-serialising JSON when rawBody is absent (acceptable
      // for development; production should use express.raw({ type: '*/*' })).
      const rawBody: Buffer = (req as Request & { rawBody?: Buffer }).rawBody
        ?? Buffer.from(JSON.stringify(req.body), 'utf8');

      if (!verifyWebhookSignature(secret, rawBody, signature)) {
        res.status(401).json({ error: 'Webhook signature verification failed.' });
        return;
      }
    }

    // ── Persist raw event (G6.1 step 2) ─────────────────────────────────────
    const payload = req.body as Record<string, unknown>;
    const action = typeof payload.action === 'string' ? payload.action : null;

    // Dedup on delivery_id — GitHub retries can cause double-ingest
    if (deliveryId) {
      const existing = await pool.query(
        `SELECT id FROM github_events WHERE delivery_id = $1 LIMIT 1`,
        [deliveryId],
      );
      if (existing.rows.length > 0) {
        res.json({ ok: true, dedup: true, deliveryId });
        return;
      }
    }

    await pool.query(
      `INSERT INTO github_events
         (event_type, action, payload, delivery_id, project_id_resolved, received_at)
       VALUES ($1, $2, $3::jsonb, $4, $5, NOW())`,
      [ghEvent, action, JSON.stringify(payload), deliveryId ?? null, project.id],
    );

    // ── Re-emit on internal event bus (G6.1 step 4) ──────────────────────────
    // Consumed by ceremony dispatcher (D3) and future WS subscribers.
    if (ghEvent) {
      eventBus.emitGithubWebhookEvent(ghEvent, action, project.id, { projectId: project.id, payload });
    }

    // ── Per-event processing (G6.1 step 3) ────────────────────────────────────

    if (!HANDLED_EVENTS.has(ghEvent)) {
      // Event persisted but not specifically handled — acknowledge and continue
      await pool.query(
        `UPDATE github_events SET processed_at = NOW(), processed_outcome = 'no_match'
           WHERE delivery_id = $1`,
        [deliveryId ?? null],
      );
      res.json({ ok: true, ignored: false, event: ghEvent, processed: false, note: 'event persisted but no specific handler' });
      return;
    }

    // ── issues: legacy ingest path (bidirectional sync) ──────────────────────
    if (ghEvent === 'issues') {
      const allowedActions = new Set(['opened', 'closed', 'reopened', 'labeled', 'unlabeled', 'assigned']);
      if (action && allowedActions.has(action) && payload.issue) {
        const ghIssue = payload.issue as {
          number: number;
          title: string;
          body: string | null;
          state: string;
          html_url: string;
          node_id: string;
          updated_at: string;
        };
        try {
          await ingestWebhookIssue(id, action, ghIssue);
        } catch (err) {
          console.error('[github-webhook] ingestWebhookIssue error:', err);
        }

        // G4.3 — Auto-assign to @copilot when a label rule matches.
        if (action === 'labeled' && payload.label) {
          const labelObj = payload.label as { name?: string };
          const labelName = labelObj.name ?? '';
          if (labelName) {
            // Resolve the local Squadboard issue UUID by GitHub issue number.
            const localIssueResult = await pool.query<{ id: string }>(
              `SELECT id FROM issues WHERE project_id = $1 AND github_issue_number = $2 LIMIT 1`,
              [id, ghIssue.number],
            );
            const localIssueId = localIssueResult.rows[0]?.id ?? null;
            handleLabeledAutoAssign({
              projectId: id,
              label: labelName,
              issueId: localIssueId,
              githubIssueNumber: ghIssue.number,
            }).catch((err) => console.error('[github-webhook] auto-assign error:', err));
          }
        }
      }
    }

    // ── push: filter to tracked refs (project.githubRepo exists = GitHub sync enabled) ──
    if (ghEvent === 'push' && project.githubOwner && project.githubRepo) {
      const ref = typeof payload.ref === 'string' ? payload.ref : '';
      // Only process refs that match the project's default branch or any feature branch
      // (anything that is NOT a tag ref is processed; tags are ignored)
      if (ref.startsWith('refs/tags/')) {
        await pool.query(
          `UPDATE github_events SET processed_at = NOW(), processed_outcome = 'no_match'
             WHERE delivery_id = $1`,
          [deliveryId ?? null],
        );
        res.json({ ok: true, event: ghEvent, ignored: true, reason: 'tag push ignored' });
        return;
      }
    }

    // Mark as processed
    await pool.query(
      `UPDATE github_events SET processed_at = NOW(), processed_outcome = 'matched'
         WHERE delivery_id = $1`,
      [deliveryId ?? null],
    );

    res.json({ ok: true, event: ghEvent, action });
  } catch (err) {
    handleError(res, err);
  }
});

export default router;
