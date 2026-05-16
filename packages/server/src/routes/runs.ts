import { Router } from 'express';
import type { Request, Response } from 'express';
import { eq, and } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { eventBus } from '../realtime/event-bus.js';
import {
  pushBranch,
  createPr,
  buildPrBody,
  commentOnIssue,
  mergePr,
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

// GET /:runId/stream  — SSE output stream (1 s DB poll for Demo 4)
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
