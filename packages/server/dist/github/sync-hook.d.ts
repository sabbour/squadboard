/**
 * github/sync-hook.ts — Demo 15: event-bus listeners for GitHub sync.
 *
 * Listens to issue.created / issue.updated / issue.deleted and comment events.
 * If the project has githubSyncEnabled=true, calls GitHubSync fire-and-forget.
 * All errors are logged to github_sync_log — never thrown to the caller.
 */
/**
 * Ingest a raw GitHub webhook payload (issues event).
 * Creates or updates the local issue row, maintaining cursor idempotency via
 * githubIssueNumber uniqueness per project.
 */
export declare function ingestWebhookIssue(projectId: string, action: string, ghIssue: {
    number: number;
    title: string;
    body: string | null;
    state: string;
    html_url: string;
    node_id: string;
    updated_at: string;
}): Promise<void>;
/**
 * Register all GitHub sync event bus listeners.
 * Called once from index.ts on startup.
 */
export declare function initGitHubSyncHooks(): void;
//# sourceMappingURL=sync-hook.d.ts.map