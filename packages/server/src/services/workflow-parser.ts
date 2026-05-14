/**
 * workflow-parser.ts — YAML workflow definition parser (Demo 6 / Demo 10)
 *
 * Parses the `simple` workflow YAML format into a WorkflowDefinition.
 * Uses js-yaml for parsing; performs structural validation on top.
 *
 * Supported step types: route | agent_run | approve | fan_out | handoff
 * Invariant 1: agent_run is the only step that does LLM work.
 */

import * as yaml from 'js-yaml';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BaseStep {
  label?: string;
}

export interface RouteStep extends BaseStep {
  type: 'route';
  agent?: string;
  prompt?: string;
  timeout?: string;
}

export interface AgentRunStep extends BaseStep {
  type: 'agent_run';
  agent?: string;      // template expression, e.g. "{{ assignee }}"
  prompt?: string;
  timeout?: string;
}

export interface ApproveStep extends BaseStep {
  type: 'approve';
  agent?: string;      // for compatibility with shared step access patterns
  prompt?: string;
  approvers?: string[];
  timeout?: string;
  // Demo 9: peer review configuration
  request_changes_policy?: 'first' | 'majority' | 'all'; // default 'first'
  quorum?: { n: number; of: number };   // n-of-m approvals needed; overrides approvers length
  exclude_author?: boolean;              // if true, issue author cannot review their own work
}

/** Demo 10: fan_out step — spawns N child workflow_runs (Invariant 5). */
export interface FanOutStep extends BaseStep {
  type: 'fan_out';
  split_by: 'labels' | 'agents' | 'count';
  count?: number;              // used when split_by='count'
  agents?: string[];           // used when split_by='agents' or as round-robin pool for 'count'
  merge_strategy: 'all' | 'any' | 'first'; // when to consider the fan_out complete
  on_child_failure?: 'continue' | 'fail_fast'; // default 'fail_fast'
  steps: WorkflowStep[];      // inline child workflow steps
}

/** Demo 10: handoff step — transfers ownership to another agent (fire-and-forget). */
export interface HandoffStep extends BaseStep {
  type: 'handoff';
  to: string;          // target agent name
  message?: string;    // optional context for the receiving agent
}

export type WorkflowStep = RouteStep | AgentRunStep | ApproveStep | FanOutStep | HandoffStep;

export interface WorkflowDefinition {
  name: string;
  description?: string;
  outputSchema?: Record<string, unknown>;  // JSON Schema (Invariant 4)
  steps: WorkflowStep[];
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const VALID_STEP_TYPES = new Set(['route', 'agent_run', 'approve', 'fan_out', 'handoff']);

function validateStepShape(step: unknown, index: number): string[] {
  const errs: string[] = [];
  if (typeof step !== 'object' || step === null) {
    errs.push(`step[${index}]: must be an object`);
    return errs;
  }
  const s = step as Record<string, unknown>;
  if (!s['type'] || !VALID_STEP_TYPES.has(s['type'] as string)) {
    errs.push(`step[${index}]: 'type' must be one of route | agent_run | approve | fan_out | handoff`);
    return errs;
  }
  if (s['type'] === 'agent_run' && s['agent'] !== undefined && typeof s['agent'] !== 'string') {
    errs.push(`step[${index}]: 'agent' must be a string`);
  }
  if (s['type'] === 'approve' && s['approvers'] !== undefined && !Array.isArray(s['approvers'])) {
    errs.push(`step[${index}]: 'approvers' must be an array`);
  }
  if (s['type'] === 'fan_out') {
    const validSplitBy = new Set(['labels', 'agents', 'count']);
    if (!s['split_by'] || !validSplitBy.has(s['split_by'] as string)) {
      errs.push(`step[${index}]: fan_out 'split_by' must be one of labels | agents | count`);
    }
    const validMerge = new Set(['all', 'any', 'first']);
    if (!s['merge_strategy'] || !validMerge.has(s['merge_strategy'] as string)) {
      errs.push(`step[${index}]: fan_out 'merge_strategy' must be one of all | any | first`);
    }
    if (!Array.isArray(s['steps']) || (s['steps'] as unknown[]).length === 0) {
      errs.push(`step[${index}]: fan_out 'steps' must be a non-empty array`);
    } else {
      for (let j = 0; j < (s['steps'] as unknown[]).length; j++) {
        errs.push(...validateStepShape((s['steps'] as unknown[])[j], j).map((e) => `step[${index}].steps[${j}]: ${e}`));
      }
    }
    if (s['split_by'] === 'count' && (typeof s['count'] !== 'number' || (s['count'] as number) < 1)) {
      errs.push(`step[${index}]: fan_out 'count' must be a positive integer when split_by='count'`);
    }
    if (s['split_by'] === 'agents' && (!Array.isArray(s['agents']) || (s['agents'] as unknown[]).length === 0)) {
      errs.push(`step[${index}]: fan_out 'agents' must be a non-empty array when split_by='agents'`);
    }
  }
  if (s['type'] === 'handoff') {
    if (typeof s['to'] !== 'string' || !s['to']) {
      errs.push(`step[${index}]: handoff 'to' must be a non-empty string`);
    }
  }
  return errs;
}

/**
 * Validate YAML content without throwing.
 * Returns { valid, errors } so callers can surface issues before persisting.
 */
export function validateWorkflowYaml(yamlContent: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  let parsed: unknown;
  try {
    parsed = yaml.load(yamlContent);
  } catch (err: unknown) {
    return { valid: false, errors: [`YAML parse error: ${String(err)}`] };
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return { valid: false, errors: ['Workflow definition must be a YAML object'] };
  }

  const doc = parsed as Record<string, unknown>;

  if (!doc['name'] || typeof doc['name'] !== 'string') {
    errors.push("'name' is required and must be a string");
  }
  if (!Array.isArray(doc['steps']) || doc['steps'].length === 0) {
    errors.push("'steps' is required and must be a non-empty array");
  } else {
    for (let i = 0; i < doc['steps'].length; i++) {
      errors.push(...validateStepShape(doc['steps'][i], i));
    }
  }
  if (doc['output_schema'] !== undefined && (typeof doc['output_schema'] !== 'object' || doc['output_schema'] === null)) {
    errors.push("'output_schema' must be an object (JSON Schema)");
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Parse YAML content into a structured WorkflowDefinition.
 * Throws if the YAML is invalid (call validateWorkflowYaml first for user-facing errors).
 */
export async function parseWorkflowYaml(yamlContent: string): Promise<WorkflowDefinition> {
  const { valid, errors } = validateWorkflowYaml(yamlContent);
  if (!valid) {
    throw new Error(`Invalid workflow YAML: ${errors.join('; ')}`);
  }

  const doc = yaml.load(yamlContent) as Record<string, unknown>;

  const steps: WorkflowStep[] = (doc['steps'] as Array<Record<string, unknown>>).map((s) =>
    parseStepRaw(s),
  );

  return {
    name: String(doc['name']),
    description: doc['description'] !== undefined ? String(doc['description']) : undefined,
    outputSchema: doc['output_schema'] as Record<string, unknown> | undefined,
    steps,
  };
}

function parseStepRaw(s: Record<string, unknown>): WorkflowStep {
  const type = s['type'] as WorkflowStep['type'];

  if (type === 'fan_out') {
    const childSteps: WorkflowStep[] = Array.isArray(s['steps'])
      ? (s['steps'] as Array<Record<string, unknown>>).map((cs) => parseStepRaw(cs))
      : [];
    return {
      type: 'fan_out',
      label: s['label'] !== undefined ? String(s['label']) : undefined,
      split_by: s['split_by'] as FanOutStep['split_by'],
      count: s['count'] !== undefined ? Number(s['count']) : undefined,
      agents: Array.isArray(s['agents']) ? (s['agents'] as unknown[]).map(String) : undefined,
      merge_strategy: (s['merge_strategy'] as FanOutStep['merge_strategy']) ?? 'all',
      on_child_failure: s['on_child_failure'] !== undefined
        ? (s['on_child_failure'] as FanOutStep['on_child_failure'])
        : 'fail_fast',
      steps: childSteps,
    } satisfies FanOutStep;
  }

  if (type === 'handoff') {
    return {
      type: 'handoff',
      label: s['label'] !== undefined ? String(s['label']) : undefined,
      to: String(s['to']),
      message: s['message'] !== undefined ? String(s['message']) : undefined,
    } satisfies HandoffStep;
  }

  if (type === 'approve') {
    const step: ApproveStep = { type: 'approve' };
    if (s['label'] !== undefined) step.label = String(s['label']);
    if (s['agent'] !== undefined) step.agent = String(s['agent'] as string);
    if (s['prompt'] !== undefined) step.prompt = String(s['prompt']);
    if (Array.isArray(s['approvers'])) step.approvers = (s['approvers'] as unknown[]).map(String);
    if (s['timeout'] !== undefined) step.timeout = String(s['timeout']);
    if (s['request_changes_policy'] !== undefined) {
      step.request_changes_policy = s['request_changes_policy'] as ApproveStep['request_changes_policy'];
    }
    if (s['quorum'] !== undefined && typeof s['quorum'] === 'object' && s['quorum'] !== null) {
      const q = s['quorum'] as Record<string, unknown>;
      step.quorum = { n: Number(q['n'] ?? 1), of: Number(q['of'] ?? 1) };
    }
    if (s['exclude_author'] !== undefined) step.exclude_author = Boolean(s['exclude_author']);
    return step;
  }

  // route | agent_run
  const step = { type } as RouteStep | AgentRunStep;
  if (s['label'] !== undefined) step.label = String(s['label']);
  if (s['agent'] !== undefined) step.agent = String(s['agent']);
  if (s['prompt'] !== undefined) step.prompt = String(s['prompt']);
  if (s['timeout'] !== undefined) step.timeout = String(s['timeout']);
  return step;
}
