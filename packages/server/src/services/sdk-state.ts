/**
 * sdk-state.ts — Phase 5 SquadState wrapper
 *
 * Provides a lazily-cached SquadState (and typed collection accessors)
 * per project, backed by PostgreSQL by default with an explicit filesystem
 * fallback for `.squad/` portability.
 *
 * Storage back-end selection
 * --------------------------
 * Unset config routes SquadState I/O through the PostgreSQL-backed adapter.
 * The adapter stores `.squad/` content in the `squad_storage` table via the
 * existing DB pool, so it works with either in-process PGlite or standalone
 * PostgreSQL selected by DATABASE_URL. Set `--squad-storage fs` or
 * SQUADBOARD_SQUAD_STORAGE_PROVIDER=fs to fall back to `.squad/` files.
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

/**
 * Resolve the `.squad/` directory path for a project from the DB.
 * Throws `ProjectNotFoundError` if the project row is missing.
 */
async function resolveSquadPath(projectId: string): Promise<string> {
  const db = getDb();
  const rows = await db
    .select({ squadPath: projects.path })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  const squadPath = rows[0]?.squadPath;
  if (!squadPath) {
    throw new ProjectNotFoundError(projectId);
  }

  return squadPath;
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
 * The storage back-end is selected by CLI/config/env:
 *   - unset/blank       → PostgreSQLStorageProvider (default)
 *   - 'postgresql'      → PostgreSQLStorageProvider (all I/O via squad_storage table)
 *   - 'fs'              → FSStorageProvider (explicit filesystem fallback)
 *   - all other values  → FSStorageProvider (fallback, including 'pglite')
 *
 * Results are cached per projectId in-process.  Call `invalidateState()`
 * to drop the cached instance (e.g. after the user changes the linked path).
 */
export async function getState(projectId: string): Promise<SquadState> {
  const cached = stateCache.get(projectId);
  if (cached) return cached;

  // projects.path is the `.squad/` directory; SquadState.create() expects the
  // parent (the project root where `.squad/` lives).
  const squadPath = await resolveSquadPath(projectId);
  const rootDir = path.dirname(squadPath);

  const backend = resolveStorageBackend();
  const storage = await buildStorageProvider(projectId, rootDir, backend);
  const state = SquadState.fromStorage(storage, rootDir);

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
 * This does not repair anything and does not query `squad_storage`; it reports
 * the declared authority mode plus the local projection artifacts Hockney can
 * expose through a status API later.
 */
export async function getProjectSyncOwnershipStatus(
  projectId: string,
): Promise<SquadSyncOwnershipStatus> {
  const storedSquadPath = await resolveSquadPath(projectId);
  const squadPath = path.basename(storedSquadPath) === '.squad'
    ? storedSquadPath
    : path.join(storedSquadPath, '.squad');
  const projectRoot = path.dirname(squadPath);

  return buildSyncOwnershipStatus({
    storageProvider: process.env['SQUADBOARD_SQUAD_STORAGE_PROVIDER'] ?? null,
    projectRoot,
    squadPath,
    presence: {
      squadDir: existsSync(squadPath),
      agentsDir: existsSync(path.join(squadPath, 'agents')),
      decisionsInboxDir: existsSync(path.join(squadPath, 'decisions', 'inbox')),
      teamMd: existsSync(path.join(squadPath, 'team.md')),
      routingMd: existsSync(path.join(squadPath, 'routing.md')),
      decisionsMd: existsSync(path.join(squadPath, 'decisions.md')),
      ceremoniesMd: existsSync(path.join(squadPath, 'ceremonies.md')),
      ceremoniesDefaultsPresent: await hasSeededCeremonyDefaults(path.join(squadPath, 'ceremonies.md')),
      copilotAgentMd: existsSync(path.join(projectRoot, '.github', 'agents', 'squad.agent.md')),
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
