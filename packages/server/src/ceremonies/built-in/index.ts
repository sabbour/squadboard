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

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface BuiltInCeremony {
  slug: string;
  name: string;
  yamlContent: string;
}

function loadYaml(filename: string): string {
  return readFileSync(join(__dirname, filename), 'utf-8');
}

export const BUILT_IN_CEREMONIES: ReadonlyArray<BuiltInCeremony> = [
  {
    slug: 'scribe-close-out',
    name: 'scribe-close-out',
    yamlContent: loadYaml('scribe-close-out.workflow.yaml'),
  },
  {
    slug: 'work-pickup',
    name: 'work-pickup',
    yamlContent: loadYaml('work-pickup.workflow.yaml'),
  },
  {
    slug: 'sprint-planning',
    name: 'sprint-planning',
    yamlContent: loadYaml('sprint-planning.workflow.yaml'),
  },
  {
    slug: 'sprint-retro',
    name: 'sprint-retro',
    yamlContent: loadYaml('sprint-retro.workflow.yaml'),
  },
  {
    slug: 'design-review',
    name: 'design-review',
    yamlContent: loadYaml('design-review.workflow.yaml'),
  },
  {
    slug: 'retrospective',
    name: 'retrospective',
    yamlContent: loadYaml('retrospective.workflow.yaml'),
  },
  {
    slug: 'retro-enforcement',
    name: 'retro-enforcement',
    yamlContent: loadYaml('retro-enforcement.workflow.yaml'),
  },
];
