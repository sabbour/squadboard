/**
 * github/sync.ts — Demo 15: per-project GitHub sync engine.
 *
 * GitHubSync handles push (local → GitHub) and pull (GitHub → local) for issues
 * and comments. Conflict resolution uses last-write-wins by updatedAt.
 */
import { GitHubClient, type GitHubIssue } from './client.js';
export interface LocalIssue {
    id: string;
    projectId: string;
    title: string;
    body: string | null;
    status: string;
    githubIssueNumber: number | null;
    githubIssueUrl: string | null;
    githubNodeId: string | null;
    updatedAt: Date;
}
export interface LocalComment {
    id: string;
    issueId: string;
    body: string;
    githubCommentId: string | null;
    updatedAt: Date;
}
export declare class GitHubSync {
    private readonly projectId;
    private client;
    constructor(projectId: string, client: GitHubClient);
    /**
     * Build a GitHubSync from a stored project row.
     * Picks PAT or App auth based on githubAuthType (null → 'pat').
     */
    static fromProject(projectId: string, project: {
        githubAuthType?: string | null;
        githubToken?: string | null;
        githubOwner: string | null;
        githubRepo: string | null;
        githubAppId?: string | null;
        githubAppInstallationId?: string | null;
        githubAppPrivateKey?: string | null;
    }): Promise<GitHubSync>;
    /**
     * Push a local issue to GitHub.
     * - If the issue has no githubIssueNumber → create a new GitHub issue.
     * - If it already has one → update the existing GitHub issue.
     * Upserts githubIssueNumber, githubIssueUrl, githubNodeId onto the local row.
     */
    pushIssue(issue: LocalIssue): Promise<void>;
    /**
     * Mirror a local comment to GitHub.
     * If the comment already has a githubCommentId → skip (immutable once posted).
     * Otherwise post a new comment and store the ID.
     */
    pushComment(comment: LocalComment, githubIssueNumber: number): Promise<void>;
    /**
     * Pull GitHub issues updated since `since` and apply to local DB.
     * Uses last-write-wins conflict resolution (resolveConflict).
     * Updates githubSyncLastAt on the project after a successful pull.
     */
    pullChanges(since?: string): Promise<void>;
    /**
     * Last-write-wins conflict resolution by updatedAt.
     * Returns 'local' if local is newer (or equal), 'github' if GitHub is newer.
     */
    resolveConflict(localIssue: LocalIssue, ghIssue: GitHubIssue): 'local' | 'github';
    /**
     * Push all active (non-archived) issues to GitHub.
     * Used for a full manual sync trigger.
     */
    pushAllIssues(): Promise<{
        pushed: number;
        errors: number;
    }>;
}
/**
 * Start a periodic pull loop for a project.
 * Reads full project config from DB on each tick (supports PAT and App auth).
 * Returns the interval handle (also stored in activeSyncLoops map).
 */
export declare function startSyncLoop(projectId: string, intervalMs?: number): ReturnType<typeof setInterval>;
/** Stop an active sync loop for a project. */
export declare function stopSyncLoop(projectId: string): void;
/** Stop all active sync loops (called on graceful shutdown). */
export declare function stopAllSyncLoops(): void;
//# sourceMappingURL=sync.d.ts.map