/**
 * github/client.ts — Demo 15: thin GitHub REST API wrapper.
 *
 * Supports two auth modes:
 *   - PAT  — GitHubClient.fromPat(token, owner, repo)
 *   - App  — GitHubClient.fromApp(appId, installationId, privateKey, owner, repo)
 *
 * Uses native fetch + jose (RS256 JWT) only — no Octokit.
 * Throws GitHubSyncError on any non-2xx response.
 */
export declare class GitHubSyncError extends Error {
    readonly status: number;
    readonly ghMessage: string;
    constructor(message: string, status: number, ghMessage: string);
}
export interface GitHubIssueRef {
    number: number;
    url: string;
    nodeId: string;
}
export interface GitHubIssue {
    number: number;
    title: string;
    body: string | null;
    state: 'open' | 'closed';
    labels: Array<{
        name: string;
    }>;
    html_url: string;
    node_id: string;
    updated_at: string;
    created_at: string;
}
export interface GitHubComment {
    id: number;
    body: string;
    html_url: string;
    created_at: string;
}
export declare class GitHubClient {
    private readonly token;
    private readonly owner;
    private readonly repo;
    private readonly base;
    private readonly headers;
    constructor(token: string, owner: string, repo: string);
    static fromPat(token: string, owner: string, repo: string): GitHubClient;
    /**
     * Generates a GitHub App JWT, exchanges it for an installation access token
     * (cached in-memory, invalidated 60 s before expiry), and returns a client
     * that uses that token as the Bearer credential.
     */
    static fromApp(appId: string, installationId: string, privateKey: string, owner: string, repo: string): Promise<GitHubClient>;
    /**
     * Returns a cached installation token, refreshing it if it is absent or
     * expiring within 60 seconds.
     */
    private static getInstallationToken;
    /**
     * Generates a fresh GitHub App JWT, calls the installation access-tokens
     * endpoint, caches the result, and returns the token string.
     */
    private static refreshInstallationToken;
    /**
     * Generates a short-lived RS256 JWT for authenticating as the GitHub App.
     * Payload: iat=now-60, exp=now+600, iss=appId (10-minute window).
     */
    private static generateAppJwt;
    private request;
    /** Create a new issue. Returns number, html_url, node_id. */
    createIssue(title: string, body: string, labels?: string[]): Promise<GitHubIssueRef>;
    /** Update an existing issue (partial). Returns full updated issue. */
    updateIssue(number: number, patch: {
        title?: string;
        body?: string;
        state?: 'open' | 'closed';
        labels?: string[];
    }): Promise<GitHubIssue>;
    /** Close an issue (convenience wrapper around updateIssue). */
    closeIssue(number: number): Promise<GitHubIssue>;
    /** Post a comment on an issue. */
    addComment(number: number, body: string): Promise<GitHubComment>;
    /**
     * List issues updated since a given ISO timestamp.
     * Returns up to 100 per page (sufficient for polling loop cadence).
     */
    listIssues(since?: string): Promise<GitHubIssue[]>;
    /** Get a ref (branch). Returns sha or null if branch doesn't exist. */
    getRef(ref: string): Promise<string | null>;
    /** Get default branch SHA (to branch from). */
    getDefaultBranchSha(): Promise<{
        sha: string;
        branch: string;
    }>;
    /**
     * Create or update a branch (idempotent).
     * If the branch already exists at the given sha, this is a no-op.
     */
    createOrUpdateBranch(branchName: string, sha: string): Promise<void>;
    /** Open a pull request. Returns PR number and html_url. */
    createPullRequest(title: string, body: string, head: string, base: string): Promise<{
        number: number;
        url: string;
    }>;
    /**
     * Post a GitHub check run for a workflow completion.
     * Requires the `checks:write` permission on the PAT (fine-grained) or the
     * `repo` + `workflow` scopes (classic).
     */
    createCheckRun(params: {
        name: string;
        headSha: string;
        status: 'completed';
        conclusion: 'success' | 'failure' | 'cancelled' | 'skipped';
        title: string;
        summary: string;
        startedAt: string;
        completedAt: string;
    }): Promise<{
        id: number;
    }>;
}
//# sourceMappingURL=client.d.ts.map