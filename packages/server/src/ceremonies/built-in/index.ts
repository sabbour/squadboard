/**
 * built-in/index.ts — CER-2: Exports the built-in ceremony YAML strings
 * as a typed array for seeding into new projects.
 *
 * Uses readFileSync at module-load time (Node.js SSR pattern) to avoid any
 * bundler configuration changes. Files are co-located in this directory.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseWorkflowYaml } from '../yaml-canonicalize.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface BuiltInCeremony {
  slug: string;
  name: string;
  yamlContent: string;
  category?: string;
  tags: readonly string[];
}

function loadYaml(filename: string): string {
  return readFileSync(join(__dirname, filename), 'utf-8');
}

function loadBuiltInCeremony(slug: string, name: string, filename: string): BuiltInCeremony {
  const yamlContent = loadYaml(filename);
  const metadata = parseWorkflowYaml(yamlContent).metadata;
  return {
    slug,
    name,
    yamlContent,
    ...(metadata.category ? { category: metadata.category } : {}),
    tags: metadata.tags ?? [],
  };
}

export const BUILT_IN_CEREMONIES: ReadonlyArray<BuiltInCeremony> = [
  loadBuiltInCeremony('scribe-close-out', 'scribe-close-out', 'scribe-close-out.workflow.yaml'),
  loadBuiltInCeremony('work-pickup', 'work-pickup', 'work-pickup.workflow.yaml'),
  loadBuiltInCeremony('sprint-planning', 'sprint-planning', 'sprint-planning.workflow.yaml'),
  loadBuiltInCeremony('sprint-retro', 'sprint-retro', 'sprint-retro.workflow.yaml'),
  loadBuiltInCeremony('design-review', 'design-review', 'design-review.workflow.yaml'),
  loadBuiltInCeremony('retrospective', 'retrospective', 'retrospective.workflow.yaml'),
  loadBuiltInCeremony('retro-enforcement', 'retro-enforcement', 'retro-enforcement.workflow.yaml'),
];

export function getBuiltInCeremonyMetadata(slug: string): Pick<BuiltInCeremony, 'category' | 'tags'> | null {
  const ceremony = BUILT_IN_CEREMONIES.find((entry) => entry.slug === slug);
  if (!ceremony) return null;
  return {
    ...(ceremony.category ? { category: ceremony.category } : {}),
    tags: ceremony.tags,
  };
}
