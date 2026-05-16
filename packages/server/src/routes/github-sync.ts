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

// ─── G6.3: card-state side-effect helpers ────────────────────────────────────

/**
 * Parse issue references from a PR/issue body. Matches "#NNN" patterns.
 */
function extractIssueRefs(body: string | null | undefined): number[] {
  if (!body) return [];
  const matches = body.match(/#(\d+)/g) ?? [];
  return [...new Set(matches.map((m) => parseInt(m.slice(1), 10)))];
}

interface SideEffectRule {
  event_type: string;
  action: string;
  label_filter: string | null;
  target_semantic: string | null;
  target_deliverable_status: string | null;
  enabled: boolean;
  [key: string]: unknown;
}

/**
 * Apply card-state side effects for a webhook event against the enabled rules
 * persisted in gh_card_side_effects. Idempotent — skips cards already in
 * the target semantic state.
 */
async function applyCardSideEffects(opts: {
  projectId: string;
  eventType: string;
  action: string;
  /** For pull_request events: the PR body (to extract #NNN refs). */
  prBody?: string | null;
  /** For pull_request.closed: true if the PR was merged. */
  prMerged?: boolean;
  /** For issues.labeled: the label name. */
  labelName?: string;
  /** For issues events: the direct GitHub issue number. */
  ghIssueNumber?: number;
}): Promise<void> {
  const pool = getPool();
  const { projectId, eventType, action, prBody, prMerged, labelName, ghIssueNumber } = opts;

  // pull_request.closed that is NOT merged → skip (not a merge event)
  if (eventType === 'pull_request' && action === 'closed' && !prMerged) return;

  // Normalize action for rule lookup: merged PRs match the 'closed' rule
  const effectiveAction = action;

  let rules: SideEffectRule[];
  try {
    const { rows } = await pool.query<SideEffectRule>(
      `SELECT event_type, action, label_filter, target_semantic, target_deliverable_status, enabled
         FROM gh_card_side_effects
        WHERE event_type = $1 AND action = $2 AND enabled = TRUE`,
      [eventType, effectiveAction],
    );
    rules = rows;
  } catch (e) {
    console.error('[g6.3] failed to load side-effect rules:', e);
    return;
  }

  if (rules.length === 0) return;

  for (const rule of rules) {
    // Label-filter guard
    if (rule.label_filter && rule.label_filter !== labelName) continue;

    // Collect local issue UUIDs to update
    const issueIds: string[] = [];

    if (eventType === 'pull_request' && prBody) {
      // Find issues referenced in the PR body
      const refs = extractIssueRefs(prBody);
      for (const ref of refs) {
        const { rows } = await pool.query<{ id: string }>(
          `SELECT id FROM issues WHERE project_id = $1 AND github_issue_number = $2 AND archived = 0 LIMIT 1`,
          [projectId, ref],
        );
        if (rows[0]) issueIds.push(rows[0].id);
      }
    } else if (ghIssueNumber) {
      const { rows } = await pool.query<{ id: string }>(
        `SELECT id FROM issues WHERE project_id = $1 AND github_issue_number = $2 AND archived = 0 LIMIT 1`,
        [projectId, ghIssueNumber],
      );
      if (rows[0]) issueIds.push(rows[0].id);
    }

    for (const issueId of issueIds) {
      // Apply semantic state change via column_meta lookup (idempotent)
      if (rule.target_semantic) {
        // Find the column with this semantic value for this project
        const { rows: cols } = await pool.query<{ column_id: string }>(
          `SELECT column_id FROM column_meta WHERE project_id = $1 AND semantic = $2 LIMIT 1`,
          [projectId, rule.target_semantic],
        );
        const targetColumnId = cols[0]?.column_id;
        if (targetColumnId) {
          await pool.query(
            `UPDATE issues SET status = $1, updated_at = NOW()
              WHERE id = $2 AND (status IS DISTINCT FROM $1)`,
            [targetColumnId, issueId],
          );
        }
      }

      // Apply deliverable_status change
      if (rule.target_deliverable_status) {
        await pool.query(
          `UPDATE issues SET deliverable_status = $1, updated_at = NOW()
            WHERE id = $2 AND (deliverable_status IS DISTINCT FROM $1)`,
          [rule.target_deliverable_status, issueId],
        );
      }
    }

    if (issueIds.length > 0) {
      console.log(
        `[g6.3] applied rule (${eventType}.${action}) → ${issueIds.length} card(s) updated`,
        { targetSemantic: rule.target_semantic, targetDeliverableStatus: rule.target_deliverable_status },
      );
    }
  }
}

// ─── G6.6: enrich active issue_run external_gh_context ───────────────────────

interface PoolClient {
  query: <T extends Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
}

interface GhContextEvent {
  eventType: string;
  action: string | null;
  payload: Record<string, unknown>;
  receivedAt: string;
}

/**
 * When a webhook event references a GitHub issue number that maps to an
 * active issue_run in the project, append the event to the run's
 * external_gh_context JSONB so the next invocation can see recent GH activity.
 *
 * Keeps at most the 20 most recent events (oldest dropped first).
 */
async function enrichRunExternalContext(opts: {
  pool: PoolClient;
  projectId: string;
  eventType: string;
  action: string | null;
  payload: Record<string, unknown>;
}): Promise<void> {
  const { pool, projectId, eventType, action, payload } = opts;

  // Extract GH issue/PR number from payload
  let ghNumber: number | null = null;
  const issue = payload.issue as { number?: number } | undefined;
  const pr = payload.pull_request as { number?: number } | undefined;
  if (issue?.number) ghNumber = issue.number;
  else if (pr?.number) ghNumber = pr.number;
  if (!ghNumber) return;

  // Find active issue_runs linked to this GH issue in this project
  const { rows } = await pool.query<{ run_id: string; external_gh_context: string | null }>(
    `SELECT ir.id AS run_id, ir.external_gh_context
       FROM issue_runs ir
       JOIN issues i ON i.id = ir.issue_id
      WHERE i.project_id = $1
        AND i.github_issue_number = $2
        AND ir.status IN ('pending', 'running')
      LIMIT 10`,
    [projectId, ghNumber],
  );

  if (rows.length === 0) return;

  const newEvent: GhContextEvent = {
    eventType,
    action,
    payload: {
      // Only persist a lightweight subset to avoid ballooning the column
      action: payload.action,
      number: ghNumber,
      html_url: (issue as Record<string, unknown> | undefined)?.html_url ?? (pr as Record<string, unknown> | undefined)?.html_url,
      title: (issue as Record<string, unknown> | undefined)?.title ?? (pr as Record<string, unknown> | undefined)?.title,
      state: (issue as Record<string, unknown> | undefined)?.state ?? (pr as Record<string, unknown> | undefined)?.state,
      merged: (pr as Record<string, unknown> | undefined)?.merged,
      label: (payload.label as Record<string, unknown> | undefined)?.name,
    },
    receivedAt: new Date().toISOString(),
  };

  for (const row of rows) {
    let existing: { events: GhContextEvent[] };
    try {
      existing = row.external_gh_context ? JSON.parse(row.external_gh_context) : { events: [] };
    } catch {
      existing = { events: [] };
    }
    const events = [...(existing.events ?? []), newEvent].slice(-20);
    await pool.query(
      `UPDATE issue_runs SET external_gh_context = $1::jsonb, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify({ events }), row.run_id],
    );
  }

  console.log(`[g6.6] enriched ${rows.length} active run(s) with ${eventType}.${action} context`);
}

// ─── G6.5 — GET /api/projects/:id/github/activity ────────────────────────────
//
// Cursor-paginated chronological feed of GitHub events for a project.
// Query params:
//   cursor  — opaque cursor (ISO timestamp; returns events received_at < cursor)
//   limit   — page size (default 25, max 100)
// Response: { items: ActivityItem[], nextCursor: string | null }
// ---------------------------------------------------------------------------

router.get('/activity', async (req: Request, res: Response) => {
  try {
    const { id } = req.params as Record<string, string>;
    const pool = getPool();

    const limit = Math.min(parseInt(String(req.query['limit'] ?? '25'), 10) || 25, 100);
    const cursor = req.query['cursor'] as string | undefined;

    // Validate project
    const project = await getProject(id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const cursorClause = cursor ? `AND ge.received_at < $3` : '';
    const params: unknown[] = [id, limit + 1];
    if (cursor) params.push(cursor);

    const { rows } = await pool.query<{
      id: string;
      event_type: string;
      action: string | null;
      payload: string;
      received_at: string;
      delivery_id: string | null;
      // Joined from issue_runs (best-effort)
      run_id: string | null;
      git_branch: string | null;
      pr_number: number | null;
      pr_url: string | null;
      ci_state: string | null;
    }>(
      `SELECT ge.id, ge.event_type, ge.action, ge.payload::text AS payload,
              ge.received_at, ge.delivery_id,
              ir.id AS run_id, ir.git_branch, ir.pr_number, ir.pr_url, ir.ci_state
         FROM github_events ge
         LEFT JOIN LATERAL (
           -- Best-effort join: match by PR number or gh issue number in related issue_runs
           SELECT ir2.id, ir2.git_branch, ir2.pr_number, ir2.pr_url, ir2.ci_state
             FROM issue_runs ir2
             JOIN issues iss ON iss.id = ir2.issue_id
            WHERE iss.project_id = $1
              AND (
                (ge.event_type = 'pull_request' AND ir2.pr_number = (ge.payload->>'number')::int)
                OR
                (ge.event_type IN ('issues','issue_comment') AND iss.github_issue_number = (ge.payload->'issue'->>'number')::int)
              )
            ORDER BY ir2.created_at DESC
            LIMIT 1
         ) ir ON TRUE
        WHERE ge.project_id_resolved = $1 ${cursorClause}
        ORDER BY ge.received_at DESC
        LIMIT $2`,
      params,
    );

    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map((row) => {
      let parsedPayload: Record<string, unknown>;
      try { parsedPayload = JSON.parse(row.payload) as Record<string, unknown>; } catch { parsedPayload = {}; }

      // Extract actor
      const sender = (parsedPayload.sender ?? parsedPayload.pusher) as Record<string, unknown> | undefined;
      const actor = (sender?.login as string | undefined) ?? null;
      const avatarUrl = (sender?.avatar_url as string | undefined) ?? null;

      // Extract links
      const pr = parsedPayload.pull_request as Record<string, unknown> | undefined;
      const issue = parsedPayload.issue as Record<string, unknown> | undefined;
      const link = (pr?.html_url ?? issue?.html_url ?? null) as string | null;
      const title = (pr?.title ?? issue?.title ?? null) as string | null;

      return {
        id: row.id,
        eventType: row.event_type,
        action: row.action,
        actor,
        avatarUrl,
        link,
        title,
        receivedAt: row.received_at,
        runId: row.run_id,
        gitBranch: row.git_branch,
        prNumber: row.pr_number,
        prUrl: row.pr_url,
        ciState: row.ci_state,
      };
    });

    const nextCursor = hasMore && items.length > 0
      ? items[items.length - 1]!.receivedAt
      : null;

    res.json({ items, nextCursor });
  } catch (err) {
    handleError(res, err);
  }
});

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

            // G6.3 — card state side-effects for issues.labeled
            applyCardSideEffects({
              projectId: id,
              eventType: 'issues',
              action: 'labeled',
              labelName,
              ghIssueNumber: ghIssue.number,
            }).catch((e) => console.error('[g6.3] issues.labeled side-effect error:', e));
          }
        }
      }
    }

    // ── pull_request: G6.3 card-state side-effects ───────────────────────────
    if (ghEvent === 'pull_request' && action && payload.pull_request) {
      const pr = payload.pull_request as {
        body: string | null;
        merged?: boolean;
        number: number;
        html_url: string;
      };
      const prMerged = typeof pr.merged === 'boolean' ? pr.merged : false;

      if (action === 'opened' || (action === 'closed' && prMerged)) {
        applyCardSideEffects({
          projectId: id,
          eventType: 'pull_request',
          action,
          prBody: pr.body,
          prMerged,
        }).catch((e) => console.error('[g6.3] pull_request side-effect error:', e));
      }
    }

    // ── G6.6 — enrich active issue_runs external_gh_context ──────────────────
    // When an event references an issue tied to an active run, append the event
    // payload so the next agent invocation sees recent GH activity.
    enrichRunExternalContext({
      pool,
      projectId: id,
      eventType: ghEvent,
      action: action ?? null,
      payload,
    }).catch((e) => console.error('[g6.6] enrich run context error:', e));

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
