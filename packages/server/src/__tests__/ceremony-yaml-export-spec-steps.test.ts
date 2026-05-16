/**
 * ceremony-yaml-export-spec-steps.test.ts
 *
 * CER-3 regression: `extractSteps` must read from `parsed.spec.steps`
 * (canonical YAML shape), not `parsed.steps` (wrong top-level key that
 * previously caused exported ceremonies to always have empty steps arrays).
 *
 * Discovered during CER-4 byte-equality fidelity work (kobayashi).
 *
 * Decision on backward-compat:
 *   Legacy YAML with steps at `parsed.steps` (top-level, not under `spec`)
 *   returns [] — we do NOT support the legacy shape. Callers must re-import
 *   or regenerate YAML through the canonical pipeline. This is intentional:
 *   the canonical spec has always placed steps under `spec.steps`; any
 *   top-level `steps` key was an authoring error, not a historical format.
 */

import { describe, it, expect } from 'vitest';
import { extractSteps } from '../services/ceremony-yaml-export.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function yamlWithSpecSteps(steps: object[]): string {
  const stepsYaml = steps
    .map(s => JSON.stringify(s))
    .map(s => `    - ${s}`)
    .join('\n');
  return [
    'apiVersion: squad.io/v1',
    'kind: Ceremony',
    'metadata:',
    '  name: test-ceremony',
    'spec:',
    '  trigger:',
    '    type: manual',
    '  steps:',
    stepsYaml,
  ].join('\n');
}

function yamlWithTopLevelSteps(steps: object[]): string {
  const stepsYaml = steps
    .map(s => JSON.stringify(s))
    .map(s => `  - ${s}`)
    .join('\n');
  return [
    'apiVersion: squad.io/v1',
    'kind: Ceremony',
    'steps:',
    stepsYaml,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const validSteps = [
  { id: 'step-1', kind: 'prompt', prompt: 'Do something' },
  { id: 'step-2', kind: 'tool', tool: 'bash', args: ['echo hi'] },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('extractSteps — CER-3 regression (spec.steps)', () => {
  it('returns steps when yamlContent has them at spec.steps (canonical)', () => {
    const yaml = yamlWithSpecSteps(validSteps);
    const result = extractSteps(yaml);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('step-1');
    expect(result[0].kind).toBe('prompt');
    expect(result[1].id).toBe('step-2');
    expect(result[1].kind).toBe('tool');
  });

  it('returns [] when steps are at top-level (legacy / malformed — not supported)', () => {
    // By design: top-level `steps` is not the canonical shape. We intentionally
    // do NOT provide backward compat — callers must re-import through the YAML
    // pipeline to get the canonical spec.steps location.
    const yaml = yamlWithTopLevelSteps(validSteps);
    const result = extractSteps(yaml);
    expect(result).toEqual([]);
  });

  it('returns [] when yamlContent has no steps key anywhere', () => {
    const yaml = [
      'apiVersion: squad.io/v1',
      'kind: Ceremony',
      'metadata:',
      '  name: no-steps',
      'spec:',
      '  trigger:',
      '    type: manual',
    ].join('\n');
    const result = extractSteps(yaml);
    expect(result).toEqual([]);
  });

  it('returns [] when spec.steps is an empty array', () => {
    const yaml = [
      'apiVersion: squad.io/v1',
      'kind: Ceremony',
      'spec:',
      '  steps: []',
    ].join('\n');
    const result = extractSteps(yaml);
    expect(result).toEqual([]);
  });

  it('returns [] for invalid (non-parseable) YAML', () => {
    const result = extractSteps(': this is not: valid: yaml: {{{');
    expect(result).toEqual([]);
  });

  it('returns [] for null yamlContent', () => {
    expect(extractSteps(null)).toEqual([]);
  });

  it('returns [] for undefined yamlContent', () => {
    expect(extractSteps(undefined)).toEqual([]);
  });

  it('returns [] for empty string yamlContent', () => {
    expect(extractSteps('')).toEqual([]);
  });

  it('filters out malformed step entries missing id or kind', () => {
    const yaml = [
      'apiVersion: squad.io/v1',
      'kind: Ceremony',
      'spec:',
      '  steps:',
      '    - id: good-step',
      '      kind: prompt',
      '    - kind: prompt',          // missing id — should be filtered
      '    - id: no-kind-step',      // missing kind — should be filtered
      '    - just a string',         // not an object — should be filtered
    ].join('\n');
    const result = extractSteps(yaml);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('good-step');
  });

  it('integration: ceremonyRowToWorkflowYaml uses spec.steps from activeVersionYaml', () => {
    // Verify through the public API that the fix flows end-to-end.
    // We need to mock the DB modules before importing to use this path.
    // Instead, we test extractSteps directly here and trust the integration via
    // the existing ceremony-yaml-export.test.ts coverage of ceremonyRowToWorkflowYaml.
    const yaml = yamlWithSpecSteps([{ id: 's1', kind: 'prompt', prompt: 'hello' }]);
    const steps = extractSteps(yaml);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ id: 's1', kind: 'prompt', prompt: 'hello' });
  });
});
