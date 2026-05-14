import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';

export type WorkspaceStrategy = 'scratch' | 'dir' | 'worktree';

/**
 * Resolve (and create) the workspace directory for a run.
 *
 * scratch  → OS temp dir   : <tmpdir>/squadboard-run-<id>
 * dir      → home dir      : ~/.squadboard/workspaces/<id>
 * worktree → git worktree  : <repoParent>/<repoName>-run-<issueRunId>
 */
export async function resolveWorkspace(
  issueRunId: string,
  strategy: WorkspaceStrategy,
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
      const repoParent = path.dirname(repoRoot);
      const repoName = path.basename(repoRoot);
      workspacePath = path.join(repoParent, `${repoName}-run-${issueRunId}`);
      const branch = `squadboard/run-${issueRunId}`;
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
 * For 'worktree', runs `git worktree remove --force` and deletes the branch.
 */
export async function cleanupWorkspace(
  workspacePath: string,
  strategy: WorkspaceStrategy,
): Promise<void> {
  if (strategy === 'worktree') {
    const runId = path.basename(workspacePath).replace(/^.*-run-/, '');
    try {
      execSync(`git worktree remove --force ${workspacePath}`, { stdio: 'pipe' });
    } catch (err) {
      console.warn(`[workspace] git worktree remove failed for ${workspacePath}:`, err);
    }
    try {
      execSync(`git branch -d squadboard/run-${runId}`, { stdio: 'pipe' });
    } catch (err) {
      console.warn(`[workspace] git branch -d failed for squadboard/run-${runId}:`, err);
    }
    return;
  }
  await rm(workspacePath, { recursive: true, force: true });
}
