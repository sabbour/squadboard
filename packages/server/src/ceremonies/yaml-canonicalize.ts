/**
 * yaml-canonicalize.ts — CER-3: Serializer/parser pair for the canonical
 * .workflow.yaml format (apiVersion: squad.io/v1, kind: Ceremony).
 *
 * Design invariants:
 *  - Stable key ordering: apiVersion -> kind -> metadata -> spec
 *  - 2-space indent, LF line endings, trailing newline
 *  - Multiline strings use literal block style `|`
 *  - Round-trip stability: parse(stringify(x)) produces byte-identical output
 *  - Uses the `yaml` npm package's Document API to preserve insertion order
 */

import { Document, YAMLMap, YAMLSeq, Scalar, Pair, parseDocument } from 'yaml';
import { workflowYamlSchema } from './yaml-schema.js';
import type { WorkflowYaml, WorkflowTrigger } from './types.js';

// ---------------------------------------------------------------------------
// Internal helpers — build yaml Document nodes preserving key order
// ---------------------------------------------------------------------------

type YamlNode = Scalar | YAMLMap | YAMLSeq;

function makeScalar(value: unknown): Scalar {
  const s = new Scalar(value);
  // Use literal block style for multiline strings
  if (typeof value === 'string' && value.includes('\n')) {
    s.type = 'BLOCK_LITERAL';
  }
  return s;
}

function isYamlNode(v: unknown): v is YamlNode {
  return v instanceof YAMLMap || v instanceof YAMLSeq || v instanceof Scalar;
}

function makeMap(entries: Array<[string, unknown]>): YAMLMap {
  const map = new YAMLMap();
  for (const [key, value] of entries) {
    if (value === undefined) continue;
    const node = isYamlNode(value) ? value : toNode(value);
    map.items.push(new Pair(new Scalar(key), node));
  }
  return map;
}

function makeSeq(items: unknown[]): YAMLSeq {
  const seq = new YAMLSeq();
  for (const item of items) {
    seq.items.push(isYamlNode(item) ? item : toNode(item));
  }
  return seq;
}

function toNode(value: unknown): YamlNode {
  if (value === null || value === undefined) return new Scalar(null);
  if (isYamlNode(value)) return value;
  if (Array.isArray(value)) return makeSeq(value);
  if (typeof value === 'object') {
    return makeMap(Object.entries(value as Record<string, unknown>));
  }
  return makeScalar(value);
}

// ---------------------------------------------------------------------------
// Build ordered trigger node
// ---------------------------------------------------------------------------

function buildTriggerMap(trigger: WorkflowTrigger): YAMLMap {
  if (trigger.type === 'github-event') {
    const entries: Array<[string, unknown]> = [
      ['type', trigger.type],
      ['event', trigger.event],
    ];
    if (trigger.filters !== undefined) {
      const filterEntries: Array<[string, unknown]> = [];
      if (trigger.filters.labels !== undefined) filterEntries.push(['labels', trigger.filters.labels]);
      if (trigger.filters.paths !== undefined) filterEntries.push(['paths', trigger.filters.paths]);
      for (const [k, v] of Object.entries(trigger.filters)) {
        if (k !== 'labels' && k !== 'paths') filterEntries.push([k, v]);
      }
      entries.push(['filters', makeMap(filterEntries)]);
    }
    return makeMap(entries);
  }

  if (trigger.type === 'cron') {
    return makeMap([
      ['type', trigger.type],
      ['schedule', trigger.schedule],
    ]);
  }

  // manual | agent-signal
  return makeMap([['type', trigger.type]]);
}

// ---------------------------------------------------------------------------
// Build ordered step node
// ---------------------------------------------------------------------------

function buildStepMap(step: { id: string; kind: string; [key: string]: unknown }): YAMLMap {
  const { id, kind, ...rest } = step;
  const entries: Array<[string, unknown]> = [
    ['id', id],
    ['kind', kind],
    ...Object.entries(rest),
  ];
  return makeMap(entries);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Serialize a WorkflowYaml to a canonical YAML string.
 * Key ordering: apiVersion -> kind -> metadata -> spec -> spec.trigger -> spec.steps
 */
export function stringifyWorkflowYaml(workflow: WorkflowYaml): string {
  const doc = new Document();

  const metaEntries: Array<[string, unknown]> = [['name', workflow.metadata.name]];
  if (workflow.metadata.displayName !== undefined)
    metaEntries.push(['displayName', workflow.metadata.displayName]);
  if (workflow.metadata.description !== undefined)
    metaEntries.push(['description', workflow.metadata.description]);

  const triggerMap = buildTriggerMap(workflow.spec.trigger);

  const stepsSeq = new YAMLSeq();
  for (const step of workflow.spec.steps) {
    stepsSeq.items.push(buildStepMap(step));
  }

  const root = makeMap([
    ['apiVersion', workflow.apiVersion],
    ['kind', workflow.kind],
    ['metadata', makeMap(metaEntries)],
    ['spec', makeMap([
      ['trigger', triggerMap],
      ['steps', stepsSeq],
    ])],
  ]);

  doc.contents = root as unknown as ReturnType<typeof doc.createNode>;

  const output = doc.toString({ indent: 2, lineWidth: 0 });
  // Normalize to LF and ensure trailing newline
  const normalized = output.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return normalized.endsWith('\n') ? normalized : normalized + '\n';
}

/**
 * Parse a YAML string into a WorkflowYaml, throwing on invalid input.
 */
export function parseWorkflowYaml(yamlText: string): WorkflowYaml {
  let parsed: unknown;
  try {
    parsed = parseDocument(yamlText).toJSON();
  } catch (err) {
    throw new Error(`YAML parse error: ${err instanceof Error ? err.message : String(err)}`);
  }

  const result = workflowYamlSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues;
    const first = issues[0];
    const path = first?.path.join('.') ?? 'unknown';
    const msg = first?.message ?? 'Validation failed';
    throw new Error(`Invalid workflow YAML at ${path}: ${msg}`);
  }

  return result.data as WorkflowYaml;
}

export type SafeParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: { issues: Array<{ path: (string | number)[]; message: string; code: string }> } };

/**
 * Parse a YAML string, returning a safe parse result (success or error with issues).
 */
export function safeParseWorkflowYaml(yamlText: string): SafeParseResult<WorkflowYaml> {
  let parsed: unknown;
  try {
    parsed = parseDocument(yamlText).toJSON();
  } catch (err) {
    return {
      success: false,
      error: {
        issues: [
          {
            code: 'custom',
            path: [],
            message: `YAML parse error: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
      },
    };
  }
  const result = workflowYamlSchema.safeParse(parsed);
  if (result.success) {
    return { success: true, data: result.data as WorkflowYaml };
  }
  return {
    success: false,
    error: {
      issues: result.error.issues.map((issue) => ({
        code: issue.code,
        path: issue.path as (string | number)[],
        message: issue.message,
      })),
    },
  };
}

/**
 * Parse then re-stringify — validates and normalizes an existing YAML file.
 * Round-trip stable: roundtrip(roundtrip(x)) === roundtrip(x).
 */
export function roundtrip(yamlText: string): string {
  return stringifyWorkflowYaml(parseWorkflowYaml(yamlText));
}
