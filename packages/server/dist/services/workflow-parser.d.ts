/**
 * workflow-parser.ts — YAML workflow definition parser (Demo 6 / Demo 10)
 *
 * Parses the `simple` workflow YAML format into a WorkflowDefinition.
 * Uses js-yaml for parsing; performs structural validation on top.
 *
 * Supported step types: route | agent_run | approve | fan_out | handoff
 * Invariant 1: agent_run is the only step that does LLM work.
 */
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
    agent?: string;
    prompt?: string;
    timeout?: string;
}
export interface ApproveStep extends BaseStep {
    type: 'approve';
    agent?: string;
    prompt?: string;
    approvers?: string[];
    timeout?: string;
    request_changes_policy?: 'first' | 'majority' | 'all';
    quorum?: {
        n: number;
        of: number;
    };
    exclude_author?: boolean;
}
/** Demo 10: fan_out step — spawns N child workflow_runs (Invariant 5). */
export interface FanOutStep extends BaseStep {
    type: 'fan_out';
    split_by: 'labels' | 'agents' | 'count';
    count?: number;
    agents?: string[];
    merge_strategy: 'all' | 'any' | 'first';
    on_child_failure?: 'continue' | 'fail_fast';
    steps: WorkflowStep[];
}
/** Demo 10: handoff step — transfers ownership to another agent (fire-and-forget). */
export interface HandoffStep extends BaseStep {
    type: 'handoff';
    to: string;
    message?: string;
}
export type WorkflowStep = RouteStep | AgentRunStep | ApproveStep | FanOutStep | HandoffStep;
export interface WorkflowDefinition {
    name: string;
    description?: string;
    outputSchema?: Record<string, unknown>;
    steps: WorkflowStep[];
}
/**
 * Validate YAML content without throwing.
 * Returns { valid, errors } so callers can surface issues before persisting.
 */
export declare function validateWorkflowYaml(yamlContent: string): {
    valid: boolean;
    errors: string[];
};
/**
 * Parse YAML content into a structured WorkflowDefinition.
 * Throws if the YAML is invalid (call validateWorkflowYaml first for user-facing errors).
 */
export declare function parseWorkflowYaml(yamlContent: string): Promise<WorkflowDefinition>;
//# sourceMappingURL=workflow-parser.d.ts.map