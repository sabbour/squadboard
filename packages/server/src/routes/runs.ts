import { Router } from 'express';
import type { Request, Response } from 'express';
import { eq, and } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { eventBus } from '../realtime/event-bus.js';

// ---------------------------------------------------------------------------
// Two routers:
//   issueRunsRouter  — mounted at /api/projects/:projectId/issues/:issueId/runs
//   projectRunsRouter — mounted at /api/projects/:projectId/runs
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function handleError(res: Response, err: unknown) {
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
    const { issueId } = req.params;
    const { agentId, workspaceStrategy } = req.body as {
      agentId: string;
      workspaceStrategy?: 'scratch' | 'dir' | 'worktree';
    };

    if (!agentId) {
      res.status(400).json({ error: '`agentId` is required' });
      return;
    }

    const db = getDb();
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
    const { issueId } = req.params;
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
// GET  /api/projects/:projectId/runs/:runId          — get run status + output
// POST /api/projects/:projectId/runs/:runId/cancel   — cancel run
// GET  /api/projects/:projectId/runs/:runId/stream   — SSE stream
// ---------------------------------------------------------------------------
export const projectRunsRouter = Router({ mergeParams: true });

// GET /:runId
projectRunsRouter.get('/:runId', async (req: Request, res: Response) => {
  try {
    const { runId } = req.params;
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
    const { runId } = req.params;
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

// GET /:runId/stream  — SSE output stream (1 s DB poll for Demo 4)
projectRunsRouter.get('/:runId/stream', async (req: Request, res: Response) => {
  const { runId } = req.params;
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
