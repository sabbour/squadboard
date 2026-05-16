import { Router } from 'express';
import type { Request, Response } from 'express';
import { eq, and } from 'drizzle-orm';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getDb, schema } from '../db/index.js';
import { eventBus } from '../realtime/event-bus.js';
import { assertSafeWorkspacePath } from '../engine/workspace.js';

const execFileAsync = promisify(execFile);

// Default names that must never be pushed to
const PROTECTED_BRANCHES = new Set(['main', 'master', 'develop', 'trunk']);
const GIT_TIMEOUT_MS = 30_000;

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
function sanitizeCommentBody(body: string): string {
  // Strip null bytes and ANSI escape sequences
  return body.replace(/\x00/g, '').replace(/\x1b\[[0-9;]*m/g, '').trim();
}

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
  const db = getDb();

  try {
    const [run] = await db
      .select()
      .from(schema.issueRuns)
      .where(eq(schema.issueRuns.id, runId))
      .limit(1);

    if (!run) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }

    if (!run.workspacePath) {
      res.status(422).json({ error: 'Run has no workspace path — only worktree runs can be pushed.' });
      return;
    }

    if (run.workspaceStrategy !== 'worktree') {
      res.status(422).json({ error: `Push is only supported for worktree runs (this run uses strategy "${run.workspaceStrategy}").` });
      return;
    }

    // Safety: must be under an allowed workspace root
    try {
      assertSafeWorkspacePath(run.workspacePath);
    } catch (e) {
      res.status(403).json({ error: String(e) });
      return;
    }

    // Determine the current branch
    let branch: string;
    try {
      const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
        cwd: run.workspacePath,
        timeout: GIT_TIMEOUT_MS,
      });
      branch = stdout.trim();
    } catch (e) {
      res.status(500).json({ error: `Could not determine current branch: ${String(e)}` });
      return;
    }

    // Sanitize and protect
    try {
      sanitizeBranchName(branch);
    } catch (e) {
      res.status(422).json({ error: String(e) });
      return;
    }
    if (PROTECTED_BRANCHES.has(branch)) {
      res.status(422).json({ error: `Refusing to push to protected branch "${branch}".` });
      return;
    }

    // Execute git push -u origin <branch>
    let pushOutput: string;
    try {
      const { stdout, stderr } = await execFileAsync(
        'git',
        ['push', '-u', 'origin', branch],
        { cwd: run.workspacePath, timeout: GIT_TIMEOUT_MS },
      );
      pushOutput = (stdout + stderr).trim();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      const stderr = (e as { stderr?: string }).stderr ?? '';
      res.status(500).json({ error: 'git push failed', detail: (stderr || msg).trim() });
      return;
    }

    // Derive branch URL from remote origin
    let branchUrl = '';
    try {
      const { stdout: remoteUrl } = await execFileAsync('git', ['remote', 'get-url', 'origin'], {
        cwd: run.workspacePath,
        timeout: GIT_TIMEOUT_MS,
      });
      const remote = remoteUrl.trim().replace(/\.git$/, '').replace(/^git@github\.com:/, 'https://github.com/');
      branchUrl = `${remote}/tree/${branch}`;
    } catch {
      // Non-fatal — URL is a convenience
    }

    // Fan-out via WebSocket
    eventBus.emitGitEvent('git.push.complete', projectId, { runId, branch, branchUrl, pushOutput });

    // Persist git fields on the run record for card badge caching
    await db
      .update(schema.issueRuns)
      .set({ gitBranch: branch, gitBranchUrl: branchUrl, updatedAt: new Date() })
      .where(eq(schema.issueRuns.id, runId));

    res.json({ branch, branchUrl, pushOutput });
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
  const db = getDb();

  try {
    const [run] = await db
      .select()
      .from(schema.issueRuns)
      .where(eq(schema.issueRuns.id, runId))
      .limit(1);

    if (!run) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }

    if (!run.workspacePath) {
      res.status(422).json({ error: 'Run has no workspace path.' });
      return;
    }

    if (run.workspaceStrategy !== 'worktree') {
      res.status(422).json({ error: `PR creation is only supported for worktree runs.` });
      return;
    }

    try {
      assertSafeWorkspacePath(run.workspacePath);
    } catch (e) {
      res.status(403).json({ error: String(e) });
      return;
    }

    // Validate current branch is not protected
    let branch: string;
    try {
      const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
        cwd: run.workspacePath,
        timeout: GIT_TIMEOUT_MS,
      });
      branch = stdout.trim();
    } catch (e) {
      res.status(500).json({ error: `Could not determine current branch: ${String(e)}` });
      return;
    }

    if (PROTECTED_BRANCHES.has(branch)) {
      res.status(422).json({ error: `Refusing to open a PR from protected branch "${branch}".` });
      return;
    }

    const overrideTitle = typeof req.body?.title === 'string' ? req.body.title : undefined;
    const overrideBody = typeof req.body?.body === 'string' ? req.body.body : undefined;
    const draft = req.body?.draft === true;

    // Fetch agent + issue for template pre-fill
    const [agent] = await db.select({ name: schema.agents.name }).from(schema.agents).where(eq(schema.agents.id, run.agentId)).limit(1);
    const [issue] = await db.select({ title: schema.issues.title }).from(schema.issues).where(eq(schema.issues.id, run.issueId)).limit(1);

    const prTitle = overrideTitle ?? (issue ? `${issue.title}` : `Run ${runId.slice(0, 8)}`);
    const prBody = overrideBody ?? buildPrBody({
      agentName: agent?.name ?? 'unknown',
      runId,
      branch,
    });

    const ghArgs = [
      'pr', 'create',
      '--title', prTitle,
      '--body', prBody,
    ];
    if (draft) ghArgs.push('--draft');

    let ghOutput: string;
    try {
      const { stdout, stderr } = await execFileAsync('gh', ghArgs, {
        cwd: run.workspacePath,
        timeout: GIT_TIMEOUT_MS,
      });
      ghOutput = (stdout + stderr).trim();
    } catch (e: unknown) {
      const stderr = (e as { stderr?: string }).stderr ?? '';
      const msg = e instanceof Error ? e.message : String(e);
      res.status(500).json({ error: 'gh pr create failed', detail: (stderr || msg).trim() });
      return;
    }

    // gh pr create outputs the PR URL on the last line
    const lines = ghOutput.split('\n').filter(Boolean);
    const prUrl = lines[lines.length - 1] ?? '';
    const prNumberMatch = prUrl.match(/\/pull\/(\d+)$/);
    const prNumber = prNumberMatch ? parseInt(prNumberMatch[1], 10) : undefined;

    eventBus.emitGitEvent('git.pr.created', projectId, { runId, branch, prUrl, prNumber });

    // Persist PR fields on the run record for card badge caching
    await db
      .update(schema.issueRuns)
      .set({
        prNumber: prNumber ?? null,
        prUrl,
        prState: 'open',
        updatedAt: new Date(),
      })
      .where(eq(schema.issueRuns.id, runId));

    res.json({ prUrl, prNumber });
  } catch (err) {
    handleError(res, err);
  }
});

/**
 * Build the default PR body from the PR template, pre-filled with run context.
 * Agents can override via the `body` field in the request payload.
 */
function buildPrBody(ctx: { agentName: string; runId: string; branch: string }): string {
  return `## Summary
<!-- What this PR does in one paragraph -->

## Squad Context
- **Agent:** ${ctx.agentName}
- **Ceremony / Run:** ad-hoc (run \`${ctx.runId.slice(0, 8)}\`)
- **Issue:** <!-- Closes #N if applicable -->
- **Branch:** \`${ctx.branch}\`

## Test Plan
<!-- How a reviewer can verify -->

## Risk
- [ ] No risk / cosmetic
- [ ] Low — UI-only / non-breaking
- [ ] Medium — touches backend / migrations
- [ ] High — touches engine loops / multi-pod liveness

## Notes for the next agent
<!-- Handoff context if a follow-up ceremony picks up -->
`;
}

// ---------------------------------------------------------------------------
// POST /:runId/git/comment — Comment on the linked GitHub issue (G2.3)
// ---------------------------------------------------------------------------
// Request body: { issueNumber: number, body: string }
// Response 200: { commentUrl: string, issueNumber: number }
// Response 4xx/5xx: { error }
// ---------------------------------------------------------------------------
projectRunsRouter.post('/:runId/git/comment', async (req: Request, res: Response) => {
  const { runId, projectId } = req.params as Record<string, string>;
  const db = getDb();

  try {
    const [run] = await db
      .select()
      .from(schema.issueRuns)
      .where(eq(schema.issueRuns.id, runId))
      .limit(1);

    if (!run) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }

    const { issueNumber, body } = req.body as { issueNumber?: unknown; body?: unknown };

    if (typeof issueNumber !== 'number' || !Number.isInteger(issueNumber) || issueNumber < 1) {
      res.status(400).json({ error: '`issueNumber` must be a positive integer.' });
      return;
    }
    if (typeof body !== 'string' || !body.trim()) {
      res.status(400).json({ error: '`body` must be a non-empty string.' });
      return;
    }

    const safeBody = sanitizeCommentBody(body);

    // Use --body-file - and pipe via stdin to keep the body out of argv
    let ghOutput: string;
    try {
      const { stdout } = await execFileAsync(
        'gh',
        ['issue', 'comment', String(issueNumber), '--body-file', '-'],
        {
          timeout: GIT_TIMEOUT_MS,
          input: safeBody,
          // cwd: workspace path if available (for repo context), else undefined (gh falls back to env)
          ...(run.workspacePath ? { cwd: run.workspacePath } : {}),
        } as Parameters<typeof execFileAsync>[2] & { input?: string },
      );
      ghOutput = String(stdout).trim();
    } catch (e: unknown) {
      const stderr = (e as { stderr?: string }).stderr ?? '';
      const msg = e instanceof Error ? e.message : String(e);
      res.status(500).json({ error: 'gh issue comment failed', detail: (stderr || msg).trim() });
      return;
    }

    // gh issue comment --body-file - outputs the comment URL on stdout
    const commentUrl = ghOutput.split('\n').filter(Boolean).pop() ?? '';

    eventBus.emitGitEvent('git.comment.posted', projectId, { runId, commentUrl, issueNumber });

    res.json({ commentUrl, issueNumber });
  } catch (err) {
    handleError(res, err);
  }
});

// ---------------------------------------------------------------------------
// POST /:runId/git/pr/merge — Merge the PR for this run (G2.5)
// ---------------------------------------------------------------------------
// Request body: { method?: 'merge' | 'squash' | 'rebase' }  — default 'squash'
// Response 200: { prUrl, sha, method }
// Response 409: { error, checks } — CI is failing or PR not ready
// Response 4xx/5xx: { error }
// ---------------------------------------------------------------------------
projectRunsRouter.post('/:runId/git/pr/merge', async (req: Request, res: Response) => {
  const { runId, projectId } = req.params as Record<string, string>;
  const db = getDb();

  try {
    const [run] = await db
      .select()
      .from(schema.issueRuns)
      .where(eq(schema.issueRuns.id, runId))
      .limit(1);

    if (!run) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }

    if (!run.workspacePath) {
      res.status(422).json({ error: 'Run has no workspace path.' });
      return;
    }

    try {
      assertSafeWorkspacePath(run.workspacePath);
    } catch (e) {
      res.status(403).json({ error: String(e) });
      return;
    }

    // Discover PR number: prefer cached value on the run, else query gh
    let prNum: number | null = run.prNumber ?? null;
    let prUrl: string = run.prUrl ?? '';

    if (!prNum) {
      // Derive from current branch via gh pr view
      try {
        const { stdout } = await execFileAsync(
          'gh', ['pr', 'view', '--json', 'number,url,state'],
          { cwd: run.workspacePath, timeout: GIT_TIMEOUT_MS },
        );
        const view = JSON.parse(stdout.trim()) as { number: number; url: string; state: string };
        prNum = view.number;
        prUrl = view.url;
        // Cache the discovered PR number
        await db
          .update(schema.issueRuns)
          .set({ prNumber: prNum, prUrl, prState: view.state.toLowerCase(), updatedAt: new Date() })
          .where(eq(schema.issueRuns.id, runId));
      } catch (e: unknown) {
        const stderr = (e as { stderr?: string }).stderr ?? '';
        const msg = e instanceof Error ? e.message : String(e);
        res.status(422).json({ error: 'Could not determine PR number — has a PR been created for this run?', detail: (stderr || msg).trim() });
        return;
      }
    }

    if (!prNum) {
      res.status(422).json({ error: 'No PR number found for this run.' });
      return;
    }

    // Validate: check required CI checks before merging
    try {
      await execFileAsync(
        'gh', ['pr', 'checks', String(prNum), '--required'],
        { cwd: run.workspacePath, timeout: GIT_TIMEOUT_MS },
      );
    } catch (e: unknown) {
      const stderr = (e as { stderr?: string }).stderr ?? '';
      const stdout = (e as { stdout?: string }).stdout ?? '';

      // Update cached CI state to 'failing'
      await db
        .update(schema.issueRuns)
        .set({ ciState: 'failing', gitCacheRefreshedAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.issueRuns.id, runId));

      res.status(409).json({
        error: 'Required CI checks are failing or still running — cannot merge.',
        checks: (stderr || stdout).trim(),
      });
      return;
    }

    // Update CI state to passing
    await db
      .update(schema.issueRuns)
      .set({ ciState: 'passing', gitCacheRefreshedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.issueRuns.id, runId));

    // Determine merge method (default: squash)
    const rawMethod = req.body?.method;
    const mergeMethod: 'merge' | 'squash' | 'rebase' =
      rawMethod === 'merge' || rawMethod === 'rebase' ? rawMethod : 'squash';

    const mergeFlag = `--${mergeMethod}`;

    let ghMergeOutput: string;
    try {
      const { stdout, stderr } = await execFileAsync(
        'gh', ['pr', 'merge', String(prNum), mergeFlag, '--delete-branch'],
        { cwd: run.workspacePath, timeout: GIT_TIMEOUT_MS },
      );
      ghMergeOutput = (stdout + stderr).trim();
    } catch (e: unknown) {
      const stderr = (e as { stderr?: string }).stderr ?? '';
      const msg = e instanceof Error ? e.message : String(e);
      // Surface gh's error verbatim (branch protection, auth, etc.)
      res.status(500).json({ error: 'gh pr merge failed', detail: (stderr || msg).trim() });
      return;
    }

    // Extract merge SHA from gh output if available (gh outputs it in some modes)
    const shaMatch = ghMergeOutput.match(/([0-9a-f]{40})/i);
    const sha = shaMatch ? shaMatch[1] : '';

    // Update run record: mark PR as merged
    await db
      .update(schema.issueRuns)
      .set({ prState: 'merged', updatedAt: new Date() })
      .where(eq(schema.issueRuns.id, runId));

    eventBus.emitGitEvent('git.pr.merged', projectId, { runId, prUrl, sha, method: mergeMethod });

    res.json({ prUrl, sha, method: mergeMethod });
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
