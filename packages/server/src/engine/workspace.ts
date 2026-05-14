import os from 'node:os';
import path from 'node:path';
import { mkdir, rm } from 'node:fs/promises';

export type WorkspaceStrategy = 'scratch' | 'dir' | 'worktree';

/**
 * Resolve (and create) the workspace directory for a run.
 *
 * scratch  → OS temp dir   : <tmpdir>/squadboard-run-<id>
 * dir      → home dir      : ~/.squadboard/workspaces/<id>
 * worktree → git worktree  : stubbed for Demo 4
 */
export async function resolveWorkspace(
  issueRunId: string,
  strategy: WorkspaceStrategy,
): Promise<string> {
  let workspacePath: string;

  switch (strategy) {
    case 'scratch':
      workspacePath = path.join(os.tmpdir(), `squadboard-run-${issueRunId}`);
      break;

    case 'dir':
      workspacePath = path.join(
        os.homedir(),
        '.squadboard',
        'workspaces',
        issueRunId,
      );
      break;

    case 'worktree':
      // Stubbed for Demo 4 — git worktree materialisation arrives in Demo 10.
      workspacePath = path.join(
        os.homedir(),
        '.squadboard',
        'worktrees',
        issueRunId,
      );
      break;

    default:
      throw new Error(`Unknown workspace strategy: ${strategy as string}`);
  }

  await mkdir(workspacePath, { recursive: true });
  return workspacePath;
}

/**
 * Remove the workspace directory after a run finishes.
 * For 'worktree', removal is a no-op until Demo 10 implements the real teardown.
 */
export async function cleanupWorkspace(
  workspacePath: string,
  strategy: WorkspaceStrategy,
): Promise<void> {
  if (strategy === 'worktree') {
    // Stub: real git worktree remove lands in Demo 10.
    return;
  }
  await rm(workspacePath, { recursive: true, force: true });
}
