import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { eventBus } from '../realtime/event-bus.js';
import { GitHubClient, type GitHubIssue } from './client.js';
import {
  enqueueIssueEntryWorkflows,
  projectSettingKey,
  resolveIssueColumnForProject,
  syncIssueLabels,
} from '../intake/source-intake.js';

export { projectSettingKey } from '../intake/source-intake.js';

export const GITHUB_ISSUE_INTAKE_CONTRACT_VERSION = 'squadboard.github-issue-intake.v1';

type IssueState = 'open' | 'closed' | 'all';

export interface GitHubIssueIntakeConfig {
  contractVersion?: string;
  owner?: string;
  repo?: string;
  htmlUrl?: string;
  state?: IssueState;
  excludePullRequests?: boolean;
  targetColumn?: string;
  triageCeremonyId?: string;
}

export interface GitHubIssueIntakeResult {
  owner: string;
  repo: string;
  since: string | null;
  fetched: number;
  created: number;
  updated: number;
  skipped: number;
  workflowsStarted: number;
  errors: number;
  cursor: string;
  issueIds: string[];
}

export interface GitHubIssueIntakeRunOptions {
  projectId: string;
  triggerConfig?: Record<string, unknown> | null;
  scheduleId?: string;
  client?: Pick<GitHubClient, 'listIssues'>;
  now?: Date;
}

interface ResolvedConfig {
  owner: string;
  repo: string;
  state: IssueState;
  excludePullRequests: boolean;
  targetColumn: string;
  triageCeremonyId?: string;
}

interface UpsertOutcome {
  kind: 'created' | 'updated' | 'skipped';
  issueId?: string;
  labelNames: string[];
  shouldTriage: boolean;
}

export function isGitHubIssueIntakeConfig(config: unknown): boolean {
  if (!config || typeof config !== 'object') return false;
  const c = config as Record<string, unknown>;
  return c['contractVersion'] === GITHUB_ISSUE_INTAKE_CONTRACT_VERSION;
}

export async function runGitHubIssueIntake(
  options: GitHubIssueIntakeRunOptions,
): Promise<GitHubIssueIntakeResult> {
  const db = getDb();
  const [project] = await db
    .select({
      id: schema.projects.id,
      githubOwner: schema.projects.githubOwner,
      githubRepo: schema.projects.githubRepo,
      githubSyncLastAt: schema.projects.githubSyncLastAt,
      githubAuthType: schema.projects.githubAuthType,
      githubToken: schema.projects.githubToken,
      githubAppId: schema.projects.githubAppId,
      githubAppInstallationId: schema.projects.githubAppInstallationId,
      githubAppPrivateKey: schema.projects.githubAppPrivateKey,
    })
    .from(schema.projects)
    .where(eq(schema.projects.id, options.projectId))
    .limit(1);

  if (!project) {
    throw new Error(`project ${options.projectId} not found for GitHub issue intake`);
  }

  const config = resolveConfig(
    await loadStoredConfig(options.projectId),
    options.triggerConfig,
    {
      owner: project.githubOwner ?? undefined,
      repo: project.githubRepo ?? undefined,
    },
  );

  const since = project.githubSyncLastAt?.toISOString() ?? null;
  const now = options.now ?? new Date();
  const result: GitHubIssueIntakeResult = {
    owner: config.owner,
    repo: config.repo,
    since,
    fetched: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    workflowsStarted: 0,
    errors: 0,
    cursor: now.toISOString(),
    issueIds: [],
  };

  const client = options.client ?? await buildClient(project, config.owner, config.repo);
  const ghIssues = await client.listIssues(since ?? undefined, { state: config.state });
  result.fetched = ghIssues.length;

  for (const ghIssue of ghIssues) {
    if (config.excludePullRequests && ghIssue.pull_request) {
      result.skipped += 1;
      continue;
    }

    try {
      const outcome = await upsertGitHubIssue(options.projectId, config, ghIssue);
      if (outcome.kind === 'created') result.created += 1;
      else if (outcome.kind === 'updated') result.updated += 1;
      else result.skipped += 1;

      if (outcome.issueId) result.issueIds.push(outcome.issueId);
      if (outcome.issueId && outcome.shouldTriage) {
        result.workflowsStarted += await enqueueIssueEntryWorkflows({
          projectId: options.projectId,
          issueId: outcome.issueId,
          column: resolveIssueColumn(config, ghIssue),
          labelNames: outcome.labelNames,
          preferredWorkflowSlug: config.triageCeremonyId,
          trigger: {
            kind: 'github',
            detail: 'github_issue_intake',
            action: outcome.kind,
            scheduleId: options.scheduleId,
            anchorIssueId: outcome.issueId,
            projectId: options.projectId,
          },
        });
      }
    } catch (err) {
      result.errors += 1;
      console.error(
        `[github-issue-intake] failed to ingest ${config.owner}/${config.repo}#${ghIssue.number}:`,
        err,
      );
    }
  }

  const projectPatch: Partial<typeof schema.projects.$inferInsert> = {
    githubOwner: config.owner,
    githubRepo: config.repo,
    updatedAt: new Date(),
  };
  if (result.errors === 0) {
    projectPatch.githubSyncLastAt = now;
  } else {
    result.cursor = since ?? '';
    console.warn(
      `[github-issue-intake] leaving cursor unchanged for ${config.owner}/${config.repo} ` +
      `because ${result.errors} issue(s) failed`,
    );
  }

  await db
    .update(schema.projects)
    .set(projectPatch)
    .where(eq(schema.projects.id, options.projectId));

  return result;
}

async function buildClient(
  project: {
    githubAuthType: string | null;
    githubToken: string | null;
    githubAppId: string | null;
    githubAppInstallationId: string | null;
    githubAppPrivateKey: string | null;
  },
  owner: string,
  repo: string,
): Promise<GitHubClient> {
  const authType = project.githubAuthType ?? (project.githubToken ? 'pat' : 'public');
  if (authType === 'app') {
    if (!project.githubAppId || !project.githubAppInstallationId || !project.githubAppPrivateKey) {
      throw new Error('GitHub App auth is incomplete for issue intake');
    }
    return GitHubClient.fromApp(
      project.githubAppId,
      project.githubAppInstallationId,
      project.githubAppPrivateKey,
      owner,
      repo,
    );
  }
  if (project.githubToken) return GitHubClient.fromPat(project.githubToken, owner, repo);
  return GitHubClient.fromPublic(owner, repo);
}

async function upsertGitHubIssue(
  projectId: string,
  config: ResolvedConfig,
  ghIssue: GitHubIssue,
): Promise<UpsertOutcome> {
  const db = getDb();
  const idempotencyKey = githubIssueIdempotencyKey(config.owner, config.repo, ghIssue.number);
  const labelNames = uniqueLabelNames(ghIssue);
  const status = await resolveIssueColumnForProject(projectId, resolveIssueColumn(config, ghIssue));
  const ghUpdatedAt = new Date(ghIssue.updated_at);

  const [existing] = await db
    .select()
    .from(schema.issues)
    .where(
      and(
        eq(schema.issues.projectId, projectId),
        or(
          eq(schema.issues.idempotencyKey, idempotencyKey),
          eq(schema.issues.githubNodeId, ghIssue.node_id),
          eq(schema.issues.githubIssueNumber, ghIssue.number),
        ),
      ),
    )
    .limit(1);

  if (!existing) {
    const [maxRow] = await db
      .select({ maxPos: sql<number>`COALESCE(MAX(${schema.issues.position}), -1)` })
      .from(schema.issues)
      .where(and(
        eq(schema.issues.projectId, projectId),
        eq(schema.issues.status, status),
        eq(schema.issues.archived, 0),
      ));

    const [created] = await db
      .insert(schema.issues)
      .values({
        projectId,
        title: ghIssue.title,
        body: ghIssue.body ?? '',
        status,
        position: (maxRow?.maxPos ?? -1) + 1,
        githubIssueNumber: ghIssue.number,
        githubIssueUrl: ghIssue.html_url,
        githubNodeId: ghIssue.node_id,
        idempotencyKey,
        createdBy: 'github-intake',
        completedAt: ghIssue.state === 'closed' ? new Date() : null,
        createdAt: new Date(ghIssue.created_at),
        updatedAt: ghUpdatedAt,
      })
      .returning();

    await syncIssueLabels(projectId, created.id, labelNames);
    eventBus.emitIssueEvent('issue.created', projectId, { issue: created, source: 'github-issue-intake' });
    return {
      kind: 'created',
      issueId: created.id,
      labelNames,
      shouldTriage: ghIssue.state === 'open',
    };
  }

  const ghIsNewer = ghUpdatedAt.getTime() > new Date(existing.updatedAt).getTime();
  const identityPatchNeeded =
    existing.githubIssueUrl !== ghIssue.html_url ||
    existing.githubNodeId !== ghIssue.node_id ||
    existing.idempotencyKey !== idempotencyKey;

  if (!ghIsNewer && !identityPatchNeeded) {
    await syncIssueLabels(projectId, existing.id, labelNames);
    return { kind: 'skipped', issueId: existing.id, labelNames, shouldTriage: false };
  }

  const [updated] = await db
    .update(schema.issues)
    .set({
      title: ghIssue.title,
      body: ghIssue.body ?? '',
      status,
      githubIssueNumber: ghIssue.number,
      githubIssueUrl: ghIssue.html_url,
      githubNodeId: ghIssue.node_id,
      idempotencyKey,
      completedAt: ghIssue.state === 'closed' ? (existing.completedAt ?? new Date()) : null,
      updatedAt: ghUpdatedAt,
    })
    .where(eq(schema.issues.id, existing.id))
    .returning();

  await syncIssueLabels(projectId, existing.id, labelNames);
  eventBus.emitIssueEvent('issue.updated', projectId, { issue: updated, source: 'github-issue-intake' });
  return {
    kind: 'updated',
    issueId: existing.id,
    labelNames,
    shouldTriage: ghIssue.state === 'open',
  };
}

function resolveIssueColumn(config: ResolvedConfig, ghIssue: GitHubIssue): string {
  if (ghIssue.state === 'closed') return 'done';
  return config.targetColumn;
}

async function loadStoredConfig(projectId: string): Promise<Record<string, unknown> | null> {
  const db = getDb();
  const keys = [
    projectSettingKey(projectId, 'githubIssueIntake'),
    'githubIssueIntake',
  ];
  const rows = await db
    .select({ value: schema.settings.value })
    .from(schema.settings)
    .where(inArray(schema.settings.key, keys))
    .limit(1);
  const raw = rows[0]?.value;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function resolveConfig(
  stored: Record<string, unknown> | null,
  triggerConfig: Record<string, unknown> | null | undefined,
  fallback: { owner?: string; repo?: string },
): ResolvedConfig {
  const merged = {
    ...(stored ?? {}),
    ...(triggerConfig ?? {}),
  };
  const parsedUrl = parseGitHubRepoUrl(stringValue(merged['htmlUrl']));
  const owner = stringValue(merged['owner']) ?? parsedUrl?.owner ?? fallback.owner;
  const repo = stringValue(merged['repo']) ?? parsedUrl?.repo ?? fallback.repo;
  if (!owner || !repo) {
    throw new Error('GitHub issue intake requires owner and repo');
  }

  const stateValue = stringValue(merged['state']);
  const state: IssueState = stateValue === 'closed' || stateValue === 'all' ? stateValue : 'open';

  return {
    owner,
    repo,
    state,
    excludePullRequests: booleanValue(merged['excludePullRequests'], true),
    targetColumn: stringValue(merged['targetColumn']) ?? stringValue(merged['column']) ?? 'triage',
    triageCeremonyId: stringValue(merged['triageCeremonyId']),
  };
}

function parseGitHubRepoUrl(url: string | undefined): { owner: string; repo: string } | null {
  if (!url) return null;
  const match = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/#?]+)(?:[/?#].*)?$/i);
  if (!match) return null;
  return { owner: match[1], repo: match[2].replace(/\.git$/i, '') };
}

function githubIssueIdempotencyKey(owner: string, repo: string, issueNumber: number): string {
  return `github:${owner.toLowerCase()}/${repo.toLowerCase()}#${issueNumber}`;
}

function uniqueLabelNames(ghIssue: GitHubIssue): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const label of ghIssue.labels ?? []) {
    const name = label.name?.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}
