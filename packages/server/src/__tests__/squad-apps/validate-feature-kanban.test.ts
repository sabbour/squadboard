/**
 * Validates the generalized Feature Kanban built-in project template.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { Ajv } from 'ajv';

const REPO_ROOT = resolve(process.cwd(), '../..');
const BUNDLE_ROOT = resolve(REPO_ROOT, 'bundles/feature-kanban');
const SCHEMA_PATH = resolve(process.cwd(), 'src/services/squad-apps/schema.json');
const FORBIDDEN_TERMS = /\b(aks|azure|kubernetes|k8s|workiq|icm|kusto|microsoft)\b|support[-\s]?group/i;

function readJson(relPath: string): unknown {
  const abs = resolve(BUNDLE_ROOT, relPath);
  return JSON.parse(readFileSync(abs, 'utf-8'));
}

function bundleFileExists(relPath: string): boolean {
  return existsSync(resolve(BUNDLE_ROOT, relPath));
}

function collectTextFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    const stat = statSync(abs);
    if (stat.isDirectory()) {
      files.push(...collectTextFiles(abs));
    } else if (/\.(json|md|ya?ml)$/i.test(entry)) {
      files.push(abs);
    }
  }
  return files;
}

const manifest = readJson('squadapp.json') as Record<string, unknown>;
const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf-8'));

describe('feature-kanban project template', () => {
  describe('manifest schema and identity', () => {
    it('passes draft-07 schema validation', () => {
      const ajv = new Ajv({ allErrors: true, strict: false });
      const validate = ajv.compile(schema);
      const valid = validate(manifest);
      if (!valid) {
        console.error('Schema validation errors:', validate.errors);
      }
      expect(valid).toBe(true);
    });

    it('uses the generic Feature Kanban identity', () => {
      expect(manifest.schemaVersion).toBe(1);
      expect(manifest.appId).toBe('feature-kanban');
      expect(manifest.name).toBe('Feature Kanban');
      expect(manifest.displayName).toBe('Feature Kanban');
      expect(typeof manifest.description).toBe('string');
    });
  });

  describe('PM feature workflow shape', () => {
    it('has the expected feature workflow columns', () => {
      const kanban = manifest.kanban as { columns: Array<{ slug: string }>; defaultColumn: string };
      expect(kanban.columns.map((c) => c.slug)).toEqual([
        'backlog',
        'in-progress',
        'review',
        'done',
      ]);
      expect(kanban.defaultColumn).toBe('backlog');
    });

    it('has generic product team agents', () => {
      const team = manifest.team as Array<{ name: string; charterPath?: string }>;
      expect(team.map((member) => member.name)).toEqual([
        'ProductManager',
        'ProductResearcher',
        'PrototypeDesigner',
        'DocsWriter',
        'QualityReviewer',
      ]);
      for (const member of team) {
        expect(bundleFileExists(member.charterPath!), `Missing charter for ${member.name}`).toBe(true);
      }
    });

    it('includes reusable PM skills and wires ceremonies to them', () => {
      const skills = manifest.skills as Array<{ key: string }>;
      expect(skills.map((skill) => skill.key)).toEqual([
        'customer-research',
        'prd-writing',
        'prototype-creation',
        'feature-naming',
        'feature-disclosure',
        'feature-docs',
      ]);
      for (const skill of skills) {
        expect(bundleFileExists(`skills/${skill.key}/SKILL.md`), `Missing skill ${skill.key}`).toBe(true);
      }

      const bundle = readJson('squad-bundle.json') as {
        skills: Array<{ key: string; bodyPath?: string; promptAddendum?: string }>;
      };
      expect(bundle.skills.map((skill) => skill.key)).toEqual(skills.map((skill) => skill.key));
      for (const skill of bundle.skills) {
        expect(skill.bodyPath).toBe(`skills/${skill.key}/SKILL.md`);
        expect(skill).not.toHaveProperty('promptAddendum');
      }

      const ceremonyText = (manifest.ceremonies as Array<{ workflowPath: string }>)
        .map((ceremony) => readFileSync(resolve(BUNDLE_ROOT, ceremony.workflowPath), 'utf-8'))
        .join('\n');
      for (const skill of skills) {
        expect(ceremonyText).toContain(`\`${skill.key}\``);
      }
    });

    it('does not include domain-specific tools or MCP servers', () => {
      expect(manifest.tools ?? []).toEqual([]);
      expect(manifest.mcpServers ?? []).toEqual([]);
      const artifacts = manifest.artifacts as Record<string, unknown[]>;
      expect(artifacts.tools ?? []).toEqual([]);
      expect(artifacts.mcpServers ?? []).toEqual([]);
    });
  });

  describe('seed issues', () => {
    it('has generic product seed issues in valid columns', () => {
      const kanban = manifest.kanban as { columns: Array<{ slug: string }> };
      const slugs = new Set(kanban.columns.map((c) => c.slug));
      const issues = readJson('issues/seed.json') as Array<{ title: string; labels?: string[]; column?: string }>;

      expect(issues).toHaveLength(5);
      for (const issue of issues) {
        expect(issue.title).not.toMatch(FORBIDDEN_TERMS);
        if (issue.column) expect(slugs.has(issue.column)).toBe(true);
      }
    });
  });

  describe('generic language contract', () => {
    it('contains no AKS, cloud-provider, Kubernetes, Microsoft, or internal-tool references', () => {
      for (const file of collectTextFiles(BUNDLE_ROOT)) {
        const text = readFileSync(file, 'utf-8');
        expect(text, `${relative(BUNDLE_ROOT, file)} contains forbidden product/internal language`).not.toMatch(FORBIDDEN_TERMS);
      }
    });
  });
});
