/**
 * starter-ceremony-loader.ts — CER-9: Load ceremony YAML files bundled with
 * starter projects and import them into a newly-created project.
 *
 * Starters may include one or more `*.workflow.yaml` files written in the
 * canonical CER-3 format (apiVersion: squad.io/v1). When a project is
 * instantiated from a starter, this loader reads those files and wires them
 * into the project via `importCeremonyFromYaml`.
 *
 * Usage:
 *   import { loadStarterCeremonies } from './starter-ceremony-loader.js';
 *   const results = await loadStarterCeremonies('bug-triage', projectId);
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importCeremonyFromYaml, type ImportResult } from './ceremony-yaml-import.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STARTERS_DIR = path.resolve(__dirname, '..', 'data', 'starters');

export interface StarterCeremonyResult {
  slug: string;
  filePath: string;
  result: ImportResult | null;
  error: string | null;
}

export interface LoadStarterCeremoniesResult {
  projectId: string;
  starterSlug: string;
  loaded: StarterCeremonyResult[];
  errorCount: number;
}

/**
 * Read the starter's meta.json, find all `*.workflow.yaml` entries in the
 * `files` array, and import each into the given project.
 *
 * Returns a result summary; individual ceremony failures are captured in
 * `result.loaded[n].error` rather than throwing, so one bad YAML doesn't
 * abort the rest.
 */
export async function loadStarterCeremonies(
  starterSlug: string,
  projectId: string,
): Promise<LoadStarterCeremoniesResult> {
  const starterDir = path.join(STARTERS_DIR, starterSlug);

  // Read meta.json to discover bundled ceremony YAML files
  let files: string[] = [];
  try {
    const metaRaw = await fs.readFile(path.join(starterDir, 'meta.json'), 'utf-8');
    const meta = JSON.parse(metaRaw) as { files?: string[] };
    files = meta.files ?? [];
  } catch (err) {
    throw new Error(
      `starter-ceremony-loader: cannot read meta.json for starter "${starterSlug}": ${(err as Error).message}`,
    );
  }

  const yamlFiles = files.filter((f) => f.endsWith('.workflow.yaml'));
  const loaded: StarterCeremonyResult[] = [];

  for (const fileName of yamlFiles) {
    const filePath = path.join(starterDir, fileName);
    const slug = fileName.replace(/\.workflow\.yaml$/, '');
    try {
      const yamlText = await fs.readFile(filePath, 'utf-8');
      const result = await importCeremonyFromYaml(yamlText, projectId);
      loaded.push({ slug, filePath, result, error: null });
    } catch (err) {
      loaded.push({ slug, filePath, result: null, error: (err as Error).message });
    }
  }

  return {
    projectId,
    starterSlug,
    loaded,
    errorCount: loaded.filter((r) => r.error !== null).length,
  };
}
