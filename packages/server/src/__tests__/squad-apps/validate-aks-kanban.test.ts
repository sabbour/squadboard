/**
 * squad-apps/validate-aks-kanban.test.ts — Vitest validation for the W23 F4
 * aks-feature-kanban curated Squad App.
 *
 * Tests:
 *   1. squadapp.json validates against the draft-07 JSON Schema
 *   2. All charterPath files exist relative to the bundle root
 *   3. All workflowPath ceremony files exist
 *   4. All skill SKILL.md files exist
 *   5. All tool JSON files exist
 *   6. Seed issues reference valid column slugs
 *   7. kanban.defaultColumn references a valid slug
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv } from 'ajv';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(process.cwd(), '../..');
const BUNDLE_ROOT = resolve(REPO_ROOT, 'bundles/aks-feature-kanban');
const SCHEMA_PATH = resolve(process.cwd(), 'src/services/squad-apps/schema.json');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readJson(relPath: string): unknown {
  const abs = resolve(BUNDLE_ROOT, relPath);
  return JSON.parse(readFileSync(abs, 'utf-8'));
}

function bundleFileExists(relPath: string): boolean {
  return existsSync(resolve(BUNDLE_ROOT, relPath));
}

// ---------------------------------------------------------------------------
// Load manifest and schema once
// ---------------------------------------------------------------------------

const manifest = readJson('squadapp.json') as Record<string, unknown>;
const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf-8'));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('aks-feature-kanban Squad App', () => {
  describe('1. JSON Schema validation', () => {
    it('passes draft-07 schema validation', () => {
      const ajv = new Ajv({ allErrors: true, strict: false });
      const validate = ajv.compile(schema);
      const valid = validate(manifest);
      if (!valid) {
        console.error('Schema validation errors:', validate.errors);
      }
      expect(valid).toBe(true);
    });

    it('has schemaVersion === 1', () => {
      expect(manifest.schemaVersion).toBe(1);
    });

    it('has valid SemVer version', () => {
      expect(typeof manifest.version).toBe('string');
      expect((manifest.version as string)).toMatch(
        /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)/
      );
    });

    it('has required top-level fields', () => {
      expect(manifest.appId).toBe('aks-feature-kanban');
      expect(typeof manifest.name).toBe('string');
      expect(typeof manifest.description).toBe('string');
    });
  });

  describe('2. Kanban board', () => {
    it('has exactly 6 columns', () => {
      const kanban = manifest.kanban as { columns: unknown[] };
      expect(kanban.columns).toHaveLength(6);
    });

    it('defaultColumn slug exists in columns', () => {
      const kanban = manifest.kanban as {
        columns: Array<{ slug: string }>;
        defaultColumn: string;
      };
      const slugs = kanban.columns.map((c) => c.slug);
      expect(slugs).toContain(kanban.defaultColumn);
    });

    it('columns have required slugs', () => {
      const kanban = manifest.kanban as { columns: Array<{ slug: string }> };
      const slugs = kanban.columns.map((c) => c.slug);
      expect(slugs).toContain('backlog');
      expect(slugs).toContain('triage');
      expect(slugs).toContain('in-progress');
      expect(slugs).toContain('in-review');
      expect(slugs).toContain('validation');
      expect(slugs).toContain('done');
    });
  });

  describe('3. Team agent charter files', () => {
    it('all charterPath files exist', () => {
      const team = manifest.team as Array<{ name: string; charterPath?: string }>;
      for (const member of team) {
        if (member.charterPath) {
          expect(
            bundleFileExists(member.charterPath),
            `Charter file missing for ${member.name}: ${member.charterPath}`
          ).toBe(true);
        }
      }
    });

    it('has 4 agents', () => {
      const team = manifest.team as unknown[];
      expect(team).toHaveLength(4);
    });
  });

  describe('4. Ceremony workflow files', () => {
    it('all workflowPath files exist', () => {
      const ceremonies = manifest.ceremonies as Array<{
        id: string;
        workflowPath?: string;
      }>;
      for (const ceremony of ceremonies) {
        if (ceremony.workflowPath) {
          expect(
            bundleFileExists(ceremony.workflowPath),
            `Workflow file missing for ceremony ${ceremony.id}: ${ceremony.workflowPath}`
          ).toBe(true);
        }
      }
    });

    it('has 3 ceremonies', () => {
      const ceremonies = manifest.ceremonies as unknown[];
      expect(ceremonies).toHaveLength(3);
    });
  });

  describe('5. Skill SKILL.md files', () => {
    it('aks-customer-signal-collection/SKILL.md exists', () => {
      expect(bundleFileExists('skills/aks-customer-signal-collection/SKILL.md')).toBe(true);
    });

    it('aks-disclosure-quality/SKILL.md exists', () => {
      expect(bundleFileExists('skills/aks-disclosure-quality/SKILL.md')).toBe(true);
    });
  });

  describe('6. Tool JSON files', () => {
    it('tools/aks-cluster-info.json exists', () => {
      expect(bundleFileExists('tools/aks-cluster-info.json')).toBe(true);
    });

    it('aks-cluster-info tool has required fields', () => {
      const tool = readJson('tools/aks-cluster-info.json') as Record<string, unknown>;
      expect(tool.key).toBe('aks-cluster-info');
      expect(typeof tool.name).toBe('string');
      expect(typeof tool.description).toBe('string');
      expect(tool.inputSchema).toBeDefined();
    });
  });

  describe('7. MCP server files', () => {
    it('mcp/azure-mcp.json exists (spec-canonical location)', () => {
      expect(bundleFileExists('mcp/azure-mcp.json')).toBe(true);
    });

    it('mcp-servers/azure-mcp.json exists (extended recipe)', () => {
      expect(bundleFileExists('mcp-servers/azure-mcp.json')).toBe(true);
    });
  });

  describe('8. Seed issues', () => {
    it('issues/seed.json exists', () => {
      expect(bundleFileExists('issues/seed.json')).toBe(true);
    });

    it('has 5 seed issues', () => {
      const issues = readJson('issues/seed.json') as unknown[];
      expect(issues).toHaveLength(5);
    });

    it('all seed issue columns reference valid kanban slugs', () => {
      const kanban = manifest.kanban as { columns: Array<{ slug: string }> };
      const slugs = kanban.columns.map((c) => c.slug);
      const issues = readJson('issues/seed.json') as Array<{
        title: string;
        column?: string;
      }>;
      for (const issue of issues) {
        if (issue.column) {
          expect(
            slugs,
            `Seed issue "${issue.title}" references unknown column "${issue.column}"`
          ).toContain(issue.column);
        }
      }
    });

    it('has 2 bugs, 2 features, 1 chore', () => {
      const issues = readJson('issues/seed.json') as Array<{ labels?: string[] }>;
      const bugs = issues.filter((i) => i.labels?.includes('bug'));
      const features = issues.filter((i) => i.labels?.includes('feature'));
      const chores = issues.filter((i) => i.labels?.includes('chore'));
      expect(bugs).toHaveLength(2);
      expect(features).toHaveLength(2);
      expect(chores).toHaveLength(1);
    });
  });

  describe('9. Supplementary files', () => {
    it('README.md exists', () => {
      expect(bundleFileExists('README.md')).toBe(true);
    });

    it('project.json exists', () => {
      expect(bundleFileExists('project.json')).toBe(true);
    });
  });
});
