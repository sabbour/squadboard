import { Router } from 'express';
import type { Request, Response } from 'express';
import { eq, and, gte, asc, sql } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { eventBus } from '../realtime/event-bus.js';
import {
  pushBranch,
  createPr,
  buildPrBody,
  commentOnIssue,
  mergePr,
  triggerWorkflow,
  dispatchWorkflow,
  pollWorkflowRun,
  GitOpsError,
} from '../services/github-git-ops.js';

/** Sanitize a branch name — reject any shell-unsafe characters */
function sanitizeBranchName(name: string): string {
  if (!/^[a-zA-Z0-9/_.-]+$/.test(name)) {
    throw new Error(`Branch name "${name}" contains invalid characters. Only a-z A-Z 0-9 / _ . - are allowed.`);
  }
  return name;
}

/**
 * Sanitize a comment body for shell safety.
 * We pipe via stdin (--body-file -) so the body never reaches the shell
 * argument list. This guard is an extra layer against control characters.
 */
// ---------------------------------------------------------------------------
// Two routers:
//   issueRunsRouter  — mounted at /api/projects/:projectId/issues/:issueId/runs
//   projectRunsRouter — mounted at /api/projects/:projectId/runs
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function handleError(res: Response, err: unknown) {
  if (err instanceof GitOpsError) {
    res.status(err.httpStatus).json({ error: err.detail });
    return;
  }
  console.error('[runs] error:', err);
  res.status(500).json({ error: 'Internal server error' });
}

// ---------------------------------------------------------------------------
// Issue-scoped router
// POST /api/projects/:projectId/issues/:issueId/runs   — create run
// GET  /api/projects/:projectId/issues/:issueId/runs   — list runs for issue
// ---------------------------------------------------------------------------
export const issueRunsRouter = Router({ mergeParams: true });

// POST /
issueRunsRouter.post('/', async (req: Request, res: Response) => {
  try {
    const { issueId } = req.params as Record<string, string>;
    const { agentId, workspaceStrategy } = req.body as {
      agentId: string;
      workspaceStrategy?: 'scratch' | 'dir' | 'worktree';
    };

    if (!agentId) {
      res.status(400).json({ error: '`agentId` is required' });
      return;
    }

    const db = getDb();

    // Wave 10 B9: defense-in-depth — refuse to dispatch a run against a
    // disabled or retired agent. UI pickers already filter to active, but
    // direct API callers (MCP, scripts, curl, tests) must hit the same
    // gate so a run can never start with a non-active agent.
    const [agentRow] = await db
      .select({ id: schema.agents.id, name: schema.agents.name, status: schema.agents.status })
      .from(schema.agents)
      .where(eq(schema.agents.id, agentId))
      .limit(1);
    if (!agentRow) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }
    if (agentRow.status !== 'active') {
      res.status(422).json({
        error: `Agent "${agentRow.name}" is ${agentRow.status} — re-enable it before running.`,
      });
      return;
    }

    const [run] = await db
      .insert(schema.issueRuns)
      .values({
        issueId,
        agentId,
        status: 'pending',
        workspaceStrategy: workspaceStrategy ?? 'scratch',
      })
      .returning();

    // Resolve projectId for WS fan-out
    const [issueRow] = await db
      .select({ projectId: schema.issues.projectId })
      .from(schema.issues)
      .where(eq(schema.issues.id, issueId))
      .limit(1);

    if (issueRow) {
      eventBus.emitRunEvent('run.started', issueRow.projectId, { run });
    }

    res.status(201).json(run);
  } catch (err) {
    handleError(res, err);
  }
});

// GET /
issueRunsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const { issueId } = req.params as Record<string, string>;
    const db = getDb();
    const rows = await db
      .select()
      .from(schema.issueRuns)
      .where(eq(schema.issueRuns.issueId, issueId))
      .orderBy(schema.issueRuns.createdAt);
    res.json(rows);
  } catch (err) {
    handleError(res, err);
  }
});

// ---------------------------------------------------------------------------
// JIS-T6: Events query endpoint
// GET /:runId/events?limit=50&offset=0&since_seq=N
// ---------------------------------------------------------------------------

const MAX_EVENT_LIMIT = 500;

issueRunsRouter.get('/:runId/events', async (req: Request, res: Response) => {
  try {
    const { issueId, runId } = req.params as Record<string, string>;
    const db = getDb();

    // Validate that the run belongs to this issue
    const [runRow] = await db
      .select({ id: schema.issueRuns.id })
      .from(schema.issueRuns)
      .where(and(eq(schema.issueRuns.id, runId), eq(schema.issueRuns.issueId, issueId)))
      .limit(1);

    if (!runRow) {
      res.status(404).json({ error: 'Run not found for this issue' });
      return;
    }

    // Parse query params
    const rawLimit  = parseInt((req.query as Record<string, string>).limit  ?? '50',  10);
    const rawOffset = parseInt((req.query as Record<string, string>).offset ?? '0',   10);
    const rawSince  = (req.query as Record<string, string>).since_seq;

    const limit  = Math.min(isNaN(rawLimit)  ? 50  : Math.max(1, rawLimit),  MAX_EVENT_LIMIT);
    const offset = isNaN(rawOffset) ? 0 : Math.max(0, rawOffset);

    // Build the base where clause
    const sinceSeq = rawSince !== undefined ? parseInt(rawSince, 10) : NaN;
    const useSince = !isNaN(sinceSeq); // since_seq wins if both provided

    // Total count for this run
    const [countRow] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(schema.issueRunEvents)
      .where(eq(schema.issueRunEvents.runId, runId));
    const total = countRow?.total ?? 0;

    // Fetch events
    const eventsQuery = db
      .select()
      .from(schema.issueRunEvents)
      .where(
        useSince
          ? and(eq(schema.issueRunEvents.runId, runId), gte(schema.issueRunEvents.seq, sinceSeq))
          : eq(schema.issueRunEvents.runId, runId),
      )
      .orderBy(asc(schema.issueRunEvents.seq))
      .limit(limit);

    const events = useSince
      ? await eventsQuery
      : await eventsQuery.offset(offset);

    // nextSeq: the seq after the last returned event (for cursor-based polling)
    const lastEvent = events[events.length - 1];
    const nextSeq   = lastEvent ? lastEvent.seq + 1 : (useSince ? sinceSeq : offset + events.length);

    res.json({ events, total, nextSeq });
  } catch (err) {
    handleError(res, err);
  }
});

// ---------------------------------------------------------------------------
// Project-scoped router (run-level operations)
// GET  /api/projects/:projectId/runs/:runId              — get run status + output
// POST /api/projects/:projectId/runs/:runId/cancel       — cancel run
// GET  /api/projects/:projectId/runs/:runId/stream       — SSE stream
// POST /api/projects/:projectId/runs/:runId/git/push     — push worktree branch to origin
// POST /api/projects/:projectId/runs/:runId/git/pr       — create PR via gh cli
// ---------------------------------------------------------------------------
export const projectRunsRouter = Router({ mergeParams: true });

// GET /:runId
projectRunsRouter.get('/:runId', async (req: Request, res: Response) => {
  try {
    const { runId } = req.params as Record<string, string>;
    const db = getDb();
    const [run] = await db
      .select()
      .from(schema.issueRuns)
      .where(eq(schema.issueRuns.id, runId))
      .limit(1);

    if (!run) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }
    res.json(run);
  } catch (err) {
    handleError(res, err);
  }
});

// POST /:runId/cancel
projectRunsRouter.post('/:runId/cancel', async (req: Request, res: Response) => {
  try {
    const { runId } = req.params as Record<string, string>;
    const db = getDb();

    const [run] = await db
      .select({ id: schema.issueRuns.id, status: schema.issueRuns.status })
      .from(schema.issueRuns)
      .where(eq(schema.issueRuns.id, runId))
      .limit(1);

    if (!run) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }

    if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
      res.status(409).json({ error: `Run is already ${run.status}` });
      return;
    }

    const [updated] = await db
      .update(schema.issueRuns)
      .set({
        status: 'cancelled',
        leaseExpiresAt: null,
        heartbeatAt: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.issueRuns.id, runId))
      .returning();

    // Resolve projectId for WS fan-out
    const [issueRow] = await db
      .select({ projectId: schema.issues.projectId })
      .from(schema.issues)
      .where(eq(schema.issues.id, updated.issueId))
      .limit(1);

    if (issueRow) {
      eventBus.emitRunEvent('run.completed', issueRow.projectId, { run: updated });
    }

    res.json(updated);
  } catch (err) {
    handleError(res, err);
  }
});

// ---------------------------------------------------------------------------
// POST /:runId/git/push — Push worktree branch to origin
// ---------------------------------------------------------------------------
// Request: POST /api/projects/:projectId/runs/:runId/git/push  (no body required)
// Response 200: { branch, branchUrl, pushOutput }
// Response 4xx/5xx: { error }
// ---------------------------------------------------------------------------
projectRunsRouter.post('/:runId/git/push', async (req: Request, res: Response) => {
  const { runId, projectId } = req.params as Record<string, string>;
  try {
    const result = await pushBranch(runId, projectId);
    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
});

// ---------------------------------------------------------------------------
// POST /:runId/git/pr — Create a PR via gh cli
// ---------------------------------------------------------------------------
// Request body (all optional):
//   { title?: string, body?: string, draft?: boolean }
// Response 200: { prUrl, prNumber }
// Response 4xx/5xx: { error }
// ---------------------------------------------------------------------------
projectRunsRouter.post('/:runId/git/pr', async (req: Request, res: Response) => {
  const { runId, projectId } = req.params as Record<string, string>;
  try {
    const opts = {
      title: typeof req.body?.title === 'string' ? req.body.title : undefined,
      body: typeof req.body?.body === 'string' ? req.body.body : undefined,
      draft: req.body?.draft === true,
    };
    const result = await createPr(runId, opts, projectId);
    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
});

// ---------------------------------------------------------------------------
// POST /:runId/git/comment — Comment on the linked GitHub issue (G2.3)
// ---------------------------------------------------------------------------
// Request body: { issueNumber: number, body: string }
// Response 200: { commentUrl: string, issueNumber: number }
// Response 4xx/5xx: { error }
// ---------------------------------------------------------------------------
projectRunsRouter.post('/:runId/git/comment', async (req: Request, res: Response) => {
  const { runId, projectId } = req.params as Record<string, string>;
  try {
    const { issueNumber, body } = req.body as { issueNumber?: unknown; body?: unknown };
    if (typeof issueNumber !== 'number' || !Number.isInteger(issueNumber) || issueNumber < 1) {
      res.status(400).json({ error: '`issueNumber` must be a positive integer.' });
      return;
    }
    if (typeof body !== 'string' || !body.trim()) {
      res.status(400).json({ error: '`body` must be a non-empty string.' });
      return;
    }
    const result = await commentOnIssue(runId, { issueNumber, body }, projectId);
    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
});

// ---------------------------------------------------------------------------
// POST /:runId/git/pr/merge — Merge the PR for this run (G2.5)
// ---------------------------------------------------------------------------
// Request body: { method?: 'merge' | 'squash' | 'rebase' }  — default 'squash'
// Response 200: { prUrl, sha, method }
// Response 409: CI failing
// Response 4xx/5xx: { error }
// ---------------------------------------------------------------------------
projectRunsRouter.post('/:runId/git/pr/merge', async (req: Request, res: Response) => {
  const { runId, projectId } = req.params as Record<string, string>;
  try {
    const rawMethod = req.body?.method;
    const method: 'squash' | 'merge' | 'rebase' =
      rawMethod === 'merge' || rawMethod === 'rebase' ? rawMethod : 'squash';
    const result = await mergePr(runId, { method }, projectId);
    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
});

// ---------------------------------------------------------------------------
// POST /:runId/git/workflow/dispatch — G2.4 Trigger GitHub Actions workflow
// ---------------------------------------------------------------------------
// Request body:
//   { workflowFile: string, ref?: string, inputs?: Record<string, string> }
// Response 200: { workflowRunId, runUrl }
// Response 4xx/5xx: { error }
// ---------------------------------------------------------------------------
projectRunsRouter.post('/:runId/git/workflow/dispatch', async (req: Request, res: Response) => {
  const { runId, projectId } = req.params as Record<string, string>;
  try {
    const { workflowFile, ref, inputs } = req.body as {
      workflowFile?: unknown;
      ref?: unknown;
      inputs?: unknown;
    };

    if (typeof workflowFile !== 'string' || !workflowFile.trim()) {
      res.status(400).json({ error: '`workflowFile` must be a non-empty string, e.g. "deploy.yml"' });
      return;
    }
    if (ref !== undefined && typeof ref !== 'string') {
      res.status(400).json({ error: '`ref` must be a string when provided' });
      return;
    }
    if (inputs !== undefined && (typeof inputs !== 'object' || Array.isArray(inputs) || inputs === null)) {
      res.status(400).json({ error: '`inputs` must be an object when provided' });
      return;
    }

    // Resolve run to get workspace and project github config.
    const db = getDb();
    const [run] = await db
      .select({ workspacePath: schema.issueRuns.workspacePath, issueId: schema.issueRuns.issueId })
      .from(schema.issueRuns)
      .where(eq(schema.issueRuns.id, runId))
      .limit(1);

    if (!run) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }

    // Resolve project github config for owner/repo context.
    const [issueRow] = await db
      .select({ projectId: schema.issues.projectId })
      .from(schema.issues)
      .where(eq(schema.issues.id, run.issueId))
      .limit(1);

    let owner: string | undefined;
    let repo: string | undefined;
    if (issueRow) {
      const [proj] = await db
        .select({ githubOwner: schema.projects.githubOwner, githubRepo: schema.projects.githubRepo })
        .from(schema.projects)
        .where(eq(schema.projects.id, issueRow.projectId))
        .limit(1);
      owner = proj?.githubOwner ?? undefined;
      repo = proj?.githubRepo ?? undefined;
    }

    const result = await triggerWorkflow({
      workflowFile,
      ref: typeof ref === 'string' ? ref : 'main',
      inputs: inputs as Record<string, string> | undefined,
      owner,
      repo,
      cwd: run.workspacePath ?? undefined,
    });

    // Emit WS event so the Run Drawer timeline shows the dispatch.
    const resolvedProjectId = projectId ?? issueRow?.projectId;
    if (resolvedProjectId) {
      eventBus.emitGitEvent('git.workflow.dispatched', resolvedProjectId, {
        runId,
        workflowFile,
        ref: typeof ref === 'string' ? ref : 'main',
        workflowRunId: result.workflowRunId,
        runUrl: result.runUrl,
      });
    }

    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
});

// ---------------------------------------------------------------------------
// G1.1 — GET /:runId/git/workflow/poll/:runWorkflowId — poll a workflow run
// ---------------------------------------------------------------------------
// Query params: timeoutMs (optional, ms integer)
// Response 200: WorkflowRunStatus
// ---------------------------------------------------------------------------
projectRunsRouter.get('/:runId/git/workflow/poll/:workflowRunId', async (req: Request, res: Response) => {
  const { runId, projectId, workflowRunId } = req.params as Record<string, string>;
  const timeoutMs = req.query['timeoutMs'] ? parseInt(String(req.query['timeoutMs']), 10) : undefined;

  try {
    const db = getDb();

    // Resolve project github config for owner/repo context.
    const [run] = await db
      .select({ issueId: schema.issueRuns.issueId })
      .from(schema.issueRuns)
      .where(eq(schema.issueRuns.id, runId))
      .limit(1);

    if (!run) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }

    const [issueRow] = await db
      .select({ projectId: schema.issues.projectId })
      .from(schema.issues)
      .where(eq(schema.issues.id, run.issueId))
      .limit(1);

    let owner: string | undefined;
    let repo: string | undefined;
    if (issueRow) {
      const [proj] = await db
        .select({ githubOwner: schema.projects.githubOwner, githubRepo: schema.projects.githubRepo })
        .from(schema.projects)
        .where(eq(schema.projects.id, issueRow.projectId))
        .limit(1);
      owner = proj?.githubOwner ?? undefined;
      repo = proj?.githubRepo ?? undefined;
    }

    // Also accept override from query string for cross-repo scenarios
    const effectiveOwner = (req.query['owner'] as string | undefined) ?? owner;
    const effectiveRepo = (req.query['repo'] as string | undefined) ?? repo;

    if (!effectiveOwner || !effectiveRepo) {
      res.status(409).json({ error: 'GitHub owner/repo not configured for this project' });
      return;
    }

    const result = await pollWorkflowRun({
      owner: effectiveOwner,
      repo: effectiveRepo,
      run_id: workflowRunId,
      ...(timeoutMs ? { timeoutMs } : {}),
    });

    const resolvedProjectId = projectId ?? issueRow?.projectId;
    if (resolvedProjectId) {
      eventBus.emitGitEvent('git.workflow.polled', resolvedProjectId, {
        runId,
        workflowRunId,
        status: result.status,
        conclusion: result.conclusion,
      });
    }

    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
});
projectRunsRouter.get('/:runId/stream', async (req: Request, res: Response) => {
  const { runId } = req.params as Record<string, string>;
  const db = getDb();

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const sendEvent = (data: object) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  let lastOutput: string | null = null;
  let terminated = false;

  const poll = setInterval(async () => {
    if (terminated) return;

    try {
      const [run] = await db
        .select()
        .from(schema.issueRuns)
        .where(eq(schema.issueRuns.id, runId))
        .limit(1);

      if (!run) {
        sendEvent({ type: 'error', message: 'Run not found' });
        clearInterval(poll);
        res.end();
        terminated = true;
        return;
      }

      // Send new output lines if any
      if (run.output !== null && run.output !== lastOutput) {
        const prev = lastOutput ?? '';
        const newChunk = run.output.slice(prev.length);
        if (newChunk) {
          sendEvent({ type: 'output', chunk: newChunk });
        }
        lastOutput = run.output;
      }

      // Send status events and terminate stream when run finishes
      const terminal = ['completed', 'failed', 'cancelled'];
      if (terminal.includes(run.status)) {
        sendEvent({ type: 'done', status: run.status, output: run.output });
        clearInterval(poll);
        res.end();
        terminated = true;
      }
    } catch (err: unknown) {
      sendEvent({ type: 'error', message: String(err) });
      clearInterval(poll);
      res.end();
      terminated = true;
    }
  }, 1_000);

  // Clean up if the client disconnects
  req.on('close', () => {
    if (!terminated) {
      clearInterval(poll);
      terminated = true;
    }
  });
});
