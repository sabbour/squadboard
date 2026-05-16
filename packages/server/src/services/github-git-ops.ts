/**
 * services/github-git-ops.ts — Stream G (Wave 21 close)
 *
 * Core git/gh-CLI operations extracted from routes/runs.ts so that both
 * the HTTP route handlers (Express) and the MCP tool handlers can call the
 * same logic without duplication.
 *
 * Wave 21 additions (G1.1 + G1.2):
 *   dispatchWorkflow      — typed wrapper around triggerWorkflow with explicit owner/repo
 *   pollWorkflowRun       — poll gh run view until complete or timeout
 *   listWorkflows         — list workflows in a repo
 *   getDefaultBranch      — resolve repo default branch via gh api
 *   listBranches          — list branches (with optional prefix filter)
 *   whoAmI                — gh auth status parsed to JSON
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

/** Allow tests (and local overrides) to substitute a fake gh binary. */
export const GH_BIN = (): string => process.env['GH_BIN_OVERRIDE'] ?? 'gh';

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
  | 'workflow_run_not_found'
  | 'workflow_poll_timeout'
  | 'introspection_failed';

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
    const { stdout, stderr } = await execFileAsync(GH_BIN(), ghArgs, {
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
      GH_BIN(),
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
  /** Optional GitHub repo context (owner/repo). If provided, passes --repo to gh. */
  owner?: string;
  repo?: string;
  /** Working directory for gh; falls back to process cwd if not specified. */
  cwd?: string;
}

export interface TriggerWorkflowResult {
  workflowRunId: string;
  runUrl: string;
}

export async function triggerWorkflow(opts: TriggerWorkflowOptions): Promise<TriggerWorkflowResult> {
  const { workflowFile, ref, inputs = {}, owner, repo, cwd } = opts;

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
  if (owner && repo) triggerArgs.push('--repo', `${owner}/${repo}`);
  for (const [key, value] of Object.entries(inputs)) {
    triggerArgs.push('--field', `${key}=${value}`);
  }

  const execOpts: Record<string, unknown> = { timeout: GIT_TIMEOUT_MS };
  if (cwd) execOpts['cwd'] = cwd;

  try {
    await execFileAsync(GH_BIN(), triggerArgs, execOpts as Parameters<typeof execFileAsync>[2]);
  } catch (e: unknown) {
    const stderr = (e as { stderr?: string }).stderr ?? '';
    const msg = e instanceof Error ? e.message : String(e);
    throw new GitOpsError('workflow_trigger_failed', (stderr || msg).trim(), 500);
  }

  // Poll for the run that started at/after triggeredAt (best-effort — gh may
  // enqueue the run with a brief delay).
  await new Promise<void>((resolve) => setTimeout(resolve, 2000));

  const listArgs = [
    'run', 'list', '--workflow', workflowFile,
    '--limit', '1', '--json', 'databaseId,url,createdAt',
  ];
  if (owner && repo) listArgs.push('--repo', `${owner}/${repo}`);

  try {
    const { stdout } = await execFileAsync(
      GH_BIN(),
      listArgs,
      execOpts as Parameters<typeof execFileAsync>[2],
    );
    const runs = JSON.parse(String(stdout).trim()) as { databaseId: number; url: string; createdAt: string }[];
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
        GH_BIN(), ['pr', 'view', '--json', 'number,url,state'],
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
    await execFileAsync(GH_BIN(), ['pr', 'checks', String(prNum), '--required'], {
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
      GH_BIN(), ['pr', 'merge', String(prNum), `--${mergeMethod}`, '--delete-branch'],
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

// ---------------------------------------------------------------------------
// G4.1 — Assign issue to @copilot (virtual agent dispatch)
// ---------------------------------------------------------------------------

export interface AssignToCopilotOptions {
  /** The local Squadboard issue UUID (used to resolve the GitHub issue number). */
  issueId: string;
  /** Project GitHub owner (org or user). */
  owner: string;
  /** Project GitHub repo name. */
  repo: string;
  /**
   * If set, dispatch a workflow_dispatch event to this workflow file instead
   * of assigning the GitHub issue to @copilot. Shape: 'copilot-coding-agent.yml'.
   */
  workflowFile?: string;
  /** Git ref for workflow dispatch. Defaults to 'main'. */
  ref?: string;
  /** Optional workflow_dispatch inputs passed through to gh workflow run. */
  inputs?: Record<string, string>;
}

export interface AssignToCopilotResult {
  mode: 'workflow' | 'issue_assign';
  /** Set when mode='workflow'. */
  workflowRunId?: string;
  runUrl?: string;
  /** Set when mode='issue_assign'. */
  issueNumber?: number;
}

/**
 * Assign-to-@copilot — two modes:
 * 1. If workflowFile is set: `gh workflow run <file> --repo owner/repo --ref ref`
 * 2. Otherwise: `gh issue edit <issueNumber> --add-assignee copilot --repo owner/repo`
 *
 * In both cases the caller is responsible for persisting the issue_runs row
 * with externalRef and emitting the WS event.
 */
export async function assignToCopilot(
  opts: AssignToCopilotOptions,
): Promise<AssignToCopilotResult> {
  const { issueId, owner, repo, workflowFile, ref = 'main', inputs } = opts;

  // Resolve the GitHub issue number from the local issue row.
  const db = getDb();
  const [issue] = await db
    .select({ githubIssueNumber: schema.issues.githubIssueNumber })
    .from(schema.issues)
    .where(eq(schema.issues.id, issueId))
    .limit(1);

  if (!issue) {
    throw new GitOpsError('run_not_found', `Issue ${issueId} not found.`, 404);
  }

  if (workflowFile) {
    // Mode 1: dispatch a workflow_dispatch event.
    try {
      const result = await triggerWorkflow({ workflowFile, ref, inputs, owner, repo });
      return { mode: 'workflow', ...result };
    } catch (e) {
      if (e instanceof GitOpsError) throw e;
      throw new GitOpsError('workflow_trigger_failed', String(e), 500);
    }
  }

  // Mode 2: assign the GitHub issue to the copilot user.
  const ghIssueNumber = issue.githubIssueNumber;
  if (!ghIssueNumber) {
    throw new GitOpsError(
      'run_not_found',
      'Issue has no linked GitHub issue number. Enable GitHub sync or create the issue on GitHub first.',
      422,
    );
  }

  try {
    await execFileAsync(
      GH_BIN(),
      ['issue', 'edit', String(ghIssueNumber), '--add-assignee', 'copilot', '--repo', `${owner}/${repo}`],
      { timeout: GIT_TIMEOUT_MS },
    );
  } catch (e: unknown) {
    const stderr = (e as { stderr?: string }).stderr ?? '';
    const msg = e instanceof Error ? e.message : String(e);
    throw new GitOpsError('workflow_trigger_failed', (stderr || msg).trim(), 500);
  }

  return { mode: 'issue_assign', issueNumber: ghIssueNumber };
}

// ---------------------------------------------------------------------------
// G1.1 — dispatchWorkflow (typed wrapper around triggerWorkflow)
// ---------------------------------------------------------------------------

export interface DispatchWorkflowOptions {
  owner: string;
  repo: string;
  /** Workflow filename, e.g. "deploy.yml". No path separators. */
  workflow_file: string;
  ref: string;
  inputs?: Record<string, string>;
}

export interface DispatchWorkflowResult {
  workflowRunId: string;
  runUrl: string;
  owner: string;
  repo: string;
  workflow_file: string;
  ref: string;
}

/**
 * Dispatch a workflow_dispatch event and return the resulting run ID + URL.
 * Validates owner/repo/workflow_file before shelling out.
 */
export async function dispatchWorkflow(opts: DispatchWorkflowOptions): Promise<DispatchWorkflowResult> {
  const { owner, repo, workflow_file, ref, inputs } = opts;

  if (!owner || typeof owner !== 'string') {
    throw new GitOpsError('workflow_trigger_failed', '`owner` is required.', 400);
  }
  if (!repo || typeof repo !== 'string') {
    throw new GitOpsError('workflow_trigger_failed', '`repo` is required.', 400);
  }

  const result = await triggerWorkflow({ workflowFile: workflow_file, ref, inputs, owner, repo });
  return { ...result, owner, repo, workflow_file, ref };
}

// ---------------------------------------------------------------------------
// G1.1 — pollWorkflowRun
// ---------------------------------------------------------------------------

export interface PollWorkflowRunOptions {
  owner: string;
  repo: string;
  run_id: string | number;
  /** Max total wait time in ms. Default 120 000 (2 min). */
  timeoutMs?: number;
}

export interface WorkflowRunStatus {
  run_id: string;
  status: string;           // queued | in_progress | completed | ...
  conclusion: string | null; // success | failure | cancelled | skipped | null
  url: string;
  name: string;
  headBranch: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Polls `gh run view <run_id> --repo owner/repo --json ...` every 5 seconds
 * (with exponential backoff capped at 15 s) until the run reaches a terminal
 * state (completed) or the timeout elapses.
 *
 * Returns the final run status on success; throws GitOpsError on timeout.
 */
export async function pollWorkflowRun(opts: PollWorkflowRunOptions): Promise<WorkflowRunStatus> {
  const { owner, repo, run_id, timeoutMs = 120_000 } = opts;

  if (!owner || !repo) {
    throw new GitOpsError('workflow_run_not_found', '`owner` and `repo` are required.', 400);
  }
  if (!run_id) {
    throw new GitOpsError('workflow_run_not_found', '`run_id` is required.', 400);
  }

  const viewArgs = [
    'run', 'view', String(run_id),
    '--repo', `${owner}/${repo}`,
    '--json', 'databaseId,status,conclusion,url,name,headBranch,createdAt,updatedAt',
  ];

  const deadline = Date.now() + timeoutMs;
  let backoffMs = 5_000;

  while (Date.now() < deadline) {
    let raw: string;
    try {
      const { stdout } = await execFileAsync(GH_BIN(), viewArgs, { timeout: GIT_TIMEOUT_MS });
      raw = String(stdout).trim();
    } catch (e: unknown) {
      const msg = (e as { stderr?: string }).stderr ?? String(e);
      throw new GitOpsError('workflow_run_not_found', `gh run view failed: ${msg}`, 500);
    }

    const data = JSON.parse(raw) as {
      databaseId: number;
      status: string;
      conclusion: string | null;
      url: string;
      name: string;
      headBranch: string;
      createdAt: string;
      updatedAt: string;
    };

    const result: WorkflowRunStatus = {
      run_id: String(data.databaseId),
      status: data.status,
      conclusion: data.conclusion,
      url: data.url,
      name: data.name,
      headBranch: data.headBranch,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    };

    if (data.status === 'completed') {
      return result;
    }

    // Wait with capped backoff before next poll
    const remaining = deadline - Date.now();
    const waitMs = Math.min(backoffMs, remaining, 15_000);
    if (waitMs <= 0) break;
    await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
    backoffMs = Math.min(backoffMs * 1.5, 15_000);
  }

  throw new GitOpsError(
    'workflow_poll_timeout',
    `Workflow run ${run_id} did not complete within ${Math.round(timeoutMs / 1000)}s.`,
    500,
  );
}

// ---------------------------------------------------------------------------
// G1.2 — listWorkflows
// ---------------------------------------------------------------------------

export interface WorkflowInfo {
  id: number;
  name: string;
  path: string;
  state: string;
}

export interface ListWorkflowsOptions {
  owner: string;
  repo: string;
}

/** List all workflows defined in the repo. */
export async function listWorkflows(opts: ListWorkflowsOptions): Promise<WorkflowInfo[]> {
  const { owner, repo } = opts;
  if (!owner || !repo) {
    throw new GitOpsError('introspection_failed', '`owner` and `repo` are required.', 400);
  }

  let raw: string;
  try {
    const { stdout } = await execFileAsync(
      GH_BIN(),
      ['workflow', 'list', '--repo', `${owner}/${repo}`, '--json', 'id,name,path,state', '--limit', '100'],
      { timeout: GIT_TIMEOUT_MS },
    );
    raw = String(stdout).trim();
  } catch (e: unknown) {
    const msg = (e as { stderr?: string }).stderr ?? String(e);
    throw new GitOpsError('introspection_failed', `gh workflow list failed: ${msg}`, 500);
  }

  return JSON.parse(raw) as WorkflowInfo[];
}

// ---------------------------------------------------------------------------
// G1.2 — getDefaultBranch
// ---------------------------------------------------------------------------

export interface GetDefaultBranchOptions {
  owner: string;
  repo: string;
}

export interface GetDefaultBranchResult {
  owner: string;
  repo: string;
  defaultBranch: string;
}

/** Resolve the default branch of a repository via the GitHub API. */
export async function getDefaultBranch(opts: GetDefaultBranchOptions): Promise<GetDefaultBranchResult> {
  const { owner, repo } = opts;
  if (!owner || !repo) {
    throw new GitOpsError('introspection_failed', '`owner` and `repo` are required.', 400);
  }

  let raw: string;
  try {
    const { stdout } = await execFileAsync(
      GH_BIN(),
      ['api', `repos/${owner}/${repo}`, '--jq', '.default_branch'],
      { timeout: GIT_TIMEOUT_MS },
    );
    raw = String(stdout).trim();
  } catch (e: unknown) {
    const msg = (e as { stderr?: string }).stderr ?? String(e);
    throw new GitOpsError('introspection_failed', `gh api repos failed: ${msg}`, 500);
  }

  if (!raw) {
    throw new GitOpsError('introspection_failed', `Could not resolve default branch for ${owner}/${repo}.`, 500);
  }

  return { owner, repo, defaultBranch: raw };
}

// ---------------------------------------------------------------------------
// G1.2 — listBranches
// ---------------------------------------------------------------------------

export interface ListBranchesOptions {
  owner: string;
  repo: string;
  /** Optional prefix / pattern to filter branches (e.g. "feature/"). */
  head?: string;
}

export interface BranchInfo {
  name: string;
  sha: string;
}

/** List branches in a repository, optionally filtered by a name prefix. */
export async function listBranches(opts: ListBranchesOptions): Promise<BranchInfo[]> {
  const { owner, repo, head } = opts;
  if (!owner || !repo) {
    throw new GitOpsError('introspection_failed', '`owner` and `repo` are required.', 400);
  }

  // Use the matching-refs API when a prefix is supplied; fall back to /branches otherwise.
  const apiPath = head
    ? `repos/${owner}/${repo}/git/matching-refs/heads/${encodeURIComponent(head)}`
    : `repos/${owner}/${repo}/branches?per_page=100`;

  let raw: string;
  try {
    const jqExpr = head
      ? '[.[] | {name: (.ref | ltrimstr("refs/heads/")), sha: .object.sha}]'
      : '[.[] | {name: .name, sha: .commit.sha}]';
    const { stdout } = await execFileAsync(
      GH_BIN(),
      ['api', apiPath, '--jq', jqExpr],
      { timeout: GIT_TIMEOUT_MS },
    );
    raw = String(stdout).trim();
  } catch (e: unknown) {
    const msg = (e as { stderr?: string }).stderr ?? String(e);
    throw new GitOpsError('introspection_failed', `gh api branches failed: ${msg}`, 500);
  }

  return JSON.parse(raw) as BranchInfo[];
}

// ---------------------------------------------------------------------------
// G1.2 — whoAmI
// ---------------------------------------------------------------------------

export interface WhoAmIResult {
  username: string | null;
  protocol: string | null;
  authenticated: boolean;
  scopes: string[];
  raw: string;
}

/** Wrapper around `gh auth status` that returns a structured JSON result. */
export async function whoAmI(): Promise<WhoAmIResult> {
  let raw = '';
  let authenticated = false;

  try {
    const { stdout, stderr } = await execFileAsync(
      GH_BIN(),
      ['auth', 'status', '--hostname', 'github.com'],
      { timeout: GIT_TIMEOUT_MS },
    ).catch((e: { stdout?: string; stderr?: string }) => ({
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? '',
    }));
    raw = (stdout + stderr).trim();
    authenticated = /Logged in/i.test(raw);
  } catch (e: unknown) {
    raw = String(e);
  }

  // Parse username from: "✓ Logged in to github.com account <user> (...)
  const usernameMatch = raw.match(/account\s+(\S+)\s+\(/);
  const username = usernameMatch ? (usernameMatch[1] ?? null) : null;

  // Parse protocol
  const protocolMatch = raw.match(/Git operations protocol:\s*(\S+)/);
  const protocol = protocolMatch ? (protocolMatch[1] ?? null) : null;

  // Parse scopes: "Token scopes: 'repo', 'read:org', ..."
  const scopesMatch = raw.match(/Token scopes?:\s*(.+)/);
  const scopes: string[] = scopesMatch
    ? (scopesMatch[1] ?? '').split(',').map((s) => s.trim().replace(/^'|'$/g, ''))
    : [];

  return { username, protocol, authenticated, scopes, raw };
}
