/**
 * types.ts — CER-3: WorkflowYaml interface for the canonical .workflow.yaml format.
 *
 * This is the in-memory representation of a serialized ceremony; it maps 1:1
 * to the canonical YAML format (apiVersion: squad.io/v1, kind: Ceremony).
 * Derived DB fields (id, createdAt, origin) are intentionally absent.
 */

// ---------------------------------------------------------------------------
// Trigger shapes
// ---------------------------------------------------------------------------

export interface GithubEventTrigger {
  type: 'github-event';
  event: string;
  filters?: {
    labels?: string[];
    paths?: string[];
    [key: string]: unknown;
  };
}

export interface ManualTrigger {
  type: 'manual';
}

export interface CronTrigger {
  type: 'cron';
  schedule: string;
}

export interface AgentSignalTrigger {
  type: 'agent-signal';
}

export type WorkflowTrigger =
  | GithubEventTrigger
  | ManualTrigger
  | CronTrigger
  | AgentSignalTrigger;

// ---------------------------------------------------------------------------
// Step shapes
// ---------------------------------------------------------------------------

export interface WorkflowYamlMetadata {
  name: string;
  displayName?: string;
  description?: string;
}

export interface WorkflowYamlSpec {
  trigger: WorkflowTrigger;
  steps: Array<{ id: string; kind: string; [key: string]: unknown }>;
}

/**
 * In-memory representation of a canonical .workflow.yaml file.
 * Key ordering for serialization: apiVersion -> kind -> metadata -> spec.
 */
export interface WorkflowYaml {
  apiVersion: 'squad.io/v1';
  kind: 'Ceremony';
  metadata: WorkflowYamlMetadata;
  spec: WorkflowYamlSpec;
}
