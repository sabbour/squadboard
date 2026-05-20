/**
 * Validates the curated visible built-in project-template bundles against the
 * squadapp.json schema and asserts declared artifact files exist on disk.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Ajv } from 'ajv';

const REPO_ROOT = resolve(process.cwd(), '../..');
const SCHEMA_PATH = resolve(process.cwd(), 'src/services/squad-apps/schema.json');
const VISIBLE_PROJECT_TEMPLATE_IDS = [
  'content-writing-project',
  'feature-kanban',
  'open-source-project',
  'research-spike',
];

const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf-8'));

interface SquadAppManifest {
  schemaVersion: number;
  appId: string;
  version: string;
  name: string;
  description: string;
  kanban?: {
    columns: Array<{ slug: string; label: string; order: number }>;
    defaultColumn: string;
  };
  team?: Array<{ name: string; role: string; charterPath?: string }>;
  ceremonies?: Array<{ id: string; name: string; workflowPath?: string }>;
  artifacts?: {
    agents?: string[];
    ceremonies?: string[];
    skills?: string[];
  };
}

function validateBundle(bundleName: string) {
  const bundleRoot = resolve(REPO_ROOT, 'bundles', bundleName);

  function bundleFileExists(relPath: string): boolean {
    return existsSync(resolve(bundleRoot, relPath));
  }

  function readJson(relPath: string): unknown {
    return JSON.parse(readFileSync(resolve(bundleRoot, relPath), 'utf-8'));
  }

  const manifest = readJson('squadapp.json') as SquadAppManifest;

  describe(`${bundleName}`, () => {
    it('passes draft-07 schema validation', () => {
      const ajv = new Ajv({ allErrors: true, strict: false });
      const validate = ajv.compile(schema);
      const valid = validate(manifest);
      if (!valid) {
        console.error(`[${bundleName}] Schema errors:`, validate.errors);
      }
      expect(valid).toBe(true);
    });

    it('has stable identity and a valid SemVer version', () => {
      expect(manifest.schemaVersion).toBe(1);
      expect(manifest.appId).toBe(bundleName);
      expect(typeof manifest.name).toBe('string');
      expect(typeof manifest.description).toBe('string');
      expect(manifest.version).toMatch(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)/);
    });

    it('has a kanban default column present in columns', () => {
      expect(manifest.kanban).toBeDefined();
      const slugs = manifest.kanban!.columns.map((c) => c.slug);
      expect(slugs).toContain(manifest.kanban!.defaultColumn);
    });

    it('declares agent and ceremony artifacts that exist on disk', () => {
      const teamPaths = (manifest.team ?? [])
        .filter((m) => m.charterPath)
        .map((m) => m.charterPath as string)
        .sort();
      const agentArtifacts = [...(manifest.artifacts?.agents ?? [])].sort();
      expect(agentArtifacts).toEqual(teamPaths);
      for (const charterPath of agentArtifacts) {
        expect(bundleFileExists(charterPath), `Charter missing: ${charterPath}`).toBe(true);
      }

      const ceremonyPaths = (manifest.ceremonies ?? [])
        .filter((c) => c.workflowPath)
        .map((c) => c.workflowPath as string)
        .sort();
      const ceremonyArtifacts = [...(manifest.artifacts?.ceremonies ?? [])].sort();
      expect(ceremonyArtifacts).toEqual(ceremonyPaths);
      for (const workflowPath of ceremonyArtifacts) {
        expect(bundleFileExists(workflowPath), `Workflow missing: ${workflowPath}`).toBe(true);
      }
    });

    it('declares skill artifacts that exist on disk', () => {
      for (const skillPath of manifest.artifacts?.skills ?? []) {
        expect(bundleFileExists(skillPath), `SKILL.md missing: ${skillPath}`).toBe(true);
      }
    });

    it('has README.md and squad-bundle.json', () => {
      expect(bundleFileExists('README.md')).toBe(true);
      expect(bundleFileExists('squad-bundle.json')).toBe(true);
    });
  });
}

describe('Curated built-in Project Templates — squadapp.json conformance', () => {
  for (const bundleName of VISIBLE_PROJECT_TEMPLATE_IDS) {
    validateBundle(bundleName);
  }
});
