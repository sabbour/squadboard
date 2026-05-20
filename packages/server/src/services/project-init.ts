/**
 * project-init.ts — CER-2: Wraps project creation with post-insert seeding
 * of built-in ceremonies.
 *
 * `createProject` inserts a new project row then calls seedBuiltInCeremonies
 * as a non-fatal post-step. Set env var SQUADBOARD_SEED_BUILT_IN_CEREMONIES=0
 * to skip seeding (useful in tests or CI environments that don't want ceremony
 * rows).
 */

import { getDb, schema } from '../db/index.js';
import { seedBuiltInCeremonies } from '../ceremonies/seed-built-in.js';
import { assertProjectPathAvailable } from './project-path-uniqueness.js';

export interface CreateProjectOptions {
  name: string;
  path: string;
}

export interface CreateProjectResult {
  id: string;
  name: string;
  path: string;
  [key: string]: unknown;
}

function isSeedingEnabled(): boolean {
  return process.env.SQUADBOARD_SEED_BUILT_IN_CEREMONIES !== '0';
}

/**
 * Insert a new project row and, if seeding is enabled, seed the three
 * built-in ceremonies. Seeding failures are logged as warnings but do NOT
 * prevent the project from being returned.
 */
export async function createProject(
  options: CreateProjectOptions,
): Promise<CreateProjectResult> {
  const db = getDb();
  const safePath = await assertProjectPathAvailable(options.path);

  const [project] = await db
    .insert(schema.projects)
    .values({ name: options.name, path: safePath, storageProviderMode: 'postgresql' })
    .returning();

  if (!project) {
    throw new Error('Project insert returned no rows');
  }

  if (isSeedingEnabled()) {
    try {
      const seedResult = await seedBuiltInCeremonies(project.id);
      if (seedResult.errors.length > 0) {
        console.warn(
          `[project-init] seedBuiltInCeremonies partial failure for project ${project.id}:`,
          seedResult.errors,
        );
      }
    } catch (err) {
      console.warn(
        `[project-init] seedBuiltInCeremonies threw for project ${project.id}:`,
        err,
      );
    }
  }

  return project as CreateProjectResult;
}
