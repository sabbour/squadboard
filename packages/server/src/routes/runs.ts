import { Router } from 'express';
import type { Request, Response } from 'express';
import { eq, and, gte, asc, sql, max } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { eventBus } from '../realtime/event-bus.js';
import * as activeIssueSessions from '../engine/active-issue-sessions.js';
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
import { isCoordinatorDispatchEnabled } from '../config/coordinator-env.js';
import { dispatchViaCoordinator } from '../coordinator/index.js';
import type { CoordinatorInput } from '../coordinator/index.js';
import { persistCoordinatorDecision } from '../services/coordinator-decision-log.js';

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
    const { agentId, model, workspaceStrategy } = req.body as {
      agentId?: string;
      model?: string;
      workspaceStrategy?: 'scratch' | 'dir' | 'worktree';
    };

    const db = getDb();

    // ---------------------------------------------------------------------------
    // Path A: explicit agentId provided — existing behavior (unchanged)
    // ---------------------------------------------------------------------------
    if (agentId) {
      if (model) {
        // agentId wins; model is ignored when both are supplied
        console.warn(`[runs] POST ignoring 'model' field because 'agentId' was also supplied (agentId=${agentId})`);
      }

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
      return;
    }

    // ---------------------------------------------------------------------------
    // Path B: no agentId — delegate to coordinator
    // ---------------------------------------------------------------------------

    if (!isCoordinatorDispatchEnabled()) {
      res.status(400).json({
        error:
          'agentId is required when coordinator dispatch is disabled. ' +
          'Set COORDINATOR_DISPATCH_ENABLED=true or provide agentId explicitly.',
      });
      return;
    }

    // Fetch issue + project context for coordinator input
    const [issueRow] = await db
      .select({
        id: schema.issues.id,
        projectId: schema.issues.projectId,
        title: schema.issues.title,
        body: schema.issues.body,
        status: schema.issues.status,
        createdAt: schema.issues.createdAt,
      })
      .from(schema.issues)
      .where(eq(schema.issues.id, issueId))
      .limit(1);

    if (!issueRow) {
      res.status(404).json({ error: 'Issue not found' });
      return;
    }

    const { projectId } = issueRow;

    const [projectRow] = await db
      .select({ id: schema.projects.id, name: schema.projects.name, description: schema.projects.description })
      .from(schema.projects)
      .where(eq(schema.projects.id, projectId))
      .limit(1);

    if (!projectRow) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    // Fetch labels for the issue: issueLabels has (issueId, labelId); labels has (id, name)
    const issueLabelRows = await db
      .select({ labelId: schema.issueLabels.labelId })
      .from(schema.issueLabels)
      .where(eq(schema.issueLabels.issueId, issueId));
    const resolvedLabels: string[] = [];
    for (const { labelId } of issueLabelRows) {
      const [lRow] = await db
        .select({ name: schema.labels.name })
        .from(schema.labels)
        .where(eq(schema.labels.id, labelId))
        .limit(1);
      if (lRow) resolvedLabels.push(lRow.name);
    }

    // Fetch active agents for this project
    const agentRows = await db
      .select({
        id: schema.agents.id,
        name: schema.agents.name,
        role: schema.agents.role,
        charterHash: schema.agents.charterHash,
        charterContent: schema.agents.charterContent,
        status: schema.agents.status,
      })
      .from(schema.agents)
      .where(and(eq(schema.agents.projectId, projectId), eq(schema.agents.status, 'active')));

    // Determine which agents are currently busy (running a run)
    const busyRunRows = await db
      .select({ agentId: schema.issueRuns.agentId })
      .from(schema.issueRuns)
      .where(eq(schema.issueRuns.status, 'running'));
    const busyAgentIds = new Set(busyRunRows.map((r: { agentId: string }) => r.agentId));

    const candidateAgents: CoordinatorInput['candidateAgents'] = agentRows.map((a: {
      id: string; name: string; role: string; charterHash: string | null; charterContent: string; status: string;
    }) => ({
      name: a.name,
      role: a.role,
      charterHash: a.charterHash ?? '',
      charterContent: a.charterContent,
      capabilities: [],  // capabilities derived from charter at dispatch time by coordinator LLM
      available: !busyAgentIds.has(a.id),
    }));

    // Fetch recent completed runs for context (last 5 terminal runs for this issue)
    const recentRunRows = await db
      .select({
        issueId: schema.issueRuns.issueId,
        agentId: schema.issueRuns.agentId,
        status: schema.issueRuns.status,
        startedAt: schema.issueRuns.startedAt,
        completedAt: schema.issueRuns.completedAt,
      })
      .from(schema.issueRuns)
      .where(eq(schema.issueRuns.issueId, issueId))
      .orderBy(asc(schema.issueRuns.createdAt))
      .limit(5);

    // Resolve agent names for recent runs
    const recentAgentIds = [...new Set(recentRunRows.map((r: { agentId: string }) => r.agentId))];
    const agentNameMap = new Map<string, string>();
    for (const id of recentAgentIds) {
      const a = agentRows.find((ar: { id: string; name: string }) => ar.id === id);
      if (a) agentNameMap.set(id, a.name);
    }

    function mapRunOutcome(status: string): 'success' | 'failed' | 'abandoned' {
      if (status === 'completed') return 'success';
      if (status === 'failed') return 'failed';
      return 'abandoned';
    }

    const recentRuns: CoordinatorInput['recentRuns'] = recentRunRows
      .filter((r: { status: string }) => ['completed', 'failed', 'cancelled'].includes(r.status))
      .map((r: { issueId: string; agentId: string; status: string; startedAt: Date | null; completedAt: Date | null }) => ({
        issueId: r.issueId,
        agentName: agentNameMap.get(r.agentId) ?? r.agentId,
        outcome: mapRunOutcome(r.status),
        durationMs:
          r.startedAt && r.completedAt
            ? new Date(r.completedAt).getTime() - new Date(r.startedAt).getTime()
            : 0,
      }));

    const coordinatorInput: CoordinatorInput = {
      issue: {
        id: issueRow.id,
        title: issueRow.title,
        body: issueRow.body ?? null,
        labels: resolvedLabels,
        column: issueRow.status,
        parentId: null,
        priority: null,
        createdAt: issueRow.createdAt.toISOString(),
      },
      candidateAgents,
      project: {
        id: projectRow.id,
        name: projectRow.name,
        rules: projectRow.description ?? '',
      },
      recentRuns,
    };

    let dispatchResult;
    try {
      dispatchResult = await dispatchViaCoordinator(coordinatorInput, {
        ...(model ? { model } : {}),
      });
    } catch (coordinatorErr) {
      console.error('[runs] coordinator dispatch error:', coordinatorErr);
      res.status(503).json({
        error: 'Coordinator dispatch failed — try again or provide agentId explicitly.',
        detail: coordinatorErr instanceof Error ? coordinatorErr.message : String(coordinatorErr),
      });
      return;
    }

    const { decision } = dispatchResult;

    if (decision.kind === 'skip') {
      res.status(422).json({ error: 'Coordinator skipped this issue', reason: decision.reason });
      return;
    }

    if (decision.kind === 'ambiguous') {
      res.status(409).json({
        error: 'Coordinator could not determine a single agent — please pick one',
        candidates: decision.suggestedAgents,
        question: decision.question,
      });
      return;
    }

    // decision.kind === 'dispatch'
    const decidedAgentName = decision.agent;
    const decidedAgent = agentRows.find(
      (a: { name: string; id: string }) => a.name === decidedAgentName,
    );
    if (!decidedAgent) {
      res.status(503).json({
        error: `Coordinator decided on agent "${decidedAgentName}" but no active agent with that name exists in this project`,
      });
      return;
    }

    const [run] = await db
      .insert(schema.issueRuns)
      .values({
        issueId,
        agentId: decidedAgent.id,
        status: 'pending',
        workspaceStrategy: workspaceStrategy ?? 'scratch',
      })
      .returning();

    // MC-10: persist coordinator decision on the newly-created run (fire-and-forget).
    if (run) {
      await persistCoordinatorDecision(run.id, decision, dispatchResult.meta, db);
    }

    eventBus.emitRunEvent('run.started', projectId, { run });
    res.status(201).json({ ...run, _coordinatorDecision: decision });
    return;
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
// JIS-T4: Steer endpoint
// POST /:runId/steer  — inject a message into an in-flight issue run
// Body: { message: string, actor?: string }
// Response: { ok: true, eventSeq: N }
// ---------------------------------------------------------------------------

issueRunsRouter.post('/:runId/steer', async (req: Request, res: Response) => {
  try {
    const { projectId, issueId, runId } = req.params as Record<string, string>;
    const { message, actor } = req.body as { message?: string; actor?: string };

    if (!message || typeof message !== 'string' || !message.trim()) {
      res.status(400).json({ error: '`message` is required and must be a non-empty string' });
      return;
    }

    const db = getDb();

    // Validate run exists, belongs to this project + issue, and is still running.
    const [runRow] = await db
      .select({ id: schema.issueRuns.id, status: schema.issueRuns.status, issueId: schema.issueRuns.issueId })
      .from(schema.issueRuns)
      .where(and(eq(schema.issueRuns.id, runId), eq(schema.issueRuns.issueId, issueId)))
      .limit(1);

    if (!runRow) {
      res.status(404).json({ error: 'Run not found for this issue' });
      return;
    }

    // Also verify the issue belongs to the project.
    const [issueRow] = await db
      .select({ id: schema.issues.id })
      .from(schema.issues)
      .where(and(eq(schema.issues.id, issueId), eq(schema.issues.projectId, projectId)))
      .limit(1);

    if (!issueRow) {
      res.status(404).json({ error: 'Issue not found for this project' });
      return;
    }

    if (runRow.status !== 'running') {
      res.status(409).json({
        error: `Run is not active (status: ${runRow.status}). Only running runs can be steered.`,
      });
      return;
    }

    // Look up the active in-memory session.
    const session = activeIssueSessions.get(runId);
    if (!session) {
      res.status(404).json({
        error: 'Run is not active in this server instance (it may have completed or the server restarted).',
      });
      return;
    }

    // Inject the steering message.
    await session.steer(message, actor);

    // Retrieve the seq of the steered event we just recorded.
    const [seqRow] = await db
      .select({ maxSeq: max(schema.issueRunEvents.seq) })
      .from(schema.issueRunEvents)
      .where(eq(schema.issueRunEvents.runId, runId));

    const eventSeq = seqRow?.maxSeq ?? 0;

    res.json({ ok: true, eventSeq });
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
