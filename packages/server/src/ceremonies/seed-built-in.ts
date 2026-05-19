/**
 * seed-built-in.ts — CER-2: Seeds the three built-in ceremonies into a project.
 *
 * Calls the CER-3 import service (importCeremonyFromYaml) for each ceremony.
 * Idempotent — the import service upserts by metadata.name + projectId, so
 * re-running on the same project updates existing rows (created=false).
 *
 * Origin badge note: because the workflows schema has no `templateId` column
 * (CER-1 reserves it but the column doesn't exist yet), built-in ceremonies
 * surface as 'yaml-import' origin in the UI (sourceYamlPath is non-null in
 * triggerConfig). This is the correct interim behaviour until a future schema
 * migration adds the templateId column.
 */

import { BUILT_IN_CEREMONIES } from './built-in/index.js';
import { builtInSourceMarker } from './built-in/protection.js';
import { getDb, schema } from '../db/index.js';
import { importCeremonyFromYaml } from '../services/ceremony-yaml-import.js';

export interface SeedEntry {
  name: string;
  ceremonyId: string;
  created: boolean;
}

export interface SeedError {
  name: string;
  error: string;
}

export interface SeedResult {
  projectId: string;
  seeded: SeedEntry[];
  errors: SeedError[];
}

/**
 * Import each built-in ceremony into the given project via the CER-3 import
 * service. Per-ceremony failures are captured in `errors`; the function never
 * throws so callers can treat seeding as a non-fatal post-step.
 */
export async function seedBuiltInCeremonies(projectId: string): Promise<SeedResult> {
  const seeded: SeedEntry[] = [];
  const errors: SeedError[] = [];

  for (const ceremony of BUILT_IN_CEREMONIES) {
    try {
      const result = await importCeremonyFromYaml(ceremony.yamlContent, projectId, {
        sourceMarker: builtInSourceMarker(ceremony.slug),
      });
      seeded.push({
        name: ceremony.name,
        ceremonyId: result.ceremonyId,
        created: result.created,
      });
    } catch (err) {
      errors.push({
        name: ceremony.name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { projectId, seeded, errors };
}

export async function seedBuiltInCeremoniesForAllProjects(): Promise<SeedResult[]> {
  const db = getDb();
  const projects = await db.select({ id: schema.projects.id }).from(schema.projects);
  const results: SeedResult[] = [];
  for (const project of projects) {
    results.push(await seedBuiltInCeremonies(project.id));
  }
  return results;
}
