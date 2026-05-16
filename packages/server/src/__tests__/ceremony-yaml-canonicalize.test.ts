/**
 * ceremony-yaml-canonicalize.test.ts — CER-3: unit tests for the
 * yaml-canonicalize serializer/parser pair.
 */

import { describe, it, expect } from 'vitest';
import {
  stringifyWorkflowYaml,
  parseWorkflowYaml,
  safeParseWorkflowYaml,
  roundtrip,
} from '../ceremonies/yaml-canonicalize.js';
import type { WorkflowYaml } from '../ceremonies/types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const minimalWorkflow: WorkflowYaml = {
  apiVersion: 'squad.io/v1',
  kind: 'Ceremony',
  metadata: { name: 'design-review' },
  spec: {
    trigger: { type: 'manual' },
    steps: [],
  },
};

const fullWorkflow: WorkflowYaml = {
  apiVersion: 'squad.io/v1',
  kind: 'Ceremony',
  metadata: {
    name: 'design-review',
    displayName: 'Design Review',
    description: 'Reviews PRs touching design.md',
  },
  spec: {
    trigger: {
      type: 'github-event',
      event: 'pull_request',
      filters: {
        labels: ['design'],
        paths: ['**/*.md'],
      },
    },
    steps: [
      {
        id: 'collect-context',
        kind: 'agent-task',
        agent: 'jude',
        prompt: 'Read the diff and summarize...',
      },
      {
        id: 'hand-off',
        kind: 'notify',
        target: '#design-channel',
      },
    ],
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('stringifyWorkflowYaml', () => {
  it('minimal WorkflowYaml stringifies and round-trips', () => {
    const yaml = stringifyWorkflowYaml(minimalWorkflow);
    const reparsed = parseWorkflowYaml(yaml);
    expect(reparsed.apiVersion).toBe('squad.io/v1');
    expect(reparsed.kind).toBe('Ceremony');
    expect(reparsed.metadata.name).toBe('design-review');
    expect(reparsed.spec.steps).toEqual([]);
  });

  it('all trigger.type values stringify+parse correctly', () => {
    const triggers: WorkflowYaml['spec']['trigger'][] = [
      { type: 'manual' },
      { type: 'agent-signal' },
      { type: 'cron', schedule: '0 9 * * 1' },
      { type: 'github-event', event: 'push' },
    ];

    for (const trigger of triggers) {
      const wf: WorkflowYaml = { ...minimalWorkflow, spec: { ...minimalWorkflow.spec, trigger } };
      const yaml = stringifyWorkflowYaml(wf);
      const reparsed = parseWorkflowYaml(yaml);
      expect(reparsed.spec.trigger.type).toBe(trigger.type);
    }
  });

  it('key ordering: apiVersion first, then kind, metadata, spec', () => {
    const yaml = stringifyWorkflowYaml(fullWorkflow);
    const keys = yaml
      .split('\n')
      .filter((l) => /^[a-zA-Z]/.test(l))
      .map((l) => l.split(':')[0].trim());

    const apiIdx = keys.indexOf('apiVersion');
    const kindIdx = keys.indexOf('kind');
    const metaIdx = keys.indexOf('metadata');
    const specIdx = keys.indexOf('spec');

    expect(apiIdx).toBeLessThan(kindIdx);
    expect(kindIdx).toBeLessThan(metaIdx);
    expect(metaIdx).toBeLessThan(specIdx);
  });

  it('uses 2-space indentation', () => {
    const yaml = stringifyWorkflowYaml(fullWorkflow);
    // Lines indented at exactly 2 spaces (first level nested keys)
    const metaChildren = yaml
      .split('\n')
      .filter((l) => l.startsWith('  name:') || l.startsWith('  displayName:'));
    expect(metaChildren.length).toBeGreaterThan(0);
  });

  it('LF (not CRLF) line endings on output', () => {
    const yaml = stringifyWorkflowYaml(fullWorkflow);
    expect(yaml).not.toContain('\r\n');
    expect(yaml).not.toContain('\r');
  });

  it('multiline prompt uses | block style on emit', () => {
    const wf: WorkflowYaml = {
      ...minimalWorkflow,
      spec: {
        trigger: { type: 'manual' },
        steps: [
          {
            id: 'step-1',
            kind: 'agent-task',
            agent: 'jude',
            prompt: 'Line one\nLine two\nLine three',
          },
        ],
      },
    };
    const yaml = stringifyWorkflowYaml(wf);
    expect(yaml).toContain('|');
    expect(yaml).toContain('Line one');
    expect(yaml).toContain('Line two');
  });

  it('empty steps array yields steps: [] (not omitted)', () => {
    const yaml = stringifyWorkflowYaml(minimalWorkflow);
    expect(yaml).toContain('steps:');
  });

  it('steps array order is preserved', () => {
    const yaml = stringifyWorkflowYaml(fullWorkflow);
    const collectIdx = yaml.indexOf('collect-context');
    const handOffIdx = yaml.indexOf('hand-off');
    expect(collectIdx).toBeLessThan(handOffIdx);
  });
});

describe('parseWorkflowYaml', () => {
  it('schema rejects event field when type=manual', () => {
    const yaml = `apiVersion: squad.io/v1
kind: Ceremony
metadata:
  name: test
spec:
  trigger:
    type: manual
    event: push
  steps: []
`;
    expect(() => parseWorkflowYaml(yaml)).toThrow();
  });

  it('schema rejects schedule when type=github-event', () => {
    const yaml = `apiVersion: squad.io/v1
kind: Ceremony
metadata:
  name: test
spec:
  trigger:
    type: github-event
    event: push
    schedule: "0 9 * * 1"
  steps: []
`;
    expect(() => parseWorkflowYaml(yaml)).toThrow();
  });

  it('rejects unknown root key with .strict()', () => {
    const yaml = `apiVersion: squad.io/v1
kind: Ceremony
metadata:
  name: test
spec:
  trigger:
    type: manual
  steps: []
unknownRootKey: value
`;
    expect(() => parseWorkflowYaml(yaml)).toThrow();
  });

  it('rejects unknown spec key with .strict()', () => {
    const yaml = `apiVersion: squad.io/v1
kind: Ceremony
metadata:
  name: test
spec:
  trigger:
    type: manual
  steps: []
  unknownSpecKey: value
`;
    expect(() => parseWorkflowYaml(yaml)).toThrow();
  });

  it('invalid trigger.type rejected with descriptive error including path', () => {
    const yaml = `apiVersion: squad.io/v1
kind: Ceremony
metadata:
  name: test
spec:
  trigger:
    type: invalid-type
  steps: []
`;
    expect(() => parseWorkflowYaml(yaml)).toThrow(/spec\.trigger/);
  });
});

describe('roundtrip', () => {
  it('round-trip stability: stringify(parse(stringify(x))) === stringify(parse(x))', () => {
    const first = stringifyWorkflowYaml(fullWorkflow);
    const second = roundtrip(first);
    const third = roundtrip(second);
    expect(third).toBe(second);
  });

  it('roundtrip of full workflow matches expected shape', () => {
    const yaml = stringifyWorkflowYaml(fullWorkflow);
    const reparsed = parseWorkflowYaml(yaml);
    expect(reparsed.metadata.name).toBe('design-review');
    expect(reparsed.metadata.displayName).toBe('Design Review');
    expect(reparsed.spec.trigger.type).toBe('github-event');
    expect(reparsed.spec.steps).toHaveLength(2);
    expect(reparsed.spec.steps[0].id).toBe('collect-context');
  });
});

describe('safeParseWorkflowYaml', () => {
  it('returns success=true for valid YAML', () => {
    const yaml = stringifyWorkflowYaml(minimalWorkflow);
    const result = safeParseWorkflowYaml(yaml);
    expect(result.success).toBe(true);
  });

  it('returns success=false with error for invalid YAML syntax', () => {
    const result = safeParseWorkflowYaml('{unclosed: {{{');
    expect(result.success).toBe(false);
  });

  it('returns success=false for schema violation', () => {
    const result = safeParseWorkflowYaml(`apiVersion: squad.io/v1
kind: Ceremony
metadata:
  name: test
spec:
  trigger:
    type: not-a-valid-trigger-type
  steps: []
`);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.length).toBeGreaterThan(0);
    }
  });
});
