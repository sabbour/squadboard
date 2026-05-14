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

import { SignJWT, importPKCS8 } from 'jose';

// ─── Error type ─────────────────────────────────────────────────────────────

export class GitHubSyncError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly ghMessage: string,
  ) {
    super(message);
    this.name = 'GitHubSyncError';
  }
}

// ─── Response shapes ─────────────────────────────────────────────────────────

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
  labels: Array<{ name: string }>;
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

// ─── Installation token cache ─────────────────────────────────────────────────

interface CachedToken {
  token: string;
  expiresAt: number; // Unix ms
}

const installationTokenCache = new Map<string, CachedToken>();

// ─── Client ──────────────────────────────────────────────────────────────────

export class GitHubClient {
  private readonly base: string;
  private readonly headers: Record<string, string>;

  constructor(
    private readonly token: string,
    private readonly owner: string,
    private readonly repo: string,
  ) {
    this.base = `https://api.github.com/repos/${owner}/${repo}`;
    this.headers = {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      'User-Agent': 'Squadboard/0.1.0',
    };
  }

  // ── Factory: PAT auth ──────────────────────────────────────────────────────

  static fromPat(token: string, owner: string, repo: string): GitHubClient {
    return new GitHubClient(token, owner, repo);
  }

  // ── Factory: GitHub App auth ───────────────────────────────────────────────

  /**
   * Generates a GitHub App JWT, exchanges it for an installation access token
   * (cached in-memory, invalidated 60 s before expiry), and returns a client
   * that uses that token as the Bearer credential.
   */
  static async fromApp(
    appId: string,
    installationId: string,
    privateKey: string,
    owner: string,
    repo: string,
  ): Promise<GitHubClient> {
    const token = await GitHubClient.getInstallationToken(appId, installationId, privateKey);
    return new GitHubClient(token, owner, repo);
  }

  // ── Private: installation token lifecycle ──────────────────────────────────

  /**
   * Returns a cached installation token, refreshing it if it is absent or
   * expiring within 60 seconds.
   */
  private static async getInstallationToken(
    appId: string,
    installationId: string,
    privateKey: string,
  ): Promise<string> {
    const cacheKey = `${appId}:${installationId}`;
    const cached = installationTokenCache.get(cacheKey);
    const nowMs = Date.now();
    const bufferMs = 60_000;

    if (cached && cached.expiresAt - bufferMs > nowMs) {
      return cached.token;
    }

    return GitHubClient.refreshInstallationToken(appId, installationId, privateKey);
  }

  /**
   * Generates a fresh GitHub App JWT, calls the installation access-tokens
   * endpoint, caches the result, and returns the token string.
   */
  private static async refreshInstallationToken(
    appId: string,
    installationId: string,
    privateKey: string,
  ): Promise<string> {
    const jwt = await GitHubClient.generateAppJwt(appId, privateKey);

    const url = `https://api.github.com/app/installations/${installationId}/access_tokens`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${jwt}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        'User-Agent': 'Squadboard/0.1.0',
      },
    });

    if (!res.ok) {
      let ghMessage = res.statusText;
      try {
        const json = (await res.json()) as { message?: string };
        if (json.message) ghMessage = json.message;
      } catch { /* ignore */ }
      throw new GitHubSyncError(
        `GitHub App token exchange failed ${res.status}: ${ghMessage}`,
        res.status,
        ghMessage,
      );
    }

    const body = (await res.json()) as { token: string; expires_at: string };
    const expiresAt = new Date(body.expires_at).getTime();

    const cacheKey = `${appId}:${installationId}`;
    installationTokenCache.set(cacheKey, { token: body.token, expiresAt });

    return body.token;
  }

  /**
   * Generates a short-lived RS256 JWT for authenticating as the GitHub App.
   * Payload: iat=now-60, exp=now+600, iss=appId (10-minute window).
   */
  private static async generateAppJwt(appId: string, privateKeyPem: string): Promise<string> {
    const key = await importPKCS8(privateKeyPem, 'RS256');
    const nowSec = Math.floor(Date.now() / 1000);

    return new SignJWT({ iss: appId })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
      .setIssuedAt(nowSec - 60)
      .setExpirationTime(nowSec + 600)
      .sign(key);
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = path.startsWith('https://') ? path : `${this.base}${path}`;

    const res = await fetch(url, {
      method,
      headers: this.headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    // Handle rate limiting — surface Retry-After in the error
    if (res.status === 429) {
      const retryAfter = res.headers.get('Retry-After') ?? '60';
      throw new GitHubSyncError(
        `GitHub rate limit hit; retry after ${retryAfter}s`,
        429,
        `Retry-After: ${retryAfter}`,
      );
    }

    if (!res.ok) {
      let ghMessage = res.statusText;
      try {
        const json = (await res.json()) as { message?: string };
        if (json.message) ghMessage = json.message;
      } catch {
        // ignore parse error — statusText is sufficient
      }
      throw new GitHubSyncError(
        `GitHub API error ${res.status}: ${ghMessage}`,
        res.status,
        ghMessage,
      );
    }

    // 204 No Content — return empty object
    if (res.status === 204) return {} as T;

    return res.json() as Promise<T>;
  }

  // ── Issue methods ──────────────────────────────────────────────────────────

  /** Create a new issue. Returns number, html_url, node_id. */
  async createIssue(
    title: string,
    body: string,
    labels?: string[],
  ): Promise<GitHubIssueRef> {
    const issue = await this.request<GitHubIssue>('POST', '/issues', {
      title,
      body,
      labels,
    });
    return { number: issue.number, url: issue.html_url, nodeId: issue.node_id };
  }

  /** Update an existing issue (partial). Returns full updated issue. */
  async updateIssue(
    number: number,
    patch: {
      title?: string;
      body?: string;
      state?: 'open' | 'closed';
      labels?: string[];
    },
  ): Promise<GitHubIssue> {
    return this.request<GitHubIssue>('PATCH', `/issues/${number}`, patch);
  }

  /** Close an issue (convenience wrapper around updateIssue). */
  async closeIssue(number: number): Promise<GitHubIssue> {
    return this.updateIssue(number, { state: 'closed' });
  }

  /** Post a comment on an issue. */
  async addComment(number: number, body: string): Promise<GitHubComment> {
    return this.request<GitHubComment>('POST', `/issues/${number}/comments`, { body });
  }

  /**
   * List issues updated since a given ISO timestamp.
   * Returns up to 100 per page (sufficient for polling loop cadence).
   */
  async listIssues(since?: string): Promise<GitHubIssue[]> {
    const params = new URLSearchParams({ state: 'all', per_page: '100', sort: 'updated', direction: 'desc' });
    if (since) params.set('since', since);
    return this.request<GitHubIssue[]>('GET', `/issues?${params.toString()}`);
  }

  // ── Branch + PR + Check-run methods (Demo 15 advanced) ────────────────────

  /** Get a ref (branch). Returns sha or null if branch doesn't exist. */
  async getRef(ref: string): Promise<string | null> {
    try {
      const data = await this.request<{ object: { sha: string } }>('GET', `/git/ref/heads/${ref}`);
      return data.object.sha;
    } catch (err) {
      if (err instanceof GitHubSyncError && err.status === 404) return null;
      throw err;
    }
  }

  /** Get default branch SHA (to branch from). */
  async getDefaultBranchSha(): Promise<{ sha: string; branch: string }> {
    const repo = await this.request<{ default_branch: string }>('GET', '');
    const branch = repo.default_branch;
    const ref = await this.request<{ object: { sha: string } }>(
      'GET',
      `/git/ref/heads/${branch}`,
    );
    return { sha: ref.object.sha, branch };
  }

  /**
   * Create or update a branch (idempotent).
   * If the branch already exists at the given sha, this is a no-op.
   */
  async createOrUpdateBranch(branchName: string, sha: string): Promise<void> {
    const existing = await this.getRef(branchName);
    if (existing === sha) return; // already at correct sha
    if (existing) {
      // Update existing ref
      await this.request('PATCH', `/git/refs/heads/${branchName}`, { sha, force: true });
    } else {
      // Create new ref
      await this.request('POST', '/git/refs', { ref: `refs/heads/${branchName}`, sha });
    }
  }

  /** Open a pull request. Returns PR number and html_url. */
  async createPullRequest(
    title: string,
    body: string,
    head: string,
    base: string,
  ): Promise<{ number: number; url: string }> {
    const pr = await this.request<{ number: number; html_url: string }>(
      'POST',
      '/pulls',
      { title, body, head, base },
    );
    return { number: pr.number, url: pr.html_url };
  }

  /**
   * Post a GitHub check run for a workflow completion.
   * Requires the `checks:write` permission on the PAT (fine-grained) or the
   * `repo` + `workflow` scopes (classic).
   */
  async createCheckRun(params: {
    name: string;
    headSha: string;
    status: 'completed';
    conclusion: 'success' | 'failure' | 'cancelled' | 'skipped';
    title: string;
    summary: string;
    startedAt: string;
    completedAt: string;
  }): Promise<{ id: number }> {
    return this.request<{ id: number }>('POST', '/check-runs', {
      name: params.name,
      head_sha: params.headSha,
      status: params.status,
      conclusion: params.conclusion,
      started_at: params.startedAt,
      completed_at: params.completedAt,
      output: { title: params.title, summary: params.summary },
    });
  }
}


// ─── Response shapes ─────────────────────────────────────────────────────────

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
  labels: Array<{ name: string }>;
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

// ─── Client ──────────────────────────────────────────────────────────────────

export class GitHubClient {
  private readonly base: string;
  private readonly headers: Record<string, string>;

  constructor(
    private readonly token: string,
    private readonly owner: string,
    private readonly repo: string,
  ) {
    this.base = `https://api.github.com/repos/${owner}/${repo}`;
    this.headers = {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      'User-Agent': 'Squadboard/0.1.0',
    };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = path.startsWith('https://') ? path : `${this.base}${path}`;

    const res = await fetch(url, {
      method,
      headers: this.headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    // Handle rate limiting — surface Retry-After in the error
    if (res.status === 429) {
      const retryAfter = res.headers.get('Retry-After') ?? '60';
      throw new GitHubSyncError(
        `GitHub rate limit hit; retry after ${retryAfter}s`,
        429,
        `Retry-After: ${retryAfter}`,
      );
    }

    if (!res.ok) {
      let ghMessage = res.statusText;
      try {
        const json = (await res.json()) as { message?: string };
        if (json.message) ghMessage = json.message;
      } catch {
        // ignore parse error — statusText is sufficient
      }
      throw new GitHubSyncError(
        `GitHub API error ${res.status}: ${ghMessage}`,
        res.status,
        ghMessage,
      );
    }

    // 204 No Content — return empty object
    if (res.status === 204) return {} as T;

    return res.json() as Promise<T>;
  }

  // ── Issue methods ──────────────────────────────────────────────────────────

  /** Create a new issue. Returns number, html_url, node_id. */
  async createIssue(
    title: string,
    body: string,
    labels?: string[],
  ): Promise<GitHubIssueRef> {
    const issue = await this.request<GitHubIssue>('POST', '/issues', {
      title,
      body,
      labels,
    });
    return { number: issue.number, url: issue.html_url, nodeId: issue.node_id };
  }

  /** Update an existing issue (partial). Returns full updated issue. */
  async updateIssue(
    number: number,
    patch: {
      title?: string;
      body?: string;
      state?: 'open' | 'closed';
      labels?: string[];
    },
  ): Promise<GitHubIssue> {
    return this.request<GitHubIssue>('PATCH', `/issues/${number}`, patch);
  }

  /** Close an issue (convenience wrapper around updateIssue). */
  async closeIssue(number: number): Promise<GitHubIssue> {
    return this.updateIssue(number, { state: 'closed' });
  }

  /** Post a comment on an issue. */
  async addComment(number: number, body: string): Promise<GitHubComment> {
    return this.request<GitHubComment>('POST', `/issues/${number}/comments`, { body });
  }

  /**
   * List issues updated since a given ISO timestamp.
   * Returns up to 100 per page (sufficient for polling loop cadence).
   */
  async listIssues(since?: string): Promise<GitHubIssue[]> {
    const params = new URLSearchParams({ state: 'all', per_page: '100', sort: 'updated', direction: 'desc' });
    if (since) params.set('since', since);
    return this.request<GitHubIssue[]>('GET', `/issues?${params.toString()}`);
  }

  // ── Branch + PR + Check-run methods (Demo 15 advanced) ────────────────────

  /** Get a ref (branch). Returns sha or null if branch doesn't exist. */
  async getRef(ref: string): Promise<string | null> {
    try {
      const data = await this.request<{ object: { sha: string } }>('GET', `/git/ref/heads/${ref}`);
      return data.object.sha;
    } catch (err) {
      if (err instanceof GitHubSyncError && err.status === 404) return null;
      throw err;
    }
  }

  /** Get default branch SHA (to branch from). */
  async getDefaultBranchSha(): Promise<{ sha: string; branch: string }> {
    const repo = await this.request<{ default_branch: string }>('GET', '');
    const branch = repo.default_branch;
    const ref = await this.request<{ object: { sha: string } }>(
      'GET',
      `/git/ref/heads/${branch}`,
    );
    return { sha: ref.object.sha, branch };
  }

  /**
   * Create or update a branch (idempotent).
   * If the branch already exists at the given sha, this is a no-op.
   */
  async createOrUpdateBranch(branchName: string, sha: string): Promise<void> {
    const existing = await this.getRef(branchName);
    if (existing === sha) return; // already at correct sha
    if (existing) {
      // Update existing ref
      await this.request('PATCH', `/git/refs/heads/${branchName}`, { sha, force: true });
    } else {
      // Create new ref
      await this.request('POST', '/git/refs', { ref: `refs/heads/${branchName}`, sha });
    }
  }

  /** Open a pull request. Returns PR number and html_url. */
  async createPullRequest(
    title: string,
    body: string,
    head: string,
    base: string,
  ): Promise<{ number: number; url: string }> {
    const pr = await this.request<{ number: number; html_url: string }>(
      'POST',
      '/pulls',
      { title, body, head, base },
    );
    return { number: pr.number, url: pr.html_url };
  }

  /**
   * Post a GitHub check run for a workflow completion.
   * Requires the `checks:write` permission on the PAT (fine-grained) or the
   * `repo` + `workflow` scopes (classic).
   */
  async createCheckRun(params: {
    name: string;
    headSha: string;
    status: 'completed';
    conclusion: 'success' | 'failure' | 'cancelled' | 'skipped';
    title: string;
    summary: string;
    startedAt: string;
    completedAt: string;
  }): Promise<{ id: number }> {
    return this.request<{ id: number }>('POST', '/check-runs', {
      name: params.name,
      head_sha: params.headSha,
      status: params.status,
      conclusion: params.conclusion,
      started_at: params.startedAt,
      completed_at: params.completedAt,
      output: { title: params.title, summary: params.summary },
    });
  }
}
