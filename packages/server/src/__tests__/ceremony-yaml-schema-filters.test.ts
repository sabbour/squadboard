/**
 * ceremony-yaml-schema-filters.test.ts — CER-5 (W29): Zod schema validation
 * tests for the new github-event trigger filter fields.
 */

import { describe, it, expect } from 'vitest';
import { githubEventFiltersSchema } from '../ceremonies/yaml-schema.js';
import { parseWorkflowYaml, roundtrip, stringifyWorkflowYaml } from '../ceremonies/yaml-canonicalize.js';
import type { WorkflowYaml } from '../ceremonies/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseFilters(input: unknown) {
  return githubEventFiltersSchema.safeParse(input);
}

function expectValid(input: unknown) {
  const result = parseFilters(input);
  expect(result.success, `Expected valid but got: ${!result.success ? JSON.stringify((result as { error: unknown }).error) : ''}`).toBe(true);
  return result;
}

function expectInvalid(input: unknown, messageSubstring?: string) {
  const result = parseFilters(input);
  expect(result.success, `Expected invalid but schema accepted: ${JSON.stringify(input)}`).toBe(false);
  if (messageSubstring && !result.success) {
    const messages = result.error.issues.map((i) => i.message).join(' | ');
    expect(messages, `Expected error message to contain "${messageSubstring}"`).toContain(messageSubstring);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Base: all filters optional
// ---------------------------------------------------------------------------

describe('githubEventFiltersSchema — base', () => {
  it('empty object is valid (all filters optional)', () => {
    expectValid({});
  });

  it('labels only is valid', () => {
    expectValid({ labels: ['design', 'review'] });
  });

  it('paths only is valid', () => {
    expectValid({ paths: ['**/*.ts'] });
  });

  it('labels + paths together are valid', () => {
    expectValid({ labels: ['design'], paths: ['docs/**'] });
  });

  it('unknown extra property is rejected (.strict())', () => {
    expectInvalid({ labels: ['a'], unknown_field: 'oops' });
  });
});

// ---------------------------------------------------------------------------
// prSize
// ---------------------------------------------------------------------------

describe('githubEventFiltersSchema — prSize', () => {
  it('min only parses', () => {
    expectValid({ prSize: { min: 0 } });
  });

  it('max only parses', () => {
    expectValid({ prSize: { max: 500 } });
  });

  it('min + max both valid parses', () => {
    expectValid({ prSize: { min: 10, max: 500 } });
  });

  it('min === max is valid (boundary)', () => {
    expectValid({ prSize: { min: 100, max: 100 } });
  });

  it('min > max is rejected', () => {
    expectInvalid({ prSize: { min: 200, max: 100 } }, 'prSize.min must be <= prSize.max');
  });

  it('min negative is rejected (nonnegative)', () => {
    expectInvalid({ prSize: { min: -1 } });
  });

  it('max zero is rejected (positive)', () => {
    expectInvalid({ prSize: { max: 0 } });
  });

  it('max negative is rejected', () => {
    expectInvalid({ prSize: { max: -10 } });
  });

  it('empty prSize object is valid (both fields optional)', () => {
    expectValid({ prSize: {} });
  });

  it('unknown key in prSize rejected (.strict())', () => {
    expectInvalid({ prSize: { min: 10, unexpected: true } });
  });
});

// ---------------------------------------------------------------------------
// reviewState
// ---------------------------------------------------------------------------

describe('githubEventFiltersSchema — reviewState', () => {
  it('single valid enum value parses', () => {
    expectValid({ reviewState: { in: ['approved'] } });
  });

  it('multiple valid enum values parse', () => {
    expectValid({ reviewState: { in: ['approved', 'changes_requested', 'commented', 'dismissed'] } });
  });

  it('invalid enum value is rejected', () => {
    expectInvalid({ reviewState: { in: ['approved', 'pending'] } });
  });

  it('empty array is rejected (min(1))', () => {
    expectInvalid({ reviewState: { in: [] } });
  });

  it('unknown key in reviewState rejected (.strict())', () => {
    expectInvalid({ reviewState: { in: ['approved'], extra: true } });
  });
});

// ---------------------------------------------------------------------------
// milestone
// ---------------------------------------------------------------------------

describe('githubEventFiltersSchema — milestone', () => {
  it('in only parses', () => {
    expectValid({ milestone: { in: ['v1.0.0', 'v1.1.0'] } });
  });

  it('ids only parses', () => {
    expectValid({ milestone: { ids: [101, 102] } });
  });

  it('both in + ids rejected (mutually exclusive)', () => {
    expectInvalid({ milestone: { in: ['v1.0.0'], ids: [101] } }, 'milestone: specify in OR ids, not both');
  });

  it('ids with non-positive integer rejected', () => {
    expectInvalid({ milestone: { ids: [0] } });
  });

  it('ids with negative rejected', () => {
    expectInvalid({ milestone: { ids: [-1] } });
  });

  it('empty in array rejected (min(1))', () => {
    expectInvalid({ milestone: { in: [] } });
  });

  it('empty ids array rejected (min(1))', () => {
    expectInvalid({ milestone: { ids: [] } });
  });

  it('empty milestone object is valid (both in/ids optional)', () => {
    expectValid({ milestone: {} });
  });
});

// ---------------------------------------------------------------------------
// author
// ---------------------------------------------------------------------------

describe('githubEventFiltersSchema — author', () => {
  it('single login parses', () => {
    expectValid({ author: { in: ['octocat'] } });
  });

  it('multiple logins parse', () => {
    expectValid({ author: { in: ['octocat', 'dependabot[bot]'] } });
  });

  it('empty in array rejected (min(1))', () => {
    expectInvalid({ author: { in: [] } });
  });

  it('unknown key in author rejected (.strict())', () => {
    expectInvalid({ author: { in: ['octocat'], extra: 'x' } });
  });
});

// ---------------------------------------------------------------------------
// branch
// ---------------------------------------------------------------------------

describe('githubEventFiltersSchema — branch', () => {
  it('single branch parses', () => {
    expectValid({ branch: { in: ['main'] } });
  });

  it('multiple branches parse', () => {
    expectValid({ branch: { in: ['main', 'develop'] } });
  });

  it('empty in array rejected (min(1))', () => {
    expectInvalid({ branch: { in: [] } });
  });
});

// ---------------------------------------------------------------------------
// draft
// ---------------------------------------------------------------------------

describe('githubEventFiltersSchema — draft', () => {
  it('equals true parses', () => {
    expectValid({ draft: { equals: true } });
  });

  it('equals false parses', () => {
    expectValid({ draft: { equals: false } });
  });

  it('missing equals rejected', () => {
    expectInvalid({ draft: {} });
  });

  it('unknown key in draft rejected (.strict())', () => {
    expectInvalid({ draft: { equals: true, extra: 1 } });
  });
});

// ---------------------------------------------------------------------------
// Combinations: all new fields alongside existing labels + paths
// ---------------------------------------------------------------------------

describe('githubEventFiltersSchema — full combinations', () => {
  it('all new fields alongside labels + paths parse together', () => {
    expectValid({
      labels: ['review-needed'],
      paths: ['**/*.ts'],
      prSize: { min: 0, max: 500 },
      reviewState: { in: ['approved'] },
      milestone: { in: ['v1.0.0'] },
      author: { in: ['octocat'] },
      branch: { in: ['main'] },
      draft: { equals: false },
    });
  });
});

// ---------------------------------------------------------------------------
// YAML round-trip: new filter fields survive parse → stringify → re-parse
// ---------------------------------------------------------------------------

describe('YAML round-trip — new CER-5 filter fields', () => {
  it('prSize, reviewState, milestone, author, branch, draft survive roundtrip', () => {
    const wf: WorkflowYaml = {
      apiVersion: 'squad.io/v1',
      kind: 'Ceremony',
      metadata: { name: 'cer5-roundtrip' },
      spec: {
        trigger: {
          type: 'github-event',
          event: 'pull_request_review',
          filters: {
            labels: ['review-needed'],
            paths: ['src/**'],
            prSize: { min: 0, max: 500 },
            reviewState: { in: ['approved', 'changes_requested'] },
            milestone: { in: ['v1.0.0', 'v1.1.0'] },
            author: { in: ['octocat'] },
            branch: { in: ['main'] },
            draft: { equals: false },
          },
        },
        steps: [],
      },
    };

    const yamlStr = roundtrip(stringifyWorkflowYaml(wf));

    const reparsed = parseWorkflowYaml(yamlStr);
    const trigger = reparsed.spec.trigger;
    expect(trigger.type).toBe('github-event');
    if (trigger.type !== 'github-event') return;

    expect(trigger.filters?.labels).toEqual(['review-needed']);
    expect(trigger.filters?.paths).toEqual(['src/**']);
    expect(trigger.filters?.prSize).toEqual({ min: 0, max: 500 });
    expect(trigger.filters?.reviewState).toEqual({ in: ['approved', 'changes_requested'] });
    expect(trigger.filters?.milestone).toEqual({ in: ['v1.0.0', 'v1.1.0'] });
    expect(trigger.filters?.author).toEqual({ in: ['octocat'] });
    expect(trigger.filters?.branch).toEqual({ in: ['main'] });
    expect(trigger.filters?.draft).toEqual({ equals: false });
  });
});
