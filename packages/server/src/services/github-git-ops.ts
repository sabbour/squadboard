/**
 * services/github-git-ops.ts — Stream G Phase 2B
 *
 * Core git/gh-CLI operations extracted from routes/runs.ts so that both
 * the HTTP route handlers (Express) and the MCP tool handlers can call the
 * same logic without duplication.
 *
 * Each function returns a typed result object on success; throws a typed
 * GitOpsError on validation or execution failure. Callers convert to their
 * own error surface (HTTP status code vs. MCP error payload).
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { eventBus } from '../realtime/event-bus.js';
import { assertSafeWorkspacePath } from '../engine/workspace.js';

const execFileAsync = promisify(execFile);

const PROTECTED_BRANCHES = new Set(['main', 'master', 'develop', 'trunk']);
const GIT_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export type GitOpsErrorCode =
  | 'run_not_found'
  | 'workspace_missing'
  | 'strategy_mismatch'
  | 'path_unsafe'
  | 'branch_detection_failed'
  | 'branch_invalid'
  | 'branch_protected'
  | 'push_failed'
  | 'pr_create_failed'
  | 'pr_not_found'
  | 'pr_checks_failing'
  | 'pr_merge_failed'
  | 'comment_failed'
  | 'workflow_trigger_failed'
  | 'workflow_run_not_found';

export class GitOpsError extends Error {
  constructor(
    public readonly code: GitOpsErrorCode,
    public readonly detail: string,
    public readonly httpStatus: 400 | 403 | 404 | 409 | 422 | 500 = 500,
  ) {
    super(detail);
    this.name = 'GitOpsError';
  }
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Reject any branch name that contains characters outside a safe allowlist */
function sanitizeBranchName(name: string): void {
  if (!/^[a-zA-Z0-9/_.-]+$/.test(name)) {
    throw new GitOpsError(
      'branch_invalid',
      `Branch name "${name}" contains invalid characters. Only a-z A-Z 0-9 / _ . - are allowed.`,
      422,
    );
  }
}

/** Strip null bytes and ANSI escape sequences from user-supplied comment bodies */
function sanitizeCommentBody(body: string): string {
  // eslint-disable-next-line no-control-regex
  return body.replace(/\x00/g, '').replace(/\x1b\[[0-9;]*[mGKHFJ]/g, '');
}

async function fetchRun(runId: string) {
  const db = getDb();
  const [run] = await db
    .select()
    .from(schema.issueRuns)
    .where(eq(schema.issueRuns.id, runId))
    .limit(1);
  return run ?? null;
}

async function resolveProjectId(runId: string): Promise<string> {
  const db = getDb();
  const [run] = await db
    .select({ issueId: schema.issueRuns.issueId })
    .from(schema.issueRuns)
    .where(eq(schema.issueRuns.id, runId))
    .limit(1);
  if (!run) throw new GitOpsError('run_not_found', `Run ${runId} not found`, 404);

  const [issue] = await db
    .select({ projectId: schema.issues.projectId })
    .from(schema.issues)
    .where(eq(schema.issues.id, run.issueId))
    .limit(1);
  if (!issue) throw new GitOpsError('run_not_found', `Issue for run ${runId} not found`, 404);
  return issue.projectId;
}

// ---------------------------------------------------------------------------
// D1.1 — push branch
// ---------------------------------------------------------------------------

export interface PushBranchResult {
  branch: string;
  branchUrl: string;
  pushOutput: string;
}

export async function pushBranch(runId: string, projectId?: string): Promise<PushBranchResult> {
  const db = getDb();
  const run = await fetchRun(runId);
  if (!run) throw new GitOpsError('run_not_found', `Run ${runId} not found`, 404);
  if (!run.workspacePath) {
    throw new GitOpsError('workspace_missing', 'Run has no workspace path — only worktree runs can be pushed.', 422);
  }
  if (run.workspaceStrategy !== 'worktree') {
    throw new GitOpsError(
      'strategy_mismatch',
      `Push is only supported for worktree runs (this run uses strategy "${run.workspaceStrategy}").`,
      422,
    );
  }

  try {
    assertSafeWorkspacePath(run.workspacePath);
  } catch (e) {
    throw new GitOpsError('path_unsafe', String(e), 403);
  }

  let branch: string;
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: run.workspacePath,
      timeout: GIT_TIMEOUT_MS,
    });
    branch = stdout.trim();
  } catch (e) {
    throw new GitOpsError('branch_detection_failed', `Could not determine current branch: ${String(e)}`, 500);
  }

  sanitizeBranchName(branch);

  if (PROTECTED_BRANCHES.has(branch)) {
    throw new GitOpsError('branch_protected', `Refusing to push to protected branch "${branch}".`, 422);
  }

  let pushOutput: string;
  try {
    const { stdout, stderr } = await execFileAsync('git', ['push', '-u', 'origin', branch], {
      cwd: run.workspacePath,
      timeout: GIT_TIMEOUT_MS,
    });
    pushOutput = (stdout + stderr).trim();
  } catch (e: unknown) {
    const stderr = (e as { stderr?: string }).stderr ?? '';
    const msg = e instanceof Error ? e.message : String(e);
    throw new GitOpsError('push_failed', (stderr || msg).trim(), 500);
  }

  let branchUrl = '';
  try {
    const { stdout: remoteUrl } = await execFileAsync('git', ['remote', 'get-url', 'origin'], {
      cwd: run.workspacePath,
      timeout: GIT_TIMEOUT_MS,
    });
    const remote = remoteUrl.trim().replace(/\.git$/, '').replace(/^git@github\.com:/, 'https://github.com/');
    branchUrl = `${remote}/tree/${branch}`;
  } catch { /* non-fatal */ }

  const resolvedProjectId = projectId ?? await resolveProjectId(runId);
  eventBus.emitGitEvent('git.push.complete', resolvedProjectId, { runId, branch, branchUrl, pushOutput });

  await db
    .update(schema.issueRuns)
    .set({ gitBranch: branch, gitBranchUrl: branchUrl, updatedAt: new Date() })
    .where(eq(schema.issueRuns.id, runId));

  return { branch, branchUrl, pushOutput };
}

// ---------------------------------------------------------------------------
// D1.2 — open PR
// ---------------------------------------------------------------------------

export interface CreatePrOptions {
  title?: string;
  body?: string;
  draft?: boolean;
}

export interface CreatePrResult {
  prUrl: string;
  prNumber: number | undefined;
}

export function buildPrBody(ctx: { agentName: string; runId: string; branch: string }): string {
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

export async function createPr(runId: string, opts: CreatePrOptions = {}, projectId?: string): Promise<CreatePrResult> {
  const db = getDb();
  const run = await fetchRun(runId);
  if (!run) throw new GitOpsError('run_not_found', `Run ${runId} not found`, 404);
  if (!run.workspacePath) throw new GitOpsError('workspace_missing', 'Run has no workspace path.', 422);
  if (run.workspaceStrategy !== 'worktree') {
    throw new GitOpsError('strategy_mismatch', 'PR creation is only supported for worktree runs.', 422);
  }

  try {
    assertSafeWorkspacePath(run.workspacePath);
  } catch (e) {
    throw new GitOpsError('path_unsafe', String(e), 403);
  }

  let branch: string;
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: run.workspacePath,
      timeout: GIT_TIMEOUT_MS,
    });
    branch = stdout.trim();
  } catch (e) {
    throw new GitOpsError('branch_detection_failed', `Could not determine current branch: ${String(e)}`, 500);
  }

  if (PROTECTED_BRANCHES.has(branch)) {
    throw new GitOpsError('branch_protected', `Refusing to open a PR from protected branch "${branch}".`, 422);
  }

  const [agent] = await db.select({ name: schema.agents.name }).from(schema.agents).where(eq(schema.agents.id, run.agentId)).limit(1);
  const [issue] = await db.select({ title: schema.issues.title }).from(schema.issues).where(eq(schema.issues.id, run.issueId)).limit(1);

  const prTitle = opts.title ?? (issue ? issue.title : `Run ${runId.slice(0, 8)}`);
  const prBody = opts.body ?? buildPrBody({ agentName: agent?.name ?? 'unknown', runId, branch });
  const draft = opts.draft === true;

  const ghArgs = ['pr', 'create', '--title', prTitle, '--body', prBody];
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
    throw new GitOpsError('pr_create_failed', (stderr || msg).trim(), 500);
  }

  const lines = ghOutput.split('\n').filter(Boolean);
  const prUrl = lines[lines.length - 1] ?? '';
  const prNumberMatch = prUrl.match(/\/pull\/(\d+)$/);
  const prNumber = prNumberMatch ? parseInt(prNumberMatch[1], 10) : undefined;

  const resolvedProjectId = projectId ?? await resolveProjectId(runId);
  eventBus.emitGitEvent('git.pr.created', resolvedProjectId, { runId, branch, prUrl, prNumber });

  await db
    .update(schema.issueRuns)
    .set({ prNumber: prNumber ?? null, prUrl, prState: 'open', updatedAt: new Date() })
    .where(eq(schema.issueRuns.id, runId));

  return { prUrl, prNumber };
}

// ---------------------------------------------------------------------------
// D1.3 — comment on GitHub issue
// ---------------------------------------------------------------------------

export interface CommentOnIssueOptions {
  issueNumber: number;
  body: string;
}

export interface CommentResult {
  commentUrl: string;
  issueNumber: number;
}

export async function commentOnIssue(runId: string, opts: CommentOnIssueOptions, projectId?: string): Promise<CommentResult> {
  const run = await fetchRun(runId);
  if (!run) throw new GitOpsError('run_not_found', `Run ${runId} not found`, 404);

  const { issueNumber, body } = opts;

  if (!Number.isInteger(issueNumber) || issueNumber < 1) {
    throw new GitOpsError('run_not_found', '`issueNumber` must be a positive integer.', 400);
  }
  if (!body.trim()) {
    throw new GitOpsError('run_not_found', '`body` must be a non-empty string.', 400);
  }

  const safeBody = sanitizeCommentBody(body);

  let ghOutput: string;
  try {
    const { stdout } = await execFileAsync(
      'gh',
      ['issue', 'comment', String(issueNumber), '--body-file', '-'],
      {
        timeout: GIT_TIMEOUT_MS,
        input: safeBody,
        ...(run.workspacePath ? { cwd: run.workspacePath } : {}),
      } as Parameters<typeof execFileAsync>[2] & { input?: string },
    );
    ghOutput = String(stdout).trim();
  } catch (e: unknown) {
    const stderr = (e as { stderr?: string }).stderr ?? '';
    const msg = e instanceof Error ? e.message : String(e);
    throw new GitOpsError('comment_failed', (stderr || msg).trim(), 500);
  }

  const commentUrl = ghOutput.split('\n').filter(Boolean).pop() ?? '';
  const resolvedProjectId = projectId ?? await resolveProjectId(runId);
  eventBus.emitGitEvent('git.comment.posted', resolvedProjectId, { runId, commentUrl, issueNumber });

  return { commentUrl, issueNumber };
}

// ---------------------------------------------------------------------------
// D1.4 — trigger GitHub Actions workflow (new — no existing HTTP endpoint)
// ---------------------------------------------------------------------------

export interface TriggerWorkflowOptions {
  workflowFile: string;
  ref: string;
  inputs?: Record<string, string>;
}

export interface TriggerWorkflowResult {
  workflowRunId: string;
  runUrl: string;
}

export async function triggerWorkflow(opts: TriggerWorkflowOptions): Promise<TriggerWorkflowResult> {
  const { workflowFile, ref, inputs = {} } = opts;

  if (!workflowFile || typeof workflowFile !== 'string') {
    throw new GitOpsError('workflow_trigger_failed', '`workflowFile` is required.', 400);
  }
  if (!ref || typeof ref !== 'string') {
    throw new GitOpsError('workflow_trigger_failed', '`ref` is required.', 400);
  }

  // Sanitize: workflowFile must be a safe filename (no path traversal)
  if (!/^[a-zA-Z0-9_.-]+\.ya?ml$/.test(workflowFile)) {
    throw new GitOpsError('workflow_trigger_failed', '`workflowFile` must be a .yml or .yaml filename with no path separators.', 400);
  }

  const triggerArgs = ['workflow', 'run', workflowFile, '--ref', ref];
  for (const [key, value] of Object.entries(inputs)) {
    triggerArgs.push('--field', `${key}=${value}`);
  }

  const triggeredAt = new Date();
  try {
    await execFileAsync('gh', triggerArgs, { timeout: GIT_TIMEOUT_MS });
  } catch (e: unknown) {
    const stderr = (e as { stderr?: string }).stderr ?? '';
    const msg = e instanceof Error ? e.message : String(e);
    throw new GitOpsError('workflow_trigger_failed', (stderr || msg).trim(), 500);
  }

  // Poll for the run that started at/after triggeredAt (best-effort — gh may
  // enqueue the run with a brief delay).
  await new Promise<void>((resolve) => setTimeout(resolve, 2000));

  try {
    const { stdout } = await execFileAsync(
      'gh',
      ['run', 'list', '--workflow', workflowFile, '--limit', '1', '--json', 'databaseId,url,createdAt'],
      { timeout: GIT_TIMEOUT_MS },
    );
    const runs = JSON.parse(stdout.trim()) as { databaseId: number; url: string; createdAt: string }[];
    const latest = runs[0];
    if (latest) {
      return { workflowRunId: String(latest.databaseId), runUrl: latest.url };
    }
  } catch { /* fall through */ }

  // If we can't fetch the run, return a partial result so the caller still knows it fired.
  throw new GitOpsError(
    'workflow_run_not_found',
    'Workflow triggered but could not retrieve run ID immediately — check GitHub Actions for the latest run.',
    500,
  );
}

// ---------------------------------------------------------------------------
// D1.5 — merge PR
// ---------------------------------------------------------------------------

export interface MergePrOptions {
  method?: 'squash' | 'merge' | 'rebase';
}

export interface MergePrResult {
  prUrl: string;
  sha: string;
  method: 'squash' | 'merge' | 'rebase';
}

export async function mergePr(runId: string, opts: MergePrOptions = {}, projectId?: string): Promise<MergePrResult> {
  const db = getDb();
  const run = await fetchRun(runId);
  if (!run) throw new GitOpsError('run_not_found', `Run ${runId} not found`, 404);
  if (!run.workspacePath) throw new GitOpsError('workspace_missing', 'Run has no workspace path.', 422);

  try {
    assertSafeWorkspacePath(run.workspacePath);
  } catch (e) {
    throw new GitOpsError('path_unsafe', String(e), 403);
  }

  let prNum: number | null = run.prNumber ?? null;
  let prUrl: string = run.prUrl ?? '';

  if (!prNum) {
    try {
      const { stdout } = await execFileAsync(
        'gh', ['pr', 'view', '--json', 'number,url,state'],
        { cwd: run.workspacePath, timeout: GIT_TIMEOUT_MS },
      );
      const view = JSON.parse(stdout.trim()) as { number: number; url: string; state: string };
      prNum = view.number;
      prUrl = view.url;
      await db
        .update(schema.issueRuns)
        .set({ prNumber: prNum, prUrl, prState: view.state.toLowerCase(), updatedAt: new Date() })
        .where(eq(schema.issueRuns.id, runId));
    } catch (e: unknown) {
      const stderr = (e as { stderr?: string }).stderr ?? '';
      const msg = e instanceof Error ? e.message : String(e);
      throw new GitOpsError(
        'pr_not_found',
        `Could not determine PR number: ${(stderr || msg).trim()}`,
        422,
      );
    }
  }

  if (!prNum) throw new GitOpsError('pr_not_found', 'No PR number found for this run.', 422);

  // Validate CI checks
  try {
    await execFileAsync('gh', ['pr', 'checks', String(prNum), '--required'], {
      cwd: run.workspacePath,
      timeout: GIT_TIMEOUT_MS,
    });
  } catch (e: unknown) {
    const stderr = (e as { stderr?: string }).stderr ?? '';
    const stdout = (e as { stdout?: string }).stdout ?? '';
    await db
      .update(schema.issueRuns)
      .set({ ciState: 'failing', gitCacheRefreshedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.issueRuns.id, runId));
    throw new GitOpsError('pr_checks_failing', (stderr || stdout).trim(), 409);
  }

  await db
    .update(schema.issueRuns)
    .set({ ciState: 'passing', gitCacheRefreshedAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.issueRuns.id, runId));

  const mergeMethod: 'merge' | 'squash' | 'rebase' =
    opts.method === 'merge' || opts.method === 'rebase' ? opts.method : 'squash';

  let ghMergeOutput: string;
  try {
    const { stdout, stderr } = await execFileAsync(
      'gh', ['pr', 'merge', String(prNum), `--${mergeMethod}`, '--delete-branch'],
      { cwd: run.workspacePath, timeout: GIT_TIMEOUT_MS },
    );
    ghMergeOutput = (stdout + stderr).trim();
  } catch (e: unknown) {
    const stderr = (e as { stderr?: string }).stderr ?? '';
    const msg = e instanceof Error ? e.message : String(e);
    throw new GitOpsError('pr_merge_failed', (stderr || msg).trim(), 500);
  }

  const shaMatch = ghMergeOutput.match(/([0-9a-f]{40})/i);
  const sha = shaMatch ? shaMatch[1] : '';

  await db
    .update(schema.issueRuns)
    .set({ prState: 'merged', updatedAt: new Date() })
    .where(eq(schema.issueRuns.id, runId));

  const resolvedProjectId = projectId ?? await resolveProjectId(runId);
  eventBus.emitGitEvent('git.pr.merged', resolvedProjectId, { runId, prUrl, sha, method: mergeMethod });

  return { prUrl, sha, method: mergeMethod };
}
