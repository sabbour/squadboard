/**
 * project-template-ceremonies.test.ts — CER-9
 *
 * Tests that project-template export/import correctly handles canonical
 * CER-3 YAML (apiVersion: squad.io/v1) and legacy yamlContent.
 *
 * 1. Export: ceremony is emitted as canonical CER-3 YAML (roundtrip)
 * 2. Import: bundle with CER-3 yamlContent → importCeremonyFromYaml called
 * 3. Import: bundle with legacy yamlContent → raw SQL insert (backward compat)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CeremonyBundle, ProjectPayload } from '../services/templates/project-template.js';

// ---------------------------------------------------------------------------
// Hoist shared constants and mutable state before vi.mock factories
// ---------------------------------------------------------------------------

const { CANONICAL_YAML, importCalls, insertedWorkflows, insertedVersions } = vi.hoisted(() => {
  const CANONICAL_YAML = `apiVersion: squad.io/v1
kind: Ceremony
metadata:
  name: design-review
  displayName: Design Review
  description: Reviews PRs touching design.md
spec:
  trigger:
    type: github-event
    event: pull_request
  steps: []
`;
  const importCalls: { yamlText: string; projectId: string }[] = [];
  const insertedWorkflows: Record<string, unknown>[] = [];
  const insertedVersions: Record<string, unknown>[] = [];
  return { CANONICAL_YAML, importCalls, insertedWorkflows, insertedVersions };
});

// ---------------------------------------------------------------------------
// DB mock
// ---------------------------------------------------------------------------

vi.mock('../db/index.js', () => {
  return {
    getDb: () => ({
      select: vi.fn(() => {
        const chain: Record<string, unknown> = {};
        chain.from = vi.fn(() => chain);
        chain.where = vi.fn(() => chain);
        chain.orderBy = vi.fn(() => chain);
        chain.limit = vi.fn(async () => []);
        return chain;
      }),
      insert: vi.fn(() => ({
        values: vi.fn((vals: Record<string, unknown>) => ({
          returning: vi.fn().mockResolvedValue([{ id: 'inserted-ceremony-id', ...vals }]),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })),
      })),
    }),
    getPool: () => ({
      connect: vi.fn().mockResolvedValue({
        query: vi.fn(async (sql: string, params?: unknown[]) => {
          if (sql.trim().startsWith('INSERT INTO workflows')) {
            insertedWorkflows.push({ sql, params });
            return { rows: [{ id: 'legacy-ceremony-id' }] };
          }
          if (sql.trim().startsWith('INSERT INTO workflow_versions')) {
            insertedVersions.push({ sql, params });
            return { rows: [] };
          }
          if (sql.trim().startsWith('INSERT INTO projects')) {
            return { rows: [{ id: 'project-001' }] };
          }
          return { rows: [] };
        }),
        release: vi.fn(),
      }),
    }),
    schema: {
      projects: {},
      workflows: { id: 'id', projectId: 'project_id', slug: 'slug' },
      workflowVersions: { workflowId: 'workflow_id', isActive: 'is_active', version: 'version' },
      agents: {}, agentSkills: {}, skills: {}, agentTools: {}, tools: {},
      agentMcpServers: {}, mcpServers: {}, labels: {}, columnMeta: {}, routingRules: {},
    },
  };
});

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col, val) => ({ col, val })),
  and: vi.fn((...args) => ({ and: args })),
  desc: vi.fn((col) => ({ desc: col })),
}));

// ---------------------------------------------------------------------------
// Mock exportCeremonyAsYaml to return canonical YAML
// ---------------------------------------------------------------------------

vi.mock('../services/ceremony-yaml-export.js', () => ({
  exportCeremonyAsYaml: vi.fn().mockResolvedValue(CANONICAL_YAML),
}));

// ---------------------------------------------------------------------------
// Mock importCeremonyFromYaml to track calls
// ---------------------------------------------------------------------------

vi.mock('../services/ceremony-yaml-import.js', () => ({
  importCeremonyFromYaml: vi.fn(async (yamlText: string, projectId: string) => {
    importCalls.push({ yamlText, projectId });
    return { ceremonyId: 'imported-cer-id', created: true };
  }),
}));

vi.mock('../charter-compiler.js', () => ({
  computeCharterHash: vi.fn().mockResolvedValue('abc123'),
}));

vi.mock('./template-storage.js', () => ({
  writeTemplateMirror: vi.fn().mockResolvedValue({ storagePath: null, error: null }),
}));

vi.mock('node:fs/promises', () => ({
  default: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue('# Charter content'),
    writeFile: vi.fn().mockResolvedValue(undefined),
  },
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { importProject } from '../services/templates/project-template.js';
import { exportCeremonyAsYaml } from '../services/ceremony-yaml-export.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMinimalPayload(ceremonies: CeremonyBundle[]): ProjectPayload {
  return {
    meta: { name: 'Test Project', defaultModel: null },
    agents: [],
    ceremonies,
    labels: [],
    columnMeta: [],
    skills: [],
    tools: [],
    mcpServers: [],
    routingRules: [],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('project-template export — ceremony CER-3 YAML', () => {
  it('exportCeremonyAsYaml mock returns canonical YAML with apiVersion', async () => {
    const yaml = await exportCeremonyAsYaml('cer-id-1');
    expect(yaml).toContain('apiVersion: squad.io/v1');
    expect(yaml).toContain('kind: Ceremony');
    expect(yaml).toContain('design-review');
  });

  it('canonical YAML round-trips through parseWorkflowYaml', async () => {
    const { parseWorkflowYaml, stringifyWorkflowYaml } = await import('../ceremonies/yaml-canonicalize.js');
    const parsed = parseWorkflowYaml(CANONICAL_YAML);
    const reEmitted = stringifyWorkflowYaml(parsed);
    const reParsed = parseWorkflowYaml(reEmitted);
    expect(reParsed.metadata.name).toBe('design-review');
    expect(reParsed.metadata.displayName).toBe('Design Review');
    expect(reParsed.spec.trigger.type).toBe('github-event');
  });
});

describe('project-template import — canonical CER-3 yamlContent', () => {
  beforeEach(() => {
    importCalls.length = 0;
    insertedWorkflows.length = 0;
    insertedVersions.length = 0;
  });

  it('calls importCeremonyFromYaml for canonical YAML bundles', async () => {
    const payload = makeMinimalPayload([
      {
        name: 'Design Review',
        slug: 'design-review',
        description: null,
        triggerKind: 'on_event',
        triggerConfig: {},
        kind: 'ceremony',
        yamlContent: CANONICAL_YAML,
      },
    ]);

    const projectId = await importProject(payload, 'New Project', '/squads/new');
    expect(projectId).toBe('project-001');
    expect(importCalls).toHaveLength(1);
    expect(importCalls[0].projectId).toBe('project-001');
    expect(importCalls[0].yamlText).toContain('apiVersion: squad.io/v1');
    // Should NOT have gone through raw SQL insert
    expect(insertedWorkflows).toHaveLength(0);
  });

  it('does NOT call importCeremonyFromYaml for legacy yamlContent', async () => {
    const payload = makeMinimalPayload([
      {
        name: 'Old Ceremony',
        slug: 'old-ceremony',
        description: null,
        triggerKind: 'manual',
        triggerConfig: {},
        kind: 'ceremony',
        yamlContent: '# legacy content without apiVersion header',
      },
    ]);

    const projectId = await importProject(payload, 'New Project', '/squads/legacy');
    expect(projectId).toBe('project-001');
    expect(importCalls).toHaveLength(0);
    // Should have gone through raw SQL insert
    expect(insertedWorkflows).toHaveLength(1);
    expect(insertedVersions).toHaveLength(1);
  });

  it('skips ceremonies with null yamlContent', async () => {
    const payload = makeMinimalPayload([
      {
        name: 'Empty Ceremony',
        slug: 'empty-ceremony',
        description: null,
        triggerKind: 'manual',
        triggerConfig: {},
        kind: 'ceremony',
        yamlContent: null,
      },
    ]);

    const projectId = await importProject(payload, 'New Project', '/squads/empty');
    expect(projectId).toBe('project-001');
    expect(importCalls).toHaveLength(0);
    expect(insertedWorkflows).toHaveLength(0);
  });

  it('handles mixed canonical + legacy ceremonies in one payload', async () => {
    const payload = makeMinimalPayload([
      {
        name: 'Design Review',
        slug: 'design-review',
        description: null,
        triggerKind: 'on_event',
        triggerConfig: {},
        kind: 'ceremony',
        yamlContent: CANONICAL_YAML,
      },
      {
        name: 'Old Ceremony',
        slug: 'old-ceremony',
        description: null,
        triggerKind: 'manual',
        triggerConfig: {},
        kind: 'ceremony',
        yamlContent: '# legacy format',
      },
    ]);

    const projectId = await importProject(payload, 'Mixed Project', '/squads/mixed');
    expect(projectId).toBe('project-001');
    // Canonical goes through importCeremonyFromYaml
    expect(importCalls).toHaveLength(1);
    // Legacy goes through raw SQL
    expect(insertedWorkflows).toHaveLength(1);
  });
});

