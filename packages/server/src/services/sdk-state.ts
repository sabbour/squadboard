/**
 * sdk-state.ts — Phase 5 SquadState wrapper
 *
 * Provides a lazily-cached SquadState (and typed collection accessors)
 * per project, backed by project-level authority metadata when present with
 * evidence-based fallback for legacy `.squad/` portability.
 *
 * Storage back-end selection
 * --------------------------
 * Project rows can persist `storage_provider_mode`. When that is absent,
 * legacy rows are inferred from evidence: imported `squad_storage` rows mean
 * PostgreSQL authority; an existing filesystem `.squad/` with no DB rows stays
 * filesystem-authoritative. Process-level config is only the final fallback.
 *
 * @module services/sdk-state
 */

import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import {
  SquadState,
  AgentsCollection,
  RoutingCollection,
  DecisionsCollection,
  SkillsCollection,
  TeamCollection,
  TemplatesCollection,
  ConfigCollection,
} from '@bradygaster/squad-sdk';
import { FSStorageProvider } from '@bradygaster/squad-sdk/storage';
import type { StorageProvider } from '@bradygaster/squad-sdk/storage';
import { getDb } from '../db/index.js';
import { getPool } from '../db/index.js';
import { projects } from '../db/schema.js';
import { PostgreSQLStorageProvider } from '../sdk/postgresql-storage-provider.js';
import {
  buildSyncOwnershipStatus,
  type SquadSyncOwnershipStatus,
} from '../sdk/sync-ownership.js';

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

export class ProjectNotFoundError extends Error {
  readonly projectId: string;

  constructor(projectId: string) {
    super(`Project not found: ${projectId}`);
    this.name = 'ProjectNotFoundError';
    this.projectId = projectId;
  }
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

/** Per-process cache: projectId → SquadState */
const stateCache = new Map<string, SquadState>();

// ---------------------------------------------------------------------------
// Storage provider selection
// ---------------------------------------------------------------------------

/**
 * Which StorageProvider back-end is active.
 *
 *   'fs'         — explicit fallback; reads/writes the real `.squad/` directory on disk.
 *   'postgresql' — stores all Squad state in the `squad_storage` DB table.
 *                  Default when no provider is configured.
 *
 * Only the canonical value 'postgresql' or an unset/blank value selects the DB
 * provider. Other values, including the legacy 'pglite' spelling, use the
 * filesystem fallback.
 */
export type StorageBackend = 'fs' | 'postgresql';

export interface StorageBackendConfig {
  /**
   * Canonical provider selector. Unset/blank and "postgresql" select the
   * DB-backed provider; "fs", "pglite", and unknown values use filesystem.
   */
  squadStorageProvider?: string | null;
}

export type StorageBackendConfigSource = StorageBackendConfig | string | null | undefined;

export function resolveStorageBackend(source?: StorageBackendConfigSource): StorageBackend {
  const raw =
    typeof source === 'string'
      ? source
      : source === undefined
        ? process.env['SQUADBOARD_SQUAD_STORAGE_PROVIDER']
        : source?.squadStorageProvider;
  const provider = raw?.trim().toLowerCase();
  if (!provider) return 'postgresql';
  if (provider === 'postgresql') return 'postgresql';
  return 'fs';
}

function normalizeProjectStorageBackend(value?: string | null): StorageBackend | null {
  const provider = value?.trim().toLowerCase();
  if (!provider) return null;
  if (provider === 'postgresql') return 'postgresql';
  if (provider === 'fs' || provider === 'filesystem') return 'fs';
  return null;
}

function storageProviderForBackend(backend: StorageBackend): string {
  return backend === 'postgresql' ? 'postgresql' : 'fs';
}

async function listFilesystemSquadFiles(
  squadDir: string,
  relativeDir = '',
): Promise<string[]> {
  const absoluteDir = relativeDir ? path.join(squadDir, relativeDir) : squadDir;
  const entries = await readdir(absoluteDir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isSymbolicLink()) continue;

    const relativePath = relativeDir
      ? path.posix.join(relativeDir, entry.name)
      : entry.name;

    if (entry.isDirectory()) {
      files.push(...await listFilesystemSquadFiles(squadDir, relativePath));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }

  return files;
}

export async function seedPostgreSQLProviderFromFilesystemIfEmpty(
  provider: PostgreSQLStorageProvider,
  projectId: string,
  rootDir: string,
): Promise<void> {
  const existing = await provider.list('');
  if (existing.length > 0) return;

  const squadDir = path.join(rootDir, '.squad');
  if (!existsSync(squadDir)) return;

  const files = await listFilesystemSquadFiles(squadDir);
  if (files.length === 0) return;

  const contents = await Promise.all(
    files.map(async (relativePath) => ({
      relativePath,
      content: await readFile(path.join(squadDir, relativePath), 'utf8'),
    })),
  );

  for (const { relativePath, content } of contents) {
    await provider.write(relativePath, content);
  }

  console.log(
    `[sdk-state] imported ${contents.length} .squad file(s) into PostgreSQL storage for project ${projectId}`,
  );
}

// ---------------------------------------------------------------------------
// Core helpers
// ---------------------------------------------------------------------------

interface ProjectStorageContext {
  squadPath: string;
  rootDir: string;
  backend: StorageBackend;
  storageProvider: string;
}

interface ProjectStorageRow {
  squadPath: string;
  storageProviderMode?: string | null;
}

/**
 * Resolve the `.squad/` directory path and storage authority for a project.
 * Project-level authority wins; legacy rows are inferred from evidence so
 * CLI-first filesystem projects are not labeled DB-authoritative just because
 * the server runtime default is PostgreSQL/PGlite.
 */
async function resolveProjectStorageContext(projectId: string): Promise<ProjectStorageContext> {
  const db = getDb();
  const rows = await db
    .select({
      squadPath: projects.path,
      storageProviderMode: projects.storageProviderMode,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1) as ProjectStorageRow[];

  const storedSquadPath = rows[0]?.squadPath;
  if (!storedSquadPath) {
    throw new ProjectNotFoundError(projectId);
  }

  const squadPath = path.basename(storedSquadPath) === '.squad'
    ? storedSquadPath
    : path.join(storedSquadPath, '.squad');
  const rootDir = path.dirname(squadPath);

  const backend = normalizeProjectStorageBackend(rows[0]?.storageProviderMode)
    ?? await inferProjectStorageBackend(projectId, squadPath);

  return {
    squadPath,
    rootDir,
    backend,
    storageProvider: storageProviderForBackend(backend),
  };
}

async function inferProjectStorageBackend(
  projectId: string,
  squadPath: string,
): Promise<StorageBackend> {
  const envBackend = normalizeProjectStorageBackend(
    process.env['SQUADBOARD_SQUAD_STORAGE_PROVIDER'],
  );

  if (envBackend === 'fs') {
    return 'fs';
  }

  const rowCount = await countSquadStorageRows(projectId);
  if (rowCount !== null && rowCount > 0) {
    return 'postgresql';
  }

  if (existsSync(squadPath)) {
    return 'fs';
  }

  return envBackend ?? resolveStorageBackend();
}

async function countSquadStorageRows(projectId: string): Promise<number | null> {
  try {
    const { rows } = await getPool().query<{ row_count: string | number | null }>(
      'SELECT COUNT(*) AS row_count FROM squad_storage WHERE scope = $1',
      [projectId],
    );
    return Number(rows[0]?.row_count ?? 0);
  } catch {
    return null;
  }
}

/**
 * Build a StorageProvider for the requested back-end.
 * For 'postgresql', the provider is pre-initialized before being returned.
 */
async function buildStorageProvider(
  projectId: string,
  rootDir: string,
  backend: StorageBackend,
): Promise<StorageProvider> {
  if (backend === 'postgresql') {
    const pool = getPool();
    const provider = new PostgreSQLStorageProvider(pool, projectId, { rootDir });
    await provider.init();
    await seedPostgreSQLProviderFromFilesystemIfEmpty(provider, projectId, rootDir);
    return provider;
  }
  // 'fs' — explicit fallback, no async init needed
  return new FSStorageProvider(rootDir);
}

// ---------------------------------------------------------------------------
// Primary export
// ---------------------------------------------------------------------------

/**
 * Return a SquadState bound to the given project's `.squad/` directory.
 *
 * The storage back-end is selected per project. Persisted
 * `projects.storage_provider_mode` wins; legacy rows infer DB authority only
 * when `squad_storage` rows exist, otherwise an existing `.squad/` remains the
 * filesystem authority.
 *
 * Results are cached per projectId in-process.  Call `invalidateState()`
 * to drop the cached instance (e.g. after the user changes the linked path).
 */
export async function getState(projectId: string): Promise<SquadState> {
  const cached = stateCache.get(projectId);
  if (cached) return cached;

  const context = await resolveProjectStorageContext(projectId);
  const storage = await buildStorageProvider(projectId, context.rootDir, context.backend);
  const state = SquadState.fromStorage(storage, context.rootDir);

  stateCache.set(projectId, state);
  return state;
}

/**
 * Drop the cached SquadState for a project.  The next call to any accessor
 * will re-create it from disk.
 */
export function invalidateState(projectId: string): void {
  stateCache.delete(projectId);
}

/**
 * Build the SDK-facing sync ownership status for a project.
 *
 * This does not repair anything. It reports the project-level authority mode
 * plus the local projection artifacts Hockney exposes through the status API.
 */
export async function getProjectSyncOwnershipStatus(
  projectId: string,
): Promise<SquadSyncOwnershipStatus> {
  const context = await resolveProjectStorageContext(projectId);

  return buildSyncOwnershipStatus({
    storageProvider: context.storageProvider,
    projectRoot: context.rootDir,
    squadPath: context.squadPath,
    presence: {
      squadDir: existsSync(context.squadPath),
      agentsDir: existsSync(path.join(context.squadPath, 'agents')),
      decisionsInboxDir: existsSync(path.join(context.squadPath, 'decisions', 'inbox')),
      teamMd: existsSync(path.join(context.squadPath, 'team.md')),
      routingMd: existsSync(path.join(context.squadPath, 'routing.md')),
      decisionsMd: existsSync(path.join(context.squadPath, 'decisions.md')),
      ceremoniesMd: existsSync(path.join(context.squadPath, 'ceremonies.md')),
      ceremoniesDefaultsPresent: await hasSeededCeremonyDefaults(path.join(context.squadPath, 'ceremonies.md')),
      copilotAgentMd: existsSync(path.join(context.rootDir, '.github', 'agents', 'squad.agent.md')),
    },
  });
}

async function hasSeededCeremonyDefaults(ceremoniesPath: string): Promise<boolean> {
  if (!existsSync(ceremoniesPath)) {
    return false;
  }

  const content = await readFile(ceremoniesPath, 'utf-8');
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    return false;
  }

  return !/Project ceremonies will be listed here\./i.test(trimmed);
}

// ---------------------------------------------------------------------------
// PostgreSQL provider factory (for callers that need the raw provider)
// ---------------------------------------------------------------------------

/**
 * Create and initialize a PostgreSQLStorageProvider for the given scope string.
 * Useful for testing or for callers that want direct provider access without
 * going through SquadState.
 *
 * The scope is typically a project UUID but can be any opaque string.
 */
export async function createPostgreSQLStorageProvider(
  scope: string,
): Promise<PostgreSQLStorageProvider> {
  const pool = getPool();
  const provider = new PostgreSQLStorageProvider(pool, scope);
  await provider.init();
  return provider;
}

// ---------------------------------------------------------------------------
// Typed collection accessors
// ---------------------------------------------------------------------------

export async function getAgents(projectId: string): Promise<AgentsCollection> {
  return (await getState(projectId)).agents;
}

export async function getRouting(projectId: string): Promise<RoutingCollection> {
  return (await getState(projectId)).routing;
}

export async function getDecisions(projectId: string): Promise<DecisionsCollection> {
  return (await getState(projectId)).decisions;
}

export async function getSkills(projectId: string): Promise<SkillsCollection> {
  return (await getState(projectId)).skills;
}

export async function getTeam(projectId: string): Promise<TeamCollection> {
  return (await getState(projectId)).team;
}

export async function getTemplates(projectId: string): Promise<TemplatesCollection> {
  return (await getState(projectId)).templates;
}

export async function getConfig(projectId: string): Promise<ConfigCollection> {
  return (await getState(projectId)).config;
}
