/**
 * ceremony-yaml-export.test.ts — CER-3: unit tests for the ceremony YAML export service.
 *
 * Tests ceremonyRowToWorkflowYaml (pure, no DB) and exportCeremonyAsYaml (DB-mocked).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// DB mock — set up before importing the service
// ---------------------------------------------------------------------------

let mockWorkflowRows: unknown[] = [];
let mockVersionRows: unknown[] = [];

vi.mock('../db/index.js', () => {
  const selectChain = () => {
    const chain: Record<string, unknown> = {};
    chain.from = vi.fn(() => chain);
    chain.where = vi.fn(() => chain);
    chain.limit = vi.fn(async () => {
      // First call → workflows table; second call → workflowVersions
      return mockWorkflowRows.length > 0
        ? mockWorkflowRows.splice(0, 1)
        : mockVersionRows.splice(0, 1);
    });
    return chain;
  };
  const mockDb = { select: vi.fn(selectChain) };
  return {
    getDb: () => mockDb,
    schema: {
      workflows: { id: 'id', projectId: 'project_id' },
      workflowVersions: { workflowId: 'workflow_id', isActive: 'is_active' },
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

import { ceremonyRowToWorkflowYaml } from '../services/ceremony-yaml-export.js';
import { stringifyWorkflowYaml, parseWorkflowYaml } from '../ceremonies/yaml-canonicalize.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'row-id-1',
    projectId: 'proj-1',
    name: 'Design Review',
    slug: 'design-review',
    description: 'Reviews PRs touching design.md',
    triggerKind: 'on_event',
    triggerConfig: { event: 'pull_request', filters: { labels: ['design'] }, sourceYamlPath: 'import:design-review' },
    kind: 'ceremony',
    status: 'active',
    parentNarrativeId: null,
    lastTranslationError: null,
    lastTranslationAttemptAt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests — ceremonyRowToWorkflowYaml (pure function)
// ---------------------------------------------------------------------------

describe('ceremonyRowToWorkflowYaml', () => {
  it('maps DB row to WorkflowYaml shape correctly', () => {
    const row = makeRow();
    const wf = ceremonyRowToWorkflowYaml(row as Parameters<typeof ceremonyRowToWorkflowYaml>[0]);

    expect(wf.apiVersion).toBe('squad.io/v1');
    expect(wf.kind).toBe('Ceremony');
    expect(wf.metadata.name).toBe('design-review');
    expect(wf.metadata.displayName).toBe('Design Review');
    expect(wf.metadata.description).toBe('Reviews PRs touching design.md');
    expect(wf.spec.trigger.type).toBe('github-event');
  });

  it('derived fields (origin, createdAt, id) excluded from YAML output', () => {
    const row = makeRow();
    const wf = ceremonyRowToWorkflowYaml(row as Parameters<typeof ceremonyRowToWorkflowYaml>[0]);
    const yaml = stringifyWorkflowYaml(wf);

    expect(yaml).not.toContain('createdAt');
    expect(yaml).not.toContain('row-id-1');
    expect(yaml).not.toContain('origin');
    expect(yaml).not.toContain('parentNarrativeId');
  });

  it('empty steps array from null yamlContent yields steps: []', () => {
    const row = makeRow({ triggerKind: 'manual', triggerConfig: {} });
    const wf = ceremonyRowToWorkflowYaml(
      row as Parameters<typeof ceremonyRowToWorkflowYaml>[0],
      null,
    );
    expect(wf.spec.steps).toEqual([]);
    const yaml = stringifyWorkflowYaml(wf);
    expect(yaml).toContain('steps:');
  });

  it('round trip: row → YAML → re-parse → matches original (modulo derived fields)', () => {
    const row = makeRow();
    const wf = ceremonyRowToWorkflowYaml(row as Parameters<typeof ceremonyRowToWorkflowYaml>[0]);
    const yaml = stringifyWorkflowYaml(wf);
    const reparsed = parseWorkflowYaml(yaml);

    expect(reparsed.metadata.name).toBe(row.slug);
    expect(reparsed.metadata.displayName).toBe(row.name);
    expect(reparsed.spec.trigger.type).toBe('github-event');
  });

  it('preserves core category and tags from active YAML metadata', () => {
    const activeYaml = stringifyWorkflowYaml({
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
    });
    const row = makeRow({
      slug: 'work-pickup',
      name: 'Work Pickup',
      triggerKind: 'agent-signal',
      triggerConfig: { signalName: 'board.ready', sourceYamlPath: 'import:built-in/work-pickup' },
    });

    const wf = ceremonyRowToWorkflowYaml(
      row as Parameters<typeof ceremonyRowToWorkflowYaml>[0],
      activeYaml,
    );

    expect(wf.metadata.category).toBe('core');
    expect(wf.metadata.tags).toEqual(['core']);
  });

  it('falls back to triggerConfig core metadata when active YAML predates tags', () => {
    const row = makeRow({
      slug: 'scribe-close-out',
      name: 'Scribe Close-Out',
      triggerKind: 'agent-signal',
      triggerConfig: {
        signalName: 'wave.closeout',
        sourceYamlPath: 'import:built-in/scribe-close-out',
        category: 'core',
        tags: ['core'],
      },
    });

    const wf = ceremonyRowToWorkflowYaml(
      row as Parameters<typeof ceremonyRowToWorkflowYaml>[0],
      null,
    );

    expect(wf.metadata.category).toBe('core');
    expect(wf.metadata.tags).toEqual(['core']);
  });

  it('multiple ceremonies in one project export independently', () => {
    const row1 = makeRow({ slug: 'retro', name: 'Retrospective', triggerKind: 'on_schedule', triggerConfig: { schedule: '0 9 * * 5' } });
    const row2 = makeRow({ slug: 'design-review', name: 'Design Review', triggerKind: 'on_event', triggerConfig: { event: 'pull_request' } });

    const wf1 = ceremonyRowToWorkflowYaml(row1 as Parameters<typeof ceremonyRowToWorkflowYaml>[0]);
    const wf2 = ceremonyRowToWorkflowYaml(row2 as Parameters<typeof ceremonyRowToWorkflowYaml>[0]);

    expect(wf1.metadata.name).toBe('retro');
    expect(wf1.spec.trigger.type).toBe('cron');
    expect(wf2.metadata.name).toBe('design-review');
    expect(wf2.spec.trigger.type).toBe('github-event');
  });
});

// ---------------------------------------------------------------------------
// Tests — exportCeremonyAsYaml (DB interaction, simple path tested)
// ---------------------------------------------------------------------------

describe('exportCeremonyAsYaml', () => {
  beforeEach(() => {
    mockWorkflowRows = [];
    mockVersionRows = [];
  });

  it('throws 404-style error on unknown ceremony id', async () => {
    // mockWorkflowRows is empty → row not found
    const { exportCeremonyAsYaml } = await import('../services/ceremony-yaml-export.js');
    await expect(exportCeremonyAsYaml('non-existent-id')).rejects.toThrow('Ceremony not found');
  });
});
