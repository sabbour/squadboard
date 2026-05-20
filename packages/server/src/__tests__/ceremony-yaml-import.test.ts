/**
 * ceremony-yaml-import.test.ts — CER-3: unit tests for the ceremony YAML import service.
 *
 * All DB interactions are mocked; tests focus on the pure logic of
 * importCeremonyFromYaml and the origin signal written to triggerConfig.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// DB mock — capture inserts and simulate existing rows
// ---------------------------------------------------------------------------

let existingRows: unknown[] = [];
let insertedRows: { table: string; values: Record<string, unknown> }[] = [];
let updatedRows: { table: string; values: Record<string, unknown> }[] = [];
let returnId = 'new-ceremony-id';

vi.mock('../db/index.js', () => {
  const mockDb = {
    select: vi.fn(() => {
      const chain: Record<string, unknown> = {};
      chain.from = vi.fn(() => chain);
      chain.where = vi.fn(() => chain);
      chain.limit = vi.fn(async () => existingRows.splice(0, 1));
      return chain;
    }),
    insert: vi.fn((table: unknown) => ({
      values: vi.fn((values: Record<string, unknown>) => {
        insertedRows.push({ table: String(table), values });
        return {
          returning: vi.fn().mockResolvedValue([{ id: returnId, ...values }]),
        };
      }),
    })),
    update: vi.fn((table: unknown) => ({
      set: vi.fn((values: Record<string, unknown>) => {
        updatedRows.push({ table: String(table), values });
        return { where: vi.fn().mockResolvedValue([]) };
      }),
    })),
  };

  return {
    getDb: () => mockDb,
    schema: {
      workflows: { id: 'id', slug: 'slug', projectId: 'project_id' },
      workflowVersions: { workflowId: 'workflow_id', isActive: 'is_active', version: 'version' },
    },
  };
});

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col, val) => ({ col, val })),
  and: vi.fn((...args) => ({ and: args })),
}));

// ---------------------------------------------------------------------------
// Import service after mocks
// ---------------------------------------------------------------------------

import { importCeremonyFromYaml } from '../services/ceremony-yaml-import.js';
import { stringifyWorkflowYaml } from '../ceremonies/yaml-canonicalize.js';
import type { WorkflowYaml } from '../ceremonies/types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const validYaml = stringifyWorkflowYaml({
  apiVersion: 'squad.io/v1',
  kind: 'Ceremony',
  metadata: { name: 'design-review', displayName: 'Design Review' },
  spec: {
    trigger: { type: 'manual' },
    steps: [],
  },
} satisfies WorkflowYaml);

const coreBuiltInYaml = stringifyWorkflowYaml({
  apiVersion: 'squad.io/v1',
  kind: 'Ceremony',
  metadata: {
    name: 'work-pickup',
    displayName: 'Work Pickup',
    category: 'core',
    tags: ['core'],
  },
  spec: {
    trigger: { type: 'agent-signal', signalName: 'board.ready' },
    steps: [],
  },
} satisfies WorkflowYaml);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('importCeremonyFromYaml', () => {
  beforeEach(() => {
    existingRows = [];
    insertedRows = [];
    updatedRows = [];
    returnId = 'new-ceremony-id';
  });

  it('new name → INSERT + created=true', async () => {
    // existingRows is empty → no existing ceremony
    const result = await importCeremonyFromYaml(validYaml, 'proj-1');

    expect(result.created).toBe(true);
    expect(result.ceremonyId).toBe('new-ceremony-id');
    expect(insertedRows.length).toBeGreaterThanOrEqual(1); // workflows + workflowVersions
  });

  it('existing name same project → UPDATE + created=false', async () => {
    // Pre-load an existing row
    existingRows = [{ id: 'existing-id', slug: 'design-review', projectId: 'proj-1' }];

    const result = await importCeremonyFromYaml(validYaml, 'proj-1');

    expect(result.created).toBe(false);
    expect(result.ceremonyId).toBe('existing-id');
    expect(updatedRows.length).toBeGreaterThan(0);
  });

  it('same name different project → INSERT + different id', async () => {
    returnId = 'proj-2-ceremony-id';
    // existingRows is empty for this projectId
    const result = await importCeremonyFromYaml(validYaml, 'proj-2');

    expect(result.created).toBe(true);
    expect(result.ceremonyId).toBe('proj-2-ceremony-id');
  });

  it('invalid YAML throws with descriptive error path', async () => {
    const badYaml = `apiVersion: squad.io/v1
kind: Ceremony
metadata:
  name: test
spec:
  trigger:
    type: not-a-valid-trigger-type
  steps: []
`;
    await expect(importCeremonyFromYaml(badYaml, 'proj-1')).rejects.toThrow(/Invalid workflow YAML/);
  });

  it('sourceYamlPath is stored in triggerConfig for origin derivation', async () => {
    await importCeremonyFromYaml(validYaml, 'proj-1');

    const workflowInsert = insertedRows.find((r) =>
      r.values.slug === 'design-review',
    );
    expect(workflowInsert).toBeDefined();
    const triggerConfig = workflowInsert!.values.triggerConfig as Record<string, unknown>;
    expect(triggerConfig.sourceYamlPath).toBe('import:design-review');
  });

  it('metadata category and tags are stored in triggerConfig when seeding core built-ins', async () => {
    await importCeremonyFromYaml(coreBuiltInYaml, 'proj-1', {
      sourceMarker: 'import:built-in/work-pickup',
    });

    const workflowInsert = insertedRows.find((r) =>
      r.values.slug === 'work-pickup',
    );
    expect(workflowInsert).toBeDefined();
    const triggerConfig = workflowInsert!.values.triggerConfig as Record<string, unknown>;
    expect(triggerConfig.sourceYamlPath).toBe('import:built-in/work-pickup');
    expect(triggerConfig.category).toBe('core');
    expect(triggerConfig.tags).toEqual(['core']);

    const versionInsert = insertedRows.find((r) => r.values.yamlContent);
    const storedYaml = versionInsert?.values.yamlContent as string | undefined;
    expect(storedYaml).toBeDefined();
    const { parseWorkflowYaml } = await import('../ceremonies/yaml-canonicalize.js');
    const stored = parseWorkflowYaml(storedYaml!);
    expect(stored.metadata.category).toBe('core');
    expect(stored.metadata.tags).toEqual(['core']);
  });

  it('imported then exported = same YAML (round-trip fidelity)', async () => {
    await importCeremonyFromYaml(validYaml, 'proj-1');

    // The canonical YAML inserted into workflowVersions should match the input
    const versionInsert = insertedRows.find((r) => r.values.yamlContent);
    const storedYaml = versionInsert?.values.yamlContent as string | undefined;

    expect(storedYaml).toBeDefined();
    // Both the original and stored yaml parse to the same structure
    const { parseWorkflowYaml } = await import('../ceremonies/yaml-canonicalize.js');
    const original = parseWorkflowYaml(validYaml);
    const stored = parseWorkflowYaml(storedYaml!);
    expect(stored.metadata.name).toBe(original.metadata.name);
    expect(stored.spec.trigger.type).toBe(original.spec.trigger.type);
  });
});
