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
/** Allow tests (and local overrides) to substitute a fake gh binary. */
export const GH_BIN = () => process.env['GH_BIN_OVERRIDE'] ?? 'gh';
const PROTECTED_BRANCHES = new Set(['main', 'master', 'develop', 'trunk']);
const GIT_TIMEOUT_MS = 30_000;
export class GitOpsError extends Error {
    code;
    detail;
    httpStatus;
    constructor(code, detail, httpStatus = 500) {
        super(detail);
        this.code = code;
        this.detail = detail;
        this.httpStatus = httpStatus;
        this.name = 'GitOpsError';
    }
}
// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------
/** Reject any branch name that contains characters outside a safe allowlist */
function sanitizeBranchName(name) {
    if (!/^[a-zA-Z0-9/_.-]+$/.test(name)) {
        throw new GitOpsError('branch_invalid', `Branch name "${name}" contains invalid characters. Only a-z A-Z 0-9 / _ . - are allowed.`, 422);
    }
}
/** Strip null bytes and ANSI escape sequences from user-supplied comment bodies */
function sanitizeCommentBody(body) {
    // eslint-disable-next-line no-control-regex
    return body.replace(/\x00/g, '').replace(/\x1b\[[0-9;]*[mGKHFJ]/g, '');
}
async function fetchRun(runId) {
    const db = getDb();
    const [run] = await db
        .select()
        .from(schema.issueRuns)
        .where(eq(schema.issueRuns.id, runId))
        .limit(1);
    return run ?? null;
}
async function resolveProjectId(runId) {
    const db = getDb();
    const [run] = await db
        .select({ issueId: schema.issueRuns.issueId })
        .from(schema.issueRuns)
        .where(eq(schema.issueRuns.id, runId))
        .limit(1);
    if (!run)
        throw new GitOpsError('run_not_found', `Run ${runId} not found`, 404);
    const [issue] = await db
        .select({ projectId: schema.issues.projectId })
        .from(schema.issues)
        .where(eq(schema.issues.id, run.issueId))
        .limit(1);
    if (!issue)
        throw new GitOpsError('run_not_found', `Issue for run ${runId} not found`, 404);
    return issue.projectId;
}
export async function pushBranch(runId, projectId) {
    const db = getDb();
    const run = await fetchRun(runId);
    if (!run)
        throw new GitOpsError('run_not_found', `Run ${runId} not found`, 404);
    if (!run.workspacePath) {
        throw new GitOpsError('workspace_missing', 'Run has no workspace path — only worktree runs can be pushed.', 422);
    }
    if (run.workspaceStrategy !== 'worktree') {
        throw new GitOpsError('strategy_mismatch', `Push is only supported for worktree runs (this run uses strategy "${run.workspaceStrategy}").`, 422);
    }
    try {
        assertSafeWorkspacePath(run.workspacePath);
    }
    catch (e) {
        throw new GitOpsError('path_unsafe', String(e), 403);
    }
    let branch;
    try {
        const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
            cwd: run.workspacePath,
            timeout: GIT_TIMEOUT_MS,
        });
        branch = stdout.trim();
    }
    catch (e) {
        throw new GitOpsError('branch_detection_failed', `Could not determine current branch: ${String(e)}`, 500);
    }
    sanitizeBranchName(branch);
    if (PROTECTED_BRANCHES.has(branch)) {
        throw new GitOpsError('branch_protected', `Refusing to push to protected branch "${branch}".`, 422);
    }
    let pushOutput;
    try {
        const { stdout, stderr } = await execFileAsync('git', ['push', '-u', 'origin', branch], {
            cwd: run.workspacePath,
            timeout: GIT_TIMEOUT_MS,
        });
        pushOutput = (stdout + stderr).trim();
    }
    catch (e) {
        const stderr = e.stderr ?? '';
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
    }
    catch { /* non-fatal */ }
    const resolvedProjectId = projectId ?? await resolveProjectId(runId);
    eventBus.emitGitEvent('git.push.complete', resolvedProjectId, { runId, branch, branchUrl, pushOutput });
    await db
        .update(schema.issueRuns)
        .set({ gitBranch: branch, gitBranchUrl: branchUrl, updatedAt: new Date() })
        .where(eq(schema.issueRuns.id, runId));
    return { branch, branchUrl, pushOutput };
}
export function buildPrBody(ctx) {
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
export async function createPr(runId, opts = {}, projectId) {
    const db = getDb();
    const run = await fetchRun(runId);
    if (!run)
        throw new GitOpsError('run_not_found', `Run ${runId} not found`, 404);
    if (!run.workspacePath)
        throw new GitOpsError('workspace_missing', 'Run has no workspace path.', 422);
    if (run.workspaceStrategy !== 'worktree') {
        throw new GitOpsError('strategy_mismatch', 'PR creation is only supported for worktree runs.', 422);
    }
    try {
        assertSafeWorkspacePath(run.workspacePath);
    }
    catch (e) {
        throw new GitOpsError('path_unsafe', String(e), 403);
    }
    let branch;
    try {
        const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
            cwd: run.workspacePath,
            timeout: GIT_TIMEOUT_MS,
        });
        branch = stdout.trim();
    }
    catch (e) {
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
    if (draft)
        ghArgs.push('--draft');
    let ghOutput;
    try {
        const { stdout, stderr } = await execFileAsync(GH_BIN(), ghArgs, {
            cwd: run.workspacePath,
            timeout: GIT_TIMEOUT_MS,
        });
        ghOutput = (stdout + stderr).trim();
    }
    catch (e) {
        const stderr = e.stderr ?? '';
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
export async function commentOnIssue(runId, opts, projectId) {
    const run = await fetchRun(runId);
    if (!run)
        throw new GitOpsError('run_not_found', `Run ${runId} not found`, 404);
    const { issueNumber, body } = opts;
    if (!Number.isInteger(issueNumber) || issueNumber < 1) {
        throw new GitOpsError('run_not_found', '`issueNumber` must be a positive integer.', 400);
    }
    if (!body.trim()) {
        throw new GitOpsError('run_not_found', '`body` must be a non-empty string.', 400);
    }
    const safeBody = sanitizeCommentBody(body);
    let ghOutput;
    try {
        const { stdout } = await execFileAsync(GH_BIN(), ['issue', 'comment', String(issueNumber), '--body-file', '-'], {
            timeout: GIT_TIMEOUT_MS,
            input: safeBody,
            ...(run.workspacePath ? { cwd: run.workspacePath } : {}),
        });
        ghOutput = String(stdout).trim();
    }
    catch (e) {
        const stderr = e.stderr ?? '';
        const msg = e instanceof Error ? e.message : String(e);
        throw new GitOpsError('comment_failed', (stderr || msg).trim(), 500);
    }
    const commentUrl = ghOutput.split('\n').filter(Boolean).pop() ?? '';
    const resolvedProjectId = projectId ?? await resolveProjectId(runId);
    eventBus.emitGitEvent('git.comment.posted', resolvedProjectId, { runId, commentUrl, issueNumber });
    return { commentUrl, issueNumber };
}
export async function triggerWorkflow(opts) {
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
    if (owner && repo)
        triggerArgs.push('--repo', `${owner}/${repo}`);
    for (const [key, value] of Object.entries(inputs)) {
        triggerArgs.push('--field', `${key}=${value}`);
    }
    const execOpts = { timeout: GIT_TIMEOUT_MS };
    if (cwd)
        execOpts['cwd'] = cwd;
    try {
        await execFileAsync(GH_BIN(), triggerArgs, execOpts);
    }
    catch (e) {
        const stderr = e.stderr ?? '';
        const msg = e instanceof Error ? e.message : String(e);
        throw new GitOpsError('workflow_trigger_failed', (stderr || msg).trim(), 500);
    }
    // Poll for the run that started at/after triggeredAt (best-effort — gh may
    // enqueue the run with a brief delay).
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const listArgs = [
        'run', 'list', '--workflow', workflowFile,
        '--limit', '1', '--json', 'databaseId,url,createdAt',
    ];
    if (owner && repo)
        listArgs.push('--repo', `${owner}/${repo}`);
    try {
        const { stdout } = await execFileAsync(GH_BIN(), listArgs, execOpts);
        const runs = JSON.parse(String(stdout).trim());
        const latest = runs[0];
        if (latest) {
            return { workflowRunId: String(latest.databaseId), runUrl: latest.url };
        }
    }
    catch { /* fall through */ }
    // If we can't fetch the run, return a partial result so the caller still knows it fired.
    throw new GitOpsError('workflow_run_not_found', 'Workflow triggered but could not retrieve run ID immediately — check GitHub Actions for the latest run.', 500);
}
export async function mergePr(runId, opts = {}, projectId) {
    const db = getDb();
    const run = await fetchRun(runId);
    if (!run)
        throw new GitOpsError('run_not_found', `Run ${runId} not found`, 404);
    if (!run.workspacePath)
        throw new GitOpsError('workspace_missing', 'Run has no workspace path.', 422);
    try {
        assertSafeWorkspacePath(run.workspacePath);
    }
    catch (e) {
        throw new GitOpsError('path_unsafe', String(e), 403);
    }
    let prNum = run.prNumber ?? null;
    let prUrl = run.prUrl ?? '';
    if (!prNum) {
        try {
            const { stdout } = await execFileAsync(GH_BIN(), ['pr', 'view', '--json', 'number,url,state'], { cwd: run.workspacePath, timeout: GIT_TIMEOUT_MS });
            const view = JSON.parse(stdout.trim());
            prNum = view.number;
            prUrl = view.url;
            await db
                .update(schema.issueRuns)
                .set({ prNumber: prNum, prUrl, prState: view.state.toLowerCase(), updatedAt: new Date() })
                .where(eq(schema.issueRuns.id, runId));
        }
        catch (e) {
            const stderr = e.stderr ?? '';
            const msg = e instanceof Error ? e.message : String(e);
            throw new GitOpsError('pr_not_found', `Could not determine PR number: ${(stderr || msg).trim()}`, 422);
        }
    }
    if (!prNum)
        throw new GitOpsError('pr_not_found', 'No PR number found for this run.', 422);
    // Validate CI checks
    try {
        await execFileAsync(GH_BIN(), ['pr', 'checks', String(prNum), '--required'], {
            cwd: run.workspacePath,
            timeout: GIT_TIMEOUT_MS,
        });
    }
    catch (e) {
        const stderr = e.stderr ?? '';
        const stdout = e.stdout ?? '';
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
    const mergeMethod = opts.method === 'merge' || opts.method === 'rebase' ? opts.method : 'squash';
    let ghMergeOutput;
    try {
        const { stdout, stderr } = await execFileAsync(GH_BIN(), ['pr', 'merge', String(prNum), `--${mergeMethod}`, '--delete-branch'], { cwd: run.workspacePath, timeout: GIT_TIMEOUT_MS });
        ghMergeOutput = (stdout + stderr).trim();
    }
    catch (e) {
        const stderr = e.stderr ?? '';
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
/**
 * Assign-to-@copilot — two modes:
 * 1. If workflowFile is set: `gh workflow run <file> --repo owner/repo --ref ref`
 * 2. Otherwise: `gh issue edit <issueNumber> --add-assignee copilot --repo owner/repo`
 *
 * In both cases the caller is responsible for persisting the issue_runs row
 * with externalRef and emitting the WS event.
 */
export async function assignToCopilot(opts) {
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
        }
        catch (e) {
            if (e instanceof GitOpsError)
                throw e;
            throw new GitOpsError('workflow_trigger_failed', String(e), 500);
        }
    }
    // Mode 2: assign the GitHub issue to the copilot user.
    const ghIssueNumber = issue.githubIssueNumber;
    if (!ghIssueNumber) {
        throw new GitOpsError('run_not_found', 'Issue has no linked GitHub issue number. Enable GitHub sync or create the issue on GitHub first.', 422);
    }
    try {
        await execFileAsync(GH_BIN(), ['issue', 'edit', String(ghIssueNumber), '--add-assignee', 'copilot', '--repo', `${owner}/${repo}`], { timeout: GIT_TIMEOUT_MS });
    }
    catch (e) {
        const stderr = e.stderr ?? '';
        const msg = e instanceof Error ? e.message : String(e);
        throw new GitOpsError('workflow_trigger_failed', (stderr || msg).trim(), 500);
    }
    return { mode: 'issue_assign', issueNumber: ghIssueNumber };
}
//# sourceMappingURL=github-git-ops.js.map