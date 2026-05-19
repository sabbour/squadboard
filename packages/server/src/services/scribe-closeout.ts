import fs from 'node:fs/promises';
import path from 'node:path';

import type {
  CloseOutOptions as SdkCloseOutOptions,
  CloseOutResult as SdkCloseOutResult,
  SpawnManifest,
} from '@sabbour/squadboard-sdk';
import { eq } from 'drizzle-orm';

import { getDb, schema } from '../db/index.js';
import { resolveSquadDir } from './diagnostics.js';
import {
  captureDirective,
  type DirectiveCaptureResult,
  type McpCaptureFn,
} from './directive-capture.js';
import {
  buildCloseOutLifecycleMetadata,
  type CeremonyLifecycleMetadata,
} from './worktree-lifecycle.js';

export type ScribeCloseOutSource = 'daemon' | 'coordinator' | 'server';

export interface ScribeCloseOutInput {
  projectId?: string | null;
  teamRoot?: string | null;
  spawnManifest?: SpawnManifest;
  source?: ScribeCloseOutSource;
  extra?: Record<string, unknown> | null;
  now?: Date;
  captureCloseout?: boolean;
  callMcp?: boolean;
  mcpCapture?: McpCaptureFn | null;
}

export interface ScribeCloseOutTarget {
  projectId: string | null;
  teamRoot: string;
  squadDir: string;
  storedProjectPath?: string;
}

export interface CloseOutMetadata {
  ceremonyId: 'scribe-close-out';
  source: ScribeCloseOutSource;
  projectId: string | null;
  invokedAt: string;
  durationMs: number;
  teamRoot: string;
  squadDir: string;
  sdkResult: SdkCloseOutResult;
  healthReportPath: string | null;
  lifecycle: CeremonyLifecycleMetadata;
  directiveCapture: DirectiveCaptureResult | { status: 'failed'; error: string } | null;
}

export interface ScribeCloseOutResult extends CloseOutMetadata {
  metadataPath: string | null;
  latestMetadataPath: string | null;
  metadataError?: string;
}

type SdkCloseOutFn = (opts?: SdkCloseOutOptions) => Promise<SdkCloseOutResult>;

interface BoardState {
  snapshot: {
    total: number;
    done: number;
    inProgress: number;
    blocked: number;
    pending: number;
  };
  nextWaveTodos: Array<{
    id: string;
    title: string;
    status: 'in_progress' | 'blocked';
    blockedReason?: string;
  }>;
}

const EMPTY_BOARD_STATE: BoardState = {
  snapshot: { total: 0, done: 0, inProgress: 0, blocked: 0, pending: 0 },
  nextWaveTodos: [],
};

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function timestampSlug(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

function filenameSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'close-out';
}

function asSource(value: unknown): ScribeCloseOutSource | null {
  return value === 'daemon' || value === 'coordinator' || value === 'server'
    ? value
    : null;
}

async function loadSdkCloseOut(): Promise<SdkCloseOutFn> {
  const sdk = await import('@sabbour/squadboard-sdk');
  const closeOut = sdk.squadboard?.scribe?.closeOut;
  if (typeof closeOut !== 'function') {
    throw new Error('@sabbour/squadboard-sdk does not export squadboard.scribe.closeOut');
  }
  return closeOut;
}

async function resolveProjectTarget(projectId: string): Promise<ScribeCloseOutTarget> {
  const db = getDb();
  const [project] = await db
    .select({ path: schema.projects.path })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .limit(1);

  if (!project?.path) {
    throw Object.assign(new Error(`project ${projectId} has no .squad path`), { status: 404 });
  }

  const resolved = await resolveSquadDir(project.path);
  if (!resolved.ok) {
    throw Object.assign(new Error(`project .squad path is not usable: ${resolved.reason}`), { status: 422 });
  }

  return {
    projectId,
    teamRoot: resolved.projectRoot,
    squadDir: resolved.squadDir,
    storedProjectPath: project.path,
  };
}

export async function resolveScribeCloseOutTarget(input: {
  projectId?: string | null;
  teamRoot?: string | null;
}): Promise<ScribeCloseOutTarget> {
  const projectId = input.projectId?.trim() || process.env.SQUADBOARD_DEFAULT_PROJECT_ID?.trim() || null;
  if (input.teamRoot?.trim()) {
    const teamRoot = path.resolve(input.teamRoot.trim());
    return {
      projectId,
      teamRoot,
      squadDir: path.join(teamRoot, '.squad'),
    };
  }
  if (projectId) {
    return resolveProjectTarget(projectId);
  }

  const teamRoot = process.cwd();
  return {
    projectId: null,
    teamRoot,
    squadDir: path.join(teamRoot, '.squad'),
  };
}

async function loadBoardState(projectId: string | null): Promise<BoardState> {
  if (!projectId) return EMPTY_BOARD_STATE;
  try {
    const db = getDb();
    const maybeRows = await db
      .select({
        id: schema.issues.id,
        title: schema.issues.title,
        status: schema.issues.status,
        body: schema.issues.body,
      })
      .from(schema.issues)
      .where(eq(schema.issues.projectId, projectId));

    if (!Array.isArray(maybeRows)) return EMPTY_BOARD_STATE;

    const snapshot = { total: 0, done: 0, inProgress: 0, blocked: 0, pending: 0 };
    const nextWaveTodos: BoardState['nextWaveTodos'] = [];
    for (const row of maybeRows) {
      const status = String(row.status ?? '');
      snapshot.total += 1;
      if (status === 'done') snapshot.done += 1;
      else if (status === 'in_progress') snapshot.inProgress += 1;
      else if (status === 'blocked') snapshot.blocked += 1;
      else snapshot.pending += 1;

      if (status === 'in_progress' || status === 'blocked') {
        nextWaveTodos.push({
          id: String(row.id),
          title: String(row.title ?? 'Untitled'),
          status,
          blockedReason: status === 'blocked' ? String(row.body ?? '').slice(0, 180) || undefined : undefined,
        });
      }
    }
    return { snapshot, nextWaveTodos };
  } catch {
    return EMPTY_BOARD_STATE;
  }
}

function normaliseSdkExtra(extra: Record<string, unknown> | null | undefined): Partial<SdkCloseOutOptions> {
  const sdkExtra = { ...(extra ?? {}) } as Partial<SdkCloseOutOptions> & Record<string, unknown>;
  delete sdkExtra.projectId;
  delete sdkExtra.teamRoot;
  delete sdkExtra.spawnManifest;
  delete sdkExtra.source;
  delete sdkExtra.context;
  delete sdkExtra.waveNumber;
  delete sdkExtra.sessionId;
  delete sdkExtra.callMcp;
  delete sdkExtra.captureCloseout;
  return sdkExtra;
}

function numberOption(extra: Record<string, unknown> | null | undefined, key: string): number | null {
  const value = extra?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringOption(extra: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = extra?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function defaultHealthReport(input: {
  extra: Record<string, unknown> | null | undefined;
  source: ScribeCloseOutSource;
  startedAt: Date;
  boardState: BoardState;
  spawnManifest?: SpawnManifest;
}): NonNullable<SdkCloseOutOptions['healthReport']> {
  const sessionId = filenameSlug(
    stringOption(input.extra, 'sessionId') ?? `${input.source}-${timestampSlug(input.startedAt)}`,
  );
  return {
    waveNumber: numberOption(input.extra, 'waveNumber') ?? 0,
    sessionId,
    backlogBefore: input.boardState.snapshot,
    backlogAfter: input.boardState.snapshot,
    spawnSummaries: input.spawnManifest?.agents.map((agent) => ({
      name: agent.name,
      plainLanguageSummary: agent.summary,
      commitSha: agent.commitSha,
    })) ?? [],
    lineage: [],
    defects: [],
    nextWaveTodos: input.boardState.nextWaveTodos,
  };
}

async function captureCloseOutDirective(input: {
  projectId: string | null;
  result: SdkCloseOutResult;
  source: ScribeCloseOutSource;
  now: Date;
  callMcp?: boolean;
  mcpCapture?: McpCaptureFn | null;
}): Promise<ScribeCloseOutResult['directiveCapture']> {
  if (!input.projectId) return null;
  const sha = input.result.commitSha ? ` (sha=${input.result.commitSha.slice(0, 12)})` : '';
  const directive = `done: Scribe close-out completed${sha}`;
  try {
    return await captureDirective({
      projectId: input.projectId,
      directive,
      phase: 'closeout',
      title: 'Scribe close-out completed',
      sourceType: 'scribe-close-out',
      sourceId: input.source,
      createdBy: 'scribe-close-out',
      userName: 'Scribe',
      now: input.now,
      callMcp: input.callMcp,
      mcpCapture: input.mcpCapture,
    });
  } catch (err) {
    const message = errorMessage(err);
    console.warn(`[scribe-closeout] directive closeout capture failed open: ${message}`);
    return { status: 'failed', error: message };
  }
}

async function writeMetadata(input: {
  squadDir: string;
  source: ScribeCloseOutSource;
  startedAt: Date;
  metadata: CloseOutMetadata;
}): Promise<Pick<ScribeCloseOutResult, 'metadataPath' | 'latestMetadataPath' | 'metadataError'>> {
  const reportsDir = path.join(input.squadDir, 'reports');
  const fileName = `scribe-close-out-${timestampSlug(input.startedAt)}-${input.source}.json`;
  const metadataPath = path.join(reportsDir, fileName);
  const latestMetadataPath = path.join(reportsDir, 'scribe-close-out-latest.json');
  const content = JSON.stringify(input.metadata, null, 2) + '\n';

  try {
    await fs.mkdir(reportsDir, { recursive: true });
    await fs.writeFile(metadataPath, content, 'utf8');
    await fs.writeFile(latestMetadataPath, content, 'utf8');
    return { metadataPath, latestMetadataPath };
  } catch (err) {
    return {
      metadataPath: null,
      latestMetadataPath: null,
      metadataError: errorMessage(err),
    };
  }
}

export async function invokeScribeCloseOut(input: ScribeCloseOutInput = {}): Promise<ScribeCloseOutResult> {
  const startedAt = input.now ?? new Date();
  const startedMs = Date.now();
  const source = input.source ?? asSource(input.extra?.source) ?? 'server';
  const target = await resolveScribeCloseOutTarget({
    projectId: input.projectId,
    teamRoot: input.teamRoot,
  });
  const boardState = await loadBoardState(target.projectId);
  const sdkExtra = normaliseSdkExtra(input.extra);
  const requestedHealthReport = sdkExtra.healthReport as SdkCloseOutOptions['healthReport'] | null | false | undefined;
  delete sdkExtra.healthReport;
  const spawnManifest = input.spawnManifest ?? sdkExtra.spawnManifest;
  delete sdkExtra.spawnManifest;

  const sdkOptions: SdkCloseOutOptions = {
    ...sdkExtra,
    projectId: target.projectId ?? undefined,
    spawnManifest,
    teamRoot: target.teamRoot,
    healthReport:
      requestedHealthReport === null || requestedHealthReport === false
        ? undefined
        : requestedHealthReport ?? defaultHealthReport({
          extra: input.extra,
          source,
          startedAt,
          boardState,
          spawnManifest,
        }),
  };

  const closeOut = await loadSdkCloseOut();
  const sdkResult = await closeOut(sdkOptions);
  const durationMs = Date.now() - startedMs;
  const completedAt = new Date(startedAt.getTime() + durationMs);
  const directiveCapture = input.captureCloseout === false
    ? null
    : await captureCloseOutDirective({
      projectId: target.projectId,
      result: sdkResult,
      source,
      now: startedAt,
      callMcp: input.callMcp,
      mcpCapture: input.mcpCapture,
    });

  const waveNumber = numberOption(input.extra, 'waveNumber');
  const waveId = stringOption(input.extra, 'sessionId')
    ?? (waveNumber !== null ? `wave-${waveNumber}` : null)
    ?? spawnManifest?.runId
    ?? null;
  const initialLifecycle = buildCloseOutLifecycleMetadata({
    currentWaveId: waveId,
    currentRunId: spawnManifest?.runId ?? waveId,
    startedAt,
    endedAt: completedAt,
    healthReportPath: sdkResult.healthReportPath,
    closeoutReportPath: null,
  });

  const metadata: CloseOutMetadata = {
    ceremonyId: 'scribe-close-out',
    source,
    projectId: target.projectId,
    invokedAt: startedAt.toISOString(),
    durationMs,
    teamRoot: target.teamRoot,
    squadDir: target.squadDir,
    sdkResult,
    healthReportPath: sdkResult.healthReportPath,
    lifecycle: initialLifecycle,
    directiveCapture,
  };
  const metadataWrite = await writeMetadata({
    squadDir: target.squadDir,
    source,
    startedAt,
    metadata,
  });
  const lifecycle = buildCloseOutLifecycleMetadata({
    currentWaveId: waveId,
    currentRunId: spawnManifest?.runId ?? waveId,
    startedAt,
    endedAt: completedAt,
    healthReportPath: sdkResult.healthReportPath,
    closeoutReportPath: metadataWrite.metadataPath,
  });

  return {
    ...metadata,
    ...metadataWrite,
    lifecycle,
  };
}
