import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';

export type WorkspaceStrategy = 'scratch' | 'dir' | 'worktree';

/** Allowed workspace roots for git operations — must match one of these prefixes. */
const ALLOWED_WORKSPACE_ROOTS = [
  path.join(os.homedir(), '.squadboard'),
  os.tmpdir(),
];

/**
 * Validate that a workspace path is under an allowed root.
 * Prevents push/PR operations from running against arbitrary paths.
 */
export function assertSafeWorkspacePath(workspacePath: string): void {
  const resolved = path.resolve(workspacePath);
  const ok = ALLOWED_WORKSPACE_ROOTS.some((root) => resolved.startsWith(root + path.sep) || resolved === root);
  if (!ok) {
    throw new Error(`Workspace path "${workspacePath}" is outside allowed roots (${ALLOWED_WORKSPACE_ROOTS.join(', ')}). Refusing operation.`);
  }
}

/**
 * Derive the canonical Squad branch name from agent name and issue title.
 * Convention: `squad/{agent-name-lowercased}/{slug-from-issue-title}`
 * For ceremony runs: `squad/ceremony/{ceremony-slug}-{run-id-suffix}`
 *
 * Slug rules: lowercase, alphanumeric + hyphen, max 50 chars, no leading/trailing hyphens.
 */
export function deriveSquadBranchName(agentName: string, issueTitle: string): string {
  const agentSlug = agentName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30);

  const titleSlug = issueTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);

  return `squad/${agentSlug}/${titleSlug}`;
}

/**
 * Resolve (and create) the workspace directory for a run.
 *
 * scratch  → OS temp dir   : <tmpdir>/squadboard-run-<id>
 * dir      → home dir      : ~/.squadboard/workspaces/<id>
 * worktree → git worktree  : ~/.squadboard/worktrees/<repoName>-run-<issueRunId>
 *            Branch name follows squad/{agent}/{slug} convention when agentName + issueTitle are provided.
 */
export async function resolveWorkspace(
  issueRunId: string,
  strategy: WorkspaceStrategy,
  opts?: { agentName?: string; issueTitle?: string },
): Promise<string> {
  let workspacePath: string;

  switch (strategy) {
    case 'scratch':
      workspacePath = path.join(os.tmpdir(), `squadboard-run-${issueRunId}`);
      await mkdir(workspacePath, { recursive: true });
      break;

    case 'dir':
      workspacePath = path.join(
        os.homedir(),
        '.squadboard',
        'workspaces',
        issueRunId,
      );
      await mkdir(workspacePath, { recursive: true });
      break;

    case 'worktree': {
      const repoRoot = execSync('git rev-parse --show-toplevel', {
        stdio: 'pipe',
        encoding: 'utf-8',
      }).trim();
      const repoName = path.basename(repoRoot);

      // Worktrees live under ~/.squadboard/worktrees/ (always within the allowed root)
      const worktreesRoot = path.join(os.homedir(), '.squadboard', 'worktrees');
      await mkdir(worktreesRoot, { recursive: true });
      workspacePath = path.join(worktreesRoot, `${repoName}-run-${issueRunId}`);

      // Use squad convention when we have the metadata; fall back to run-id slug
      const branch =
        opts?.agentName && opts?.issueTitle
          ? deriveSquadBranchName(opts.agentName, opts.issueTitle)
          : `squad/run-${issueRunId}`;

      try {
        execSync(`git worktree add ${workspacePath} -b ${branch} HEAD`, {
          stdio: 'pipe',
          cwd: repoRoot,
        });
      } catch (err: unknown) {
        const stderr = err instanceof Error && 'stderr' in err
          ? String((err as NodeJS.ErrnoException & { stderr?: Buffer }).stderr)
          : '';
        if (!stderr.includes('already exists')) {
          throw err;
        }
        // Worktree already exists — reuse it.
      }
      break;
    }

    default:
      throw new Error(`Unknown workspace strategy: ${strategy as string}`);
  }

  return workspacePath;
}

/**
 * Remove the workspace directory after a run finishes.
 * For 'worktree', runs `git worktree remove --force` and attempts branch deletion.
 */
export async function cleanupWorkspace(
  workspacePath: string,
  strategy: WorkspaceStrategy,
): Promise<void> {
  if (strategy === 'worktree') {
    try {
      execSync(`git worktree remove --force ${workspacePath}`, { stdio: 'pipe' });
    } catch (err) {
      console.warn(`[workspace] git worktree remove failed for ${workspacePath}:`, err);
    }
    // Best-effort branch deletion; branch name is read from the worktree's HEAD
    try {
      const branch = execSync(`git -C ${workspacePath} rev-parse --abbrev-ref HEAD`, {
        stdio: 'pipe',
        encoding: 'utf-8',
      }).trim();
      if (branch && branch !== 'HEAD' && branch.startsWith('squad/')) {
        execSync(`git branch -d ${branch}`, { stdio: 'pipe' });
      }
    } catch {
      // Non-fatal — the branch may already be gone or the worktree dir removed
    }
    return;
  }
  await rm(workspacePath, { recursive: true, force: true });
}
