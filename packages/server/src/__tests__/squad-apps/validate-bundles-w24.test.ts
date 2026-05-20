/**
 * squad-apps/validate-bundles-w24.test.ts — Vitest validation for the W24 F4
 * bundle migration. Validates all 6 migrated bundles against the squadapp.json
 * schema and asserts each declared artifact file exists on disk.
 *
 * Shared helper: validateBundle(bundleName) — DRY across all 6 bundle tests.
 *
 * Bundles validated:
 *   - default-software-project
 *   - library-or-sdk-project
 *   - bug-bash-project
 *   - research-spike
 *   - content-writing-project
 *   - ops-runbook-project
 *   - open-source-project   (added W26)
 *   - ai-agent-project      (added W26)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv } from 'ajv';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(process.cwd(), '../..');
const SCHEMA_PATH = resolve(process.cwd(), 'src/services/squad-apps/schema.json');

const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf-8'));

// ---------------------------------------------------------------------------
// Shared helper: validateBundle
// ---------------------------------------------------------------------------

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
  skills?: Array<{ key: string; name: string }>;
  artifacts?: {
    agents?: string[];
    ceremonies?: string[];
    skills?: string[];
    tools?: string[];
    mcpServers?: string[];
    seedIssues?: string[];
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
    describe('1. JSON Schema validation', () => {
      it('passes draft-07 schema validation', () => {
        const ajv = new Ajv({ allErrors: true, strict: false });
        const validate = ajv.compile(schema);
        const valid = validate(manifest);
        if (!valid) {
          console.error(`[${bundleName}] Schema errors:`, validate.errors);
        }
        expect(valid).toBe(true);
      });

      it('has schemaVersion === 1', () => {
        expect(manifest.schemaVersion).toBe(1);
      });

      it('has valid SemVer version', () => {
        expect(typeof manifest.version).toBe('string');
        expect(manifest.version).toMatch(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)/);
      });

      it('has required top-level fields', () => {
        expect(typeof manifest.appId).toBe('string');
        expect(manifest.appId.length).toBeGreaterThan(0);
        expect(typeof manifest.name).toBe('string');
        expect(typeof manifest.description).toBe('string');
      });

      it('appId matches bundle directory name', () => {
        expect(manifest.appId).toBe(bundleName);
      });
    });

    describe('2. Kanban board', () => {
      it('has kanban with columns and defaultColumn', () => {
        expect(manifest.kanban).toBeDefined();
        expect(Array.isArray(manifest.kanban?.columns)).toBe(true);
        expect(manifest.kanban!.columns.length).toBeGreaterThan(0);
      });

      it('defaultColumn slug exists in columns', () => {
        const slugs = manifest.kanban!.columns.map((c) => c.slug);
        expect(slugs).toContain(manifest.kanban!.defaultColumn);
      });
    });

    describe('3. Team agent charter files', () => {
      it('all charterPath files exist on disk', () => {
        for (const member of manifest.team ?? []) {
          if (member.charterPath) {
            expect(
              bundleFileExists(member.charterPath),
              `Charter missing for ${member.name}: ${member.charterPath}`
            ).toBe(true);
          }
        }
      });
    });

    describe('4. Ceremony workflow files', () => {
      it('all workflowPath files exist on disk', () => {
        for (const ceremony of manifest.ceremonies ?? []) {
          if (ceremony.workflowPath) {
            expect(
              bundleFileExists(ceremony.workflowPath),
              `Workflow missing for ceremony ${ceremony.id}: ${ceremony.workflowPath}`
            ).toBe(true);
          }
        }
      });
    });

    describe('5. Skill SKILL.md files', () => {
      it('all artifact skill files exist on disk', () => {
        for (const skillPath of manifest.artifacts?.skills ?? []) {
          expect(
            bundleFileExists(skillPath),
            `SKILL.md missing: ${skillPath}`
          ).toBe(true);
        }
      });
    });

    describe('6. README', () => {
      it('README.md exists', () => {
        expect(bundleFileExists('README.md')).toBe(true);
      });
    });

    describe('7. Artifacts section completeness', () => {
      it('artifacts.agents matches team charterPaths', () => {
        const teamPaths = (manifest.team ?? [])
          .filter((m) => m.charterPath)
          .map((m) => m.charterPath as string)
          .sort();
        const artifactPaths = [...(manifest.artifacts?.agents ?? [])].sort();
        expect(artifactPaths).toEqual(teamPaths);
      });

      it('artifacts.ceremonies matches ceremony workflowPaths', () => {
        const ceremonyPaths = (manifest.ceremonies ?? [])
          .filter((c) => c.workflowPath)
          .map((c) => c.workflowPath as string)
          .sort();
        const artifactPaths = [...(manifest.artifacts?.ceremonies ?? [])].sort();
        expect(artifactPaths).toEqual(ceremonyPaths);
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Run validateBundle for all 6 migrated bundles
// ---------------------------------------------------------------------------

describe('W24 Bundle Migration — squadapp.json conformance', () => {
  validateBundle('default-software-project');
  validateBundle('library-or-sdk-project');
  validateBundle('bug-bash-project');
  validateBundle('research-spike');
  validateBundle('content-writing-project');
  validateBundle('ops-runbook-project');
  validateBundle('open-source-project');
  validateBundle('ai-agent-project');
});
