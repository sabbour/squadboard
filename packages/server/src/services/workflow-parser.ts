/**
 * workflow-parser.ts — YAML workflow definition parser (Demo 6)
 *
 * Parses the `simple` workflow YAML format into a WorkflowDefinition.
 * Uses js-yaml for parsing; performs structural validation on top.
 *
 * Supported step types: route | agent_run | approve
 * Invariant 1: agent_run is the only step that does LLM work.
 */

import * as yaml from 'js-yaml';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorkflowStep {
  type: 'route' | 'agent_run' | 'approve';
  agent?: string;      // template expression, e.g. "{{ assignee }}"
  prompt?: string;
  approvers?: string[];
  timeout?: string;    // e.g. "24h"
  // Demo 9: peer review configuration
  request_changes_policy?: 'first' | 'majority' | 'all'; // default 'first'
  quorum?: { n: number; of: number };   // n-of-m approvals needed; overrides approvers length
  exclude_author?: boolean;              // if true, issue author cannot review their own work
}

export interface WorkflowDefinition {
  name: string;
  description?: string;
  outputSchema?: Record<string, unknown>;  // JSON Schema (Invariant 4)
  steps: WorkflowStep[];
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const VALID_STEP_TYPES = new Set(['route', 'agent_run', 'approve']);

function validateStepShape(step: unknown, index: number): string[] {
  const errs: string[] = [];
  if (typeof step !== 'object' || step === null) {
    errs.push(`step[${index}]: must be an object`);
    return errs;
  }
  const s = step as Record<string, unknown>;
  if (!s['type'] || !VALID_STEP_TYPES.has(s['type'] as string)) {
    errs.push(`step[${index}]: 'type' must be one of route | agent_run | approve`);
  }
  if (s['type'] === 'agent_run' && s['agent'] !== undefined && typeof s['agent'] !== 'string') {
    errs.push(`step[${index}]: 'agent' must be a string`);
  }
  if (s['type'] === 'approve' && s['approvers'] !== undefined && !Array.isArray(s['approvers'])) {
    errs.push(`step[${index}]: 'approvers' must be an array`);
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

  const steps: WorkflowStep[] = (doc['steps'] as Array<Record<string, unknown>>).map((s) => {
    const step: WorkflowStep = { type: s['type'] as WorkflowStep['type'] };
    if (s['agent'] !== undefined) step.agent = String(s['agent']);
    if (s['prompt'] !== undefined) step.prompt = String(s['prompt']);
    if (Array.isArray(s['approvers'])) step.approvers = s['approvers'].map(String);
    if (s['timeout'] !== undefined) step.timeout = String(s['timeout']);
    if (s['request_changes_policy'] !== undefined) {
      step.request_changes_policy = s['request_changes_policy'] as WorkflowStep['request_changes_policy'];
    }
    if (s['quorum'] !== undefined && typeof s['quorum'] === 'object' && s['quorum'] !== null) {
      const q = s['quorum'] as Record<string, unknown>;
      step.quorum = { n: Number(q['n'] ?? 1), of: Number(q['of'] ?? 1) };
    }
    if (s['exclude_author'] !== undefined) step.exclude_author = Boolean(s['exclude_author']);
    return step;
  });

  return {
    name: String(doc['name']),
    description: doc['description'] !== undefined ? String(doc['description']) : undefined,
    outputSchema: doc['output_schema'] as Record<string, unknown> | undefined,
    steps,
  };
}
