/**
 * sdk-state.ts — Phase 5 SquadState wrapper
 *
 * Provides a lazily-cached SquadState (and typed collection accessors)
 * per project, backed by the SDK's FSStorageProvider over the project's
 * `.squad/` directory.
 *
 * @module services/sdk-state
 */
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { SquadState, } from '@bradygaster/squad-sdk';
import { FSStorageProvider } from '@bradygaster/squad-sdk/storage';
import { getDb } from '../db/index.js';
import { projects } from '../db/schema.js';
// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------
export class ProjectNotFoundError extends Error {
    projectId;
    constructor(projectId) {
        super(`Project not found: ${projectId}`);
        this.name = 'ProjectNotFoundError';
        this.projectId = projectId;
    }
}
// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------
/** Per-process cache: projectId → SquadState */
const stateCache = new Map();
// ---------------------------------------------------------------------------
// Core helpers
// ---------------------------------------------------------------------------
/**
 * Resolve the `.squad/` directory path for a project from the DB.
 * Throws `ProjectNotFoundError` if the project row is missing.
 */
async function resolveSquadPath(projectId) {
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
// ---------------------------------------------------------------------------
// Primary export
// ---------------------------------------------------------------------------
/**
 * Return a SquadState bound to the given project's `.squad/` directory.
 *
 * Results are cached per projectId in-process.  Call `invalidateState()`
 * to drop the cached instance (e.g. after the user changes the linked path).
 */
export async function getState(projectId) {
    const cached = stateCache.get(projectId);
    if (cached)
        return cached;
    // projects.path is the `.squad/` directory; SquadState.create() expects the
    // parent (the project root where `.squad/` lives).
    const squadPath = await resolveSquadPath(projectId);
    const rootDir = path.dirname(squadPath);
    const storage = new FSStorageProvider(rootDir);
    const state = SquadState.fromStorage(storage, rootDir);
    stateCache.set(projectId, state);
    return state;
}
/**
 * Drop the cached SquadState for a project.  The next call to any accessor
 * will re-create it from disk.
 */
export function invalidateState(projectId) {
    stateCache.delete(projectId);
}
// ---------------------------------------------------------------------------
// Typed collection accessors
// ---------------------------------------------------------------------------
export async function getAgents(projectId) {
    return (await getState(projectId)).agents;
}
export async function getRouting(projectId) {
    return (await getState(projectId)).routing;
}
export async function getDecisions(projectId) {
    return (await getState(projectId)).decisions;
}
export async function getSkills(projectId) {
    return (await getState(projectId)).skills;
}
export async function getTeam(projectId) {
    return (await getState(projectId)).team;
}
export async function getTemplates(projectId) {
    return (await getState(projectId)).templates;
}
export async function getConfig(projectId) {
    return (await getState(projectId)).config;
}
//# sourceMappingURL=sdk-state.js.map