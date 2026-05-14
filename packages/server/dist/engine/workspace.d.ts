export type WorkspaceStrategy = 'scratch' | 'dir' | 'worktree';
/**
 * Resolve (and create) the workspace directory for a run.
 *
 * scratch  → OS temp dir   : <tmpdir>/squadboard-run-<id>
 * dir      → home dir      : ~/.squadboard/workspaces/<id>
 * worktree → git worktree  : stubbed for Demo 4
 */
export declare function resolveWorkspace(issueRunId: string, strategy: WorkspaceStrategy): Promise<string>;
/**
 * Remove the workspace directory after a run finishes.
 * For 'worktree', removal is a no-op until Demo 10 implements the real teardown.
 */
export declare function cleanupWorkspace(workspacePath: string, strategy: WorkspaceStrategy): Promise<void>;
//# sourceMappingURL=workspace.d.ts.map