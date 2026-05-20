import { eq } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { GitHubClient, type GitHubCommitSummary, type GitHubTreeEntry } from './client.js';
import {
  enqueueIssueEntryWorkflows,
  projectSettingKey,
  readJsonSetting,
  readSourceCursor,
  stableSourceKey,
  startWorkflowForIssue,
  upsertSourceIssue,
  writeSourceCursor,
} from '../intake/source-intake.js';
import type { TriggerSource } from '../engine/workflow-runner.js';

export const DOC_REVIEW_INTAKE_CONTRACT_VERSION = 'squadboard.doc-review-intake.v1';

interface DocReviewIntakeConfig {
  contractVersion?: string;
  owner?: string;
  repo?: string;
  htmlUrl?: string;
  ref?: string;
  includePaths?: unknown;
  reviewProfiles?: unknown;
  reviewProfileVersion?: string;
  staleThresholdDays?: unknown;
  targetColumn?: string;
  triageCeremonyId?: string;
  triageStages?: unknown;
  labels?: unknown;
  finalAction?: unknown;
  finalActionPolicy?: unknown;
  source?: unknown;
  triage?: unknown;
  rubric?: unknown;
}

interface ResolvedDocReviewConfig {
  owner: string;
  repo: string;
  ref?: string;
  includePaths: string[];
  reviewProfiles: string[];
  reviewProfileVersion: string;
  staleThresholdDays: number;
  targetColumn: string;
  triageCeremonyId?: string;
  labels: string[];
  finalAction: string;
  autoEditDocs: boolean;
  draftPr: string;
  sourceKeySeed: string;
}

export interface GitHubDocReviewCandidate {
  path: string;
  blobSha: string;
  commitSha?: string;
  htmlUrl?: string;
  updatedAt?: string;
  reason: 'changed' | 'stale' | 'selected' | 'initial';
}

export interface GitHubDocReviewIntakeClient {
  listRepositoryTree(ref?: string): Promise<GitHubTreeEntry[]>;
  listCommitsForPath(path: string, options?: { since?: string; perPage?: number }): Promise<GitHubCommitSummary[]>;
}

export interface GitHubDocReviewIntakeRunOptions {
  projectId: string;
  triggerConfig?: Record<string, unknown> | null;
  scheduleId?: string;
  workflowId?: string;
  manualContext?: Record<string, unknown> | null;
  client?: GitHubDocReviewIntakeClient;
  now?: Date;
}

export interface GitHubDocReviewIntakeResult {
  owner: string;
  repo: string;
  sourceKey: string;
  since: string | null;
  fetched: number;
  candidates: number;
  created: number;
  updated: number;
  skipped: number;
  workflowsStarted: number;
  errors: number;
  cursor: string;
  issueIds: string[];
}

interface SelectedDoc {
  path: string;
  blobSha?: string;
  commitSha?: string;
}

export function isDocReviewIntakeConfig(config: unknown): boolean {
  if (!config || typeof config !== 'object') return false;
  const c = config as Record<string, unknown>;
  return c['contractVersion'] === DOC_REVIEW_INTAKE_CONTRACT_VERSION;
}

export async function runGitHubDocReviewIntake(
  options: GitHubDocReviewIntakeRunOptions,
): Promise<GitHubDocReviewIntakeResult> {
  const db = getDb();
  const [project] = await db
    .select({
      id: schema.projects.id,
      githubOwner: schema.projects.githubOwner,
      githubRepo: schema.projects.githubRepo,
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
    throw new Error(`project ${options.projectId} not found for doc review intake`);
  }

  const config = resolveDocReviewConfig(
    await loadStoredDocReviewConfig(options.projectId),
    options.triggerConfig,
    {
      owner: project.githubOwner ?? undefined,
      repo: project.githubRepo ?? undefined,
    },
  );
  const sourceKey = config.sourceKeySeed;
  const previousCursor = await readSourceCursor(options.projectId, sourceKey);
  const since = previousCursor?.cursor ?? null;
  const now = options.now ?? new Date();
  const selectedDocs = parseSelectedDocs(options.manualContext);

  const result: GitHubDocReviewIntakeResult = {
    owner: config.owner,
    repo: config.repo,
    sourceKey,
    since,
    fetched: 0,
    candidates: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    workflowsStarted: 0,
    errors: 0,
    cursor: now.toISOString(),
    issueIds: [],
  };

  const client = options.client ?? await buildClient(project, config.owner, config.repo);
  const candidates = await enumerateDocCandidates({
    client,
    config,
    since,
    selectedDocs,
    now,
  });
  result.fetched = candidates.fetched;
  result.skipped += candidates.skipped;
  result.candidates = candidates.items.length;

  for (const candidate of candidates.items) {
    try {
      const sourceSha = candidate.blobSha || candidate.commitSha || 'unknown';
      const idempotencyKey = docReviewIdempotencyKey(config, candidate);
      const outcome = await upsertSourceIssue(options.projectId, {
        title: docReviewIssueTitle(candidate.path, config.reviewProfiles),
        body: docReviewIssueBody(config, candidate, idempotencyKey),
        status: config.targetColumn,
        idempotencyKey,
        labels: config.labels,
        createdBy: 'doc-review-intake',
        deliverableType: 'doc',
        deliverableLink: candidate.htmlUrl ?? `https://github.com/${config.owner}/${config.repo}/blob/HEAD/${candidate.path}`,
        deliverableAcceptanceCriteria:
          `Review findings for ${candidate.path} at ${sourceSha} are recorded with severity, owner recommendation, and suggested fix text.`,
        source: 'doc-review-intake',
        updatedAt: now,
      });

      if (outcome.kind === 'created') result.created += 1;
      else if (outcome.kind === 'updated') result.updated += 1;
      else result.skipped += 1;

      result.issueIds.push(outcome.issueId);
      if (outcome.kind === 'created') {
        result.workflowsStarted += await startReviewWorkflow({
          options,
          config,
          issueId: outcome.issueId,
          candidate,
        });
      }
    } catch (err) {
      result.errors += 1;
      console.error(
        `[doc-review-intake] failed to ingest ${config.owner}/${config.repo}:${candidate.path}:`,
        err,
      );
    }
  }

  if (result.errors === 0) {
    await writeSourceCursor(options.projectId, sourceKey, {
      sourceKey,
      cursor: now.toISOString(),
      checkpoint: now.toISOString(),
      lastSuccessfulAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
  } else {
    result.cursor = since ?? '';
    console.warn(
      `[doc-review-intake] leaving cursor unchanged for ${config.owner}/${config.repo} ` +
      `because ${result.errors} doc(s) failed`,
    );
  }

  return result;
}

async function startReviewWorkflow(params: {
  options: GitHubDocReviewIntakeRunOptions;
  config: ResolvedDocReviewConfig;
  issueId: string;
  candidate: GitHubDocReviewCandidate;
}): Promise<number> {
  const trigger: TriggerSource = {
    kind: params.options.scheduleId ? 'on_schedule' : 'manual',
    detail: 'doc_review_intake',
    scheduleId: params.options.scheduleId,
    anchorIssueId: params.issueId,
    projectId: params.options.projectId,
    context: {
      contractVersion: DOC_REVIEW_INTAKE_CONTRACT_VERSION,
      source: 'github-doc',
      owner: params.config.owner,
      repo: params.config.repo,
      path: params.candidate.path,
      blobSha: params.candidate.blobSha,
      commitSha: params.candidate.commitSha,
      sourceSha: params.candidate.blobSha || params.candidate.commitSha,
      reviewProfiles: params.config.reviewProfiles,
      reviewProfileVersion: params.config.reviewProfileVersion,
      finalAction: params.config.finalAction,
      autoEditDocs: params.config.autoEditDocs,
    },
  };

  if (params.options.workflowId) {
    const runId = await startWorkflowForIssue({
      workflowId: params.options.workflowId,
      issueId: params.issueId,
      trigger,
    });
    return runId ? 1 : 0;
  }

  return enqueueIssueEntryWorkflows({
    projectId: params.options.projectId,
    issueId: params.issueId,
    column: params.config.targetColumn,
    labelNames: params.config.labels,
    preferredWorkflowSlug: params.config.triageCeremonyId,
    trigger,
  });
}

async function enumerateDocCandidates(params: {
  client: GitHubDocReviewIntakeClient;
  config: ResolvedDocReviewConfig;
  since: string | null;
  selectedDocs: SelectedDoc[];
  now: Date;
}): Promise<{ fetched: number; skipped: number; items: GitHubDocReviewCandidate[] }> {
  const selectedByPath = new Map(params.selectedDocs.map((doc) => [doc.path, doc]));
  const selectedOnly = selectedByPath.size > 0;
  const tree = await params.client.listRepositoryTree(params.config.ref);
  const docs = tree.filter((entry) => {
    if (entry.type !== 'blob') return false;
    if (selectedOnly) return selectedByPath.has(entry.path);
    return matchesAnyPath(entry.path, params.config.includePaths);
  });
  const seen = new Set<string>();
  const items: GitHubDocReviewCandidate[] = [];
  let skipped = 0;

  for (const entry of docs) {
    seen.add(entry.path);
    const selected = selectedByPath.get(entry.path);
    const candidate = await buildCandidate({
      client: params.client,
      config: params.config,
      entry,
      selected,
      since: params.since,
      now: params.now,
    });
    if (candidate) items.push(candidate);
    else skipped += 1;
  }

  for (const selected of params.selectedDocs) {
    if (seen.has(selected.path) || !selected.blobSha) continue;
    items.push({
      path: selected.path,
      blobSha: selected.blobSha,
      commitSha: selected.commitSha,
      htmlUrl: `https://github.com/${params.config.owner}/${params.config.repo}/blob/HEAD/${selected.path}`,
      reason: 'selected',
    });
  }

  return { fetched: docs.length, skipped, items };
}

async function buildCandidate(params: {
  client: GitHubDocReviewIntakeClient;
  config: ResolvedDocReviewConfig;
  entry: GitHubTreeEntry;
  selected?: SelectedDoc;
  since: string | null;
  now: Date;
}): Promise<GitHubDocReviewCandidate | null> {
  const commits = await params.client.listCommitsForPath(params.entry.path, { perPage: 1 });
  const latest = commits[0];
  const updatedAt = latestCommitDate(latest);
  const staleCutoffMs = params.now.getTime() - params.config.staleThresholdDays * 24 * 60 * 60_000;
  const isInitial = !params.since;
  const isSelected = Boolean(params.selected);
  const isChanged = Boolean(updatedAt && params.since && new Date(updatedAt).getTime() > new Date(params.since).getTime());
  const isStale = Boolean(updatedAt && new Date(updatedAt).getTime() <= staleCutoffMs);

  if (!isInitial && !isSelected && !isChanged && !isStale) return null;

  return {
    path: params.entry.path,
    blobSha: params.selected?.blobSha ?? params.entry.sha,
    commitSha: params.selected?.commitSha ?? latest?.sha,
    htmlUrl: `https://github.com/${params.config.owner}/${params.config.repo}/blob/${latest?.sha ?? 'HEAD'}/${params.entry.path}`,
    updatedAt,
    reason: isSelected ? 'selected' : isInitial ? 'initial' : isChanged ? 'changed' : 'stale',
  };
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
      throw new Error('GitHub App auth is incomplete for doc review intake');
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

async function loadStoredDocReviewConfig(projectId: string): Promise<Record<string, unknown> | null> {
  return readJsonSetting<Record<string, unknown>>([
    projectSettingKey(projectId, 'docReview'),
    'docReview',
  ]);
}

function resolveDocReviewConfig(
  stored: Record<string, unknown> | null,
  triggerConfig: Record<string, unknown> | null | undefined,
  fallback: { owner?: string; repo?: string },
): ResolvedDocReviewConfig {
  const storedConfig = (stored ?? {}) as DocReviewIntakeConfig;
  const trigger = (triggerConfig ?? {}) as DocReviewIntakeConfig;
  const storedSource = objectValue(storedConfig.source);
  const triggerSource = objectValue(trigger.source);
  const source = { ...storedSource, ...triggerSource };
  const merged: Record<string, unknown> = { ...storedConfig, ...trigger, source };
  const parsedUrl = parseGitHubRepoUrl(stringValue(merged['htmlUrl']) ?? stringValue(source['htmlUrl']));
  const owner = stringValue(merged['owner']) ?? stringValue(source['owner']) ?? parsedUrl?.owner ?? fallback.owner;
  const repo = stringValue(merged['repo']) ?? stringValue(source['repo']) ?? parsedUrl?.repo ?? fallback.repo;
  if (!owner || !repo) {
    throw new Error('Doc review intake requires owner and repo');
  }

  const reviewProfiles = nonEmptyArray(
    stringArray(merged['reviewProfiles']),
    ['technical-accuracy', 'reader-success', 'staleness'],
  );
  const rubric = objectValue(merged['rubric']);
  const reviewProfileVersion =
    stringValue(merged['reviewProfileVersion'])
    ?? stringValue(rubric['profile'])
    ?? 'v1';
  const triage = objectValue(merged['triage']);
  const triageStages = stringArray(merged['triageStages']).concat(stringArray(triage['stages']));
  const targetColumn = stringValue(merged['targetColumn']) ?? triageStages[0] ?? 'technical-review';
  const finalActionPolicy = objectValue(merged['finalActionPolicy']);
  const finalActionObject = objectValue(merged['finalAction']);
  const finalAction =
    stringValue(merged['finalAction'])
    ?? stringValue(finalActionObject['kind'])
    ?? 'create-or-update-squadboard-issues';
  const autoEditDocs = booleanValue(
    finalActionPolicy['autoEditDocs'] ?? finalActionObject['autoEditDocs'],
    false,
  );
  const draftPr = stringValue(finalActionPolicy['draftPr'] ?? finalActionObject['draftPr'])
    ?? 'future-explicit-action-only';
  const includePaths = nonEmptyArray(
    stringArray(merged['includePaths']).concat(stringArray(source['includePaths'])),
    ['docs/**', 'README.md'],
  );
  const labels = nonEmptyArray(
    stringArray(merged['labels']).concat(stringArray(triage['labels'])),
    ['docs', 'doc-review'],
  );
  const staleThresholdDays = numberValue(merged['staleThresholdDays'], 30);
  const ref = stringValue(merged['ref']) ?? stringValue(source['ref']);
  const sourceKeySeed = [
    'github-doc',
    owner.toLowerCase(),
    repo.toLowerCase(),
    ref ?? 'default',
    includePaths.join(','),
    reviewProfiles.join(','),
    reviewProfileVersion,
    stableSourceKey(JSON.stringify({ finalAction, autoEditDocs, draftPr })),
  ].join(':');

  return {
    owner,
    repo,
    ref,
    includePaths,
    reviewProfiles,
    reviewProfileVersion,
    staleThresholdDays,
    targetColumn,
    triageCeremonyId: stringValue(merged['triageCeremonyId']),
    labels,
    finalAction,
    autoEditDocs,
    draftPr,
    sourceKeySeed,
  };
}

function docReviewIdempotencyKey(
  config: ResolvedDocReviewConfig,
  candidate: GitHubDocReviewCandidate,
): string {
  const sourceSha = candidate.blobSha || candidate.commitSha || 'unknown';
  return [
    'github-doc',
    `${config.owner.toLowerCase()}/${config.repo.toLowerCase()}`,
    candidate.path,
    sourceSha,
    `review-profile:${config.reviewProfileVersion}`,
    `profiles:${config.reviewProfiles.join('+')}`,
  ].join(':');
}

function docReviewIssueTitle(path: string, reviewProfiles: string[]): string {
  return `Review docs: ${path} (${reviewProfiles.join(', ')})`;
}

function docReviewIssueBody(
  config: ResolvedDocReviewConfig,
  candidate: GitHubDocReviewCandidate,
  idempotencyKey: string,
): string {
  const sourceSha = candidate.blobSha || candidate.commitSha || 'unknown';
  return [
    `Source: https://github.com/${config.owner}/${config.repo}`,
    `Doc path: ${candidate.path}`,
    `Source SHA: ${sourceSha}`,
    `Blob SHA: ${candidate.blobSha}`,
    `Commit SHA: ${candidate.commitSha ?? 'unknown'}`,
    `Review profile/version: ${config.reviewProfileVersion}`,
    `Review profiles: ${config.reviewProfiles.join(', ')}`,
    `Selection reason: ${candidate.reason}`,
    `Last source update: ${candidate.updatedAt ?? 'unknown'}`,
    `Final action: ${config.finalAction}`,
    `Auto-edit docs: ${config.autoEditDocs ? 'yes' : 'no'}`,
    `Draft PR policy: ${config.draftPr}`,
    `Dedupe key: ${idempotencyKey}`,
    '',
    'Review findings must stay traceable to the doc path and source SHA above.',
    'Record severity, owner recommendation, and suggested fix text/checklist here; do not edit or push docs by default.',
  ].join('\n');
}

function latestCommitDate(commit: GitHubCommitSummary | undefined): string | undefined {
  return commit?.commit.committer?.date
    ?? commit?.commit.author?.date
    ?? undefined;
}

function matchesAnyPath(path: string, patterns: string[]): boolean {
  return patterns.some((pattern) => globToRegExp(pattern).test(path));
}

function globToRegExp(pattern: string): RegExp {
  let out = '^';
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    const next = pattern[i + 1];
    if (ch === '*' && next === '*') {
      out += '.*';
      i += 1;
    } else if (ch === '*') {
      out += '[^/]*';
    } else if (ch === '?') {
      out += '[^/]';
    } else {
      out += ch.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
    }
  }
  out += '$';
  return new RegExp(out);
}

function parseSelectedDocs(context: Record<string, unknown> | null | undefined): SelectedDoc[] {
  const selected = context?.['selectedDocs'];
  if (!Array.isArray(selected)) return [];
  const out: SelectedDoc[] = [];
  for (const item of selected) {
    if (typeof item === 'string' && item.trim()) {
      out.push({ path: item.trim() });
    } else if (item && typeof item === 'object') {
      const record = item as Record<string, unknown>;
      const path = stringValue(record['path']);
      if (!path) continue;
      out.push({
        path,
        blobSha: stringValue(record['blobSha']),
        commitSha: stringValue(record['commitSha']),
      });
    }
  }
  return out;
}

function parseGitHubRepoUrl(url: string | undefined): { owner: string; repo: string } | null {
  if (!url) return null;
  const match = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/#?]+)(?:[/?#].*)?$/i);
  if (!match) return null;
  return { owner: match[1], repo: match[2].replace(/\.git$/i, '') };
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function nonEmptyArray(values: string[], fallback: string[]): string[] {
  const unique = new Set(values.map((value) => value.trim()).filter(Boolean));
  return unique.size > 0 ? [...unique] : fallback;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function numberValue(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return fallback;
}
