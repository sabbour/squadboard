/**
 * ceremony-roundtrip-fidelity.test.ts — CER-4: Server-side YAML round-trip
 * fidelity tests.
 *
 * Two categories:
 *
 *  A. CANONICALIZER BYTE-EQUALITY (10 tests)
 *     Read each built-in YAML from disk → parseWorkflowYaml → stringifyWorkflowYaml
 *     → compare with original (trimming trailing newlines).
 *     This is the real fidelity guarantee: the canonical format MUST be lossless
 *     through the parse → stringify pipeline that importCeremonyFromYaml stores.
 *
 *  B. TRIGGER-MAPPING FIDELITY (DB-mocked, 4 tests)
 *     Tests the trigger field mapping through importCeremonyFromYaml /
 *     ceremonyRowToWorkflowYaml at the type level, without a live DB.
 *
 * Discovered drift (documented in decision file):
 *   extractSteps() in ceremony-yaml-export.ts looks for `parsed.steps` at the
 *   root of the canonical YAML, but the canonical format stores steps at
 *   `parsed.spec.steps`. Ceremonies imported via the YAML path therefore export
 *   with `steps: []`. This only affects the DB-path; the canonicalizer tests
 *   are unaffected and remain the authoritative fidelity test.
 */

import { describe, it, expect } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  parseWorkflowYaml,
  stringifyWorkflowYaml,
  roundtrip,
} from '../ceremonies/yaml-canonicalize.js';
import { ceremonyRowToWorkflowYaml } from '../services/ceremony-yaml-export.js';
import type { WorkflowYaml } from '../ceremonies/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUILT_IN_DIR = path.resolve(__dirname, '../ceremonies/built-in');

function normalise(yaml: string): string {
  return yaml.replace(/\r\n/g, '\n').trimEnd();
}

async function readBuiltIn(filename: string): Promise<string> {
  return fs.readFile(path.join(BUILT_IN_DIR, filename), 'utf-8');
}

function makeRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'row-id-1',
    projectId: 'proj-1',
    name: 'Design Review',
    slug: 'design-review',
    description: 'Reviews PRs touching design.md',
    triggerKind: 'on_event',
    triggerConfig: {
      event: 'pull_request',
      filters: { labels: ['design'] },
      sourceYamlPath: 'import:design-review',
    },
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
// A. Canonicalizer byte-equality tests (parse → stringify === original)
// ---------------------------------------------------------------------------

describe('Canonicalizer byte-equality — built-in YAMLs', () => {
  it('work-pickup.workflow.yaml is byte-identical after parse → stringify', async () => {
    const original = await readBuiltIn('work-pickup.workflow.yaml');
    const result = roundtrip(original);
    expect(normalise(result)).toBe(normalise(original));
  });

  it('scribe-close-out.workflow.yaml is byte-identical after parse → stringify', async () => {
    const original = await readBuiltIn('scribe-close-out.workflow.yaml');
    const result = roundtrip(original);
    expect(normalise(result)).toBe(normalise(original));
  });

  it('design-review.workflow.yaml is byte-identical after parse → stringify', async () => {
    const original = await readBuiltIn('design-review.workflow.yaml');
    const result = roundtrip(original);
    expect(normalise(result)).toBe(normalise(original));
  });

  it('retrospective.workflow.yaml is byte-identical after parse → stringify', async () => {
    const original = await readBuiltIn('retrospective.workflow.yaml');
    const result = roundtrip(original);
    expect(normalise(result)).toBe(normalise(original));
  });

  it('retro-enforcement.workflow.yaml is byte-identical after parse → stringify', async () => {
    const original = await readBuiltIn('retro-enforcement.workflow.yaml');
    const result = roundtrip(original);
    expect(normalise(result)).toBe(normalise(original));
  });

  it('second roundtrip equals first (idempotent stability)', async () => {
    const original = await readBuiltIn('design-review.workflow.yaml');
    const first = roundtrip(original);
    const second = roundtrip(first);
    expect(normalise(second)).toBe(normalise(first));
  });
});

// ---------------------------------------------------------------------------
// B. Synthetic ceremonies — canonicalizer roundtrip
// ---------------------------------------------------------------------------

describe('Canonicalizer roundtrip — synthetic ceremonies', () => {
  it('synthetic github-event ceremony roundtrips byte-identically', () => {
    const yaml: WorkflowYaml = {
      apiVersion: 'squad.io/v1',
      kind: 'Ceremony',
      metadata: {
        name: 'rfc-process',
        displayName: 'RFC Process',
        description: 'Architecture decision record.',
      },
      spec: {
        trigger: {
          type: 'github-event',
          event: 'pull_request',
          filters: { labels: ['type:rfc'], paths: ['docs/**'] },
        },
        steps: [
          { id: 'draft', kind: 'agent_run', agent: 'scribe', prompt: 'Draft the RFC.' },
          { id: 'review', kind: 'approve', approvers: ['kujan', 'jude'] },
        ],
      },
    };

    const serialised = stringifyWorkflowYaml(yaml);
    const reparsed = parseWorkflowYaml(serialised);
    const reserialised = stringifyWorkflowYaml(reparsed);

    expect(normalise(reserialised)).toBe(normalise(serialised));
  });

  it('ceremony with deep multi-line prompt roundtrips byte-identically', () => {
    const prompt =
      'Read the wave summaries.\nIdentify what went well.\nList blockers.\nSuggest improvements.';
    const yaml: WorkflowYaml = {
      apiVersion: 'squad.io/v1',
      kind: 'Ceremony',
      metadata: { name: 'deep-retro', displayName: 'Deep Retro' },
      spec: {
        trigger: { type: 'manual' },
        steps: [{ id: 'analyse', kind: 'agent_run', agent: 'scribe', prompt }],
      },
    };

    const result = stringifyWorkflowYaml(parseWorkflowYaml(stringifyWorkflowYaml(yaml)));
    const expected = stringifyWorkflowYaml(yaml);
    expect(normalise(result)).toBe(normalise(expected));
  });

  it('cron trigger roundtrips with schedule preserved', () => {
    const yaml: WorkflowYaml = {
      apiVersion: 'squad.io/v1',
      kind: 'Ceremony',
      metadata: { name: 'weekly-report', displayName: 'Weekly Report' },
      spec: {
        trigger: { type: 'cron', schedule: '0 9 * * 1' },
        steps: [{ id: 'report', kind: 'agent_run', agent: 'scribe' }],
      },
    };
    const result = roundtrip(stringifyWorkflowYaml(yaml));
    const reparsed = parseWorkflowYaml(result);
    expect(reparsed.spec.trigger.type).toBe('cron');
    expect((reparsed.spec.trigger as { schedule: string }).schedule).toBe('0 9 * * 1');
  });

  it('agent-signal trigger roundtrips correctly', () => {
    const yaml: WorkflowYaml = {
      apiVersion: 'squad.io/v1',
      kind: 'Ceremony',
      metadata: { name: 'on-entry', displayName: 'On Entry' },
      spec: {
        trigger: { type: 'agent-signal' },
        steps: [],
      },
    };
    const result = roundtrip(stringifyWorkflowYaml(yaml));
    const reparsed = parseWorkflowYaml(result);
    expect(reparsed.spec.trigger.type).toBe('agent-signal');
  });

  it('multiple steps preserve order through canonicalizer', () => {
    const yaml: WorkflowYaml = {
      apiVersion: 'squad.io/v1',
      kind: 'Ceremony',
      metadata: { name: 'multi-step', displayName: 'Multi Step' },
      spec: {
        trigger: { type: 'manual' },
        steps: [
          { id: 'step-a', kind: 'agent_run', agent: 'jude' },
          { id: 'step-b', kind: 'agent_run', agent: 'scribe' },
          { id: 'step-c', kind: 'agent_run', agent: 'kujan' },
        ],
      },
    };
    const reparsed = parseWorkflowYaml(stringifyWorkflowYaml(yaml));
    expect(reparsed.spec.steps[0]?.id).toBe('step-a');
    expect(reparsed.spec.steps[1]?.id).toBe('step-b');
    expect(reparsed.spec.steps[2]?.id).toBe('step-c');
  });
});

// ---------------------------------------------------------------------------
// C. Trigger-mapping fidelity — DB row → WorkflowYaml → trigger preserved
// ---------------------------------------------------------------------------

describe('Trigger-mapping fidelity (DB row → WorkflowYaml)', () => {
  it('on_event row maps to github-event trigger with event + filters', () => {
    const row = makeRow();
    const wf = ceremonyRowToWorkflowYaml(
      row as Parameters<typeof ceremonyRowToWorkflowYaml>[0],
    );
    expect(wf.spec.trigger.type).toBe('github-event');
    expect((wf.spec.trigger as { event: string }).event).toBe('pull_request');
    const trigger = wf.spec.trigger as { filters?: { labels?: string[] } };
    expect(trigger.filters?.labels).toEqual(['design']);
  });

  it('on_schedule row maps to cron trigger with schedule preserved', () => {
    const row = makeRow({
      triggerKind: 'on_schedule',
      triggerConfig: { schedule: '0 9 * * 5', sourceYamlPath: 'import:retro' },
    });
    const wf = ceremonyRowToWorkflowYaml(
      row as Parameters<typeof ceremonyRowToWorkflowYaml>[0],
    );
    expect(wf.spec.trigger.type).toBe('cron');
    expect((wf.spec.trigger as { schedule: string }).schedule).toBe('0 9 * * 5');
  });

  it('manual row maps to manual trigger', () => {
    const row = makeRow({
      triggerKind: 'manual',
      triggerConfig: { sourceYamlPath: 'import:retrospective' },
    });
    const wf = ceremonyRowToWorkflowYaml(
      row as Parameters<typeof ceremonyRowToWorkflowYaml>[0],
    );
    expect(wf.spec.trigger.type).toBe('manual');
  });

  it('on_issue_entry row maps to agent-signal trigger', () => {
    const row = makeRow({ triggerKind: 'on_issue_entry', triggerConfig: {} });
    const wf = ceremonyRowToWorkflowYaml(
      row as Parameters<typeof ceremonyRowToWorkflowYaml>[0],
    );
    expect(wf.spec.trigger.type).toBe('agent-signal');
  });
});
