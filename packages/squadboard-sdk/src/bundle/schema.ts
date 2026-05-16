/**
 * @sabbour/squadboard-sdk — bundle/schema.ts
 *
 * TypeScript type definitions for the Squadboard Bundle format.
 *
 * A bundle is a portable, self-describing artifact that captures an entire
 * project configuration: kanban columns, team charters, ceremonies,
 * workflows, skills, tools, MCP servers, and routing rules. It can be
 * applied to any Squadboard instance to reproduce the full setup
 * idempotently.
 *
 * FORMAT (hybrid):
 *   - Root manifest: `squad-bundle.json`
 *   - Large markdown bodies (> 4 KB) are split to
 *     `bundle/{section}/{id}.md` and referenced via a relative `bodyPath`
 *     field. Bodies ≤ 4 KB are inlined in the manifest JSON.
 *
 * VERSIONING:
 *   - `manifest.schemaVersion` (integer): bumped on breaking format changes.
 *   - `manifest.version` (semver string): content version, author-controlled.
 *
 * COMPATIBILITY:
 *   - Loaders MUST ignore unknown top-level sections (forward-compat).
 *   - Loaders SHOULD warn when `schemaVersion` is newer than supported.
 */

// ---------------------------------------------------------------------------
// Workflow step types (mirrors workflow-parser WorkflowStep union)
// ---------------------------------------------------------------------------

export interface BundleWorkflowRouteStep {
  type: 'route';
  label?: string;
  agent?: string;
  prompt?: string;
  timeout?: string;
}

export interface BundleWorkflowAgentRunStep {
  type: 'agent_run';
  label?: string;
  agent?: string;
  prompt?: string;
  timeout?: string;
}

export interface BundleWorkflowApproveStep {
  type: 'approve';
  label?: string;
  agent?: string;
  prompt?: string;
  approvers?: string[];
  timeout?: string;
  timeoutAction?: 'auto_approve' | 'auto_reject' | 'escalate' | 'notify';
  fallbackReviewer?: string;
  request_changes_policy?: 'first' | 'majority' | 'all';
  quorum?: { n: number; of: number };
  exclude_author?: boolean;
}

export interface BundleWorkflowFanOutStep {
  type: 'fan_out';
  label?: string;
  split_by: 'labels' | 'agents' | 'count';
  count?: number;
  agents?: string[];
  merge_strategy: 'all' | 'any' | 'first';
  on_child_failure?: 'continue' | 'fail_fast';
  mode?: 'serial' | 'parallel';
  steps: BundleWorkflowStep[];
}

export interface BundleWorkflowHandoffStep {
  type: 'handoff';
  label?: string;
  agent?: string;
  prompt?: string;
}

export type BundleWorkflowStep =
  | BundleWorkflowRouteStep
  | BundleWorkflowAgentRunStep
  | BundleWorkflowApproveStep
  | BundleWorkflowFanOutStep
  | BundleWorkflowHandoffStep;

// ---------------------------------------------------------------------------
// Ceremony trigger types (mirrors triggerKind / triggerConfig)
// ---------------------------------------------------------------------------

export type BundleCeremonyTriggerKind =
  | 'on_issue_entry'
  | 'on_schedule'
  | 'on_event'
  | 'manual';

export interface BundleCeremonyTrigger {
  kind: BundleCeremonyTriggerKind;
  /** Matches the shape of triggerConfig for the given kind. */
  config?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Top-level section types
// ---------------------------------------------------------------------------

export interface BundleManifest {
  /** Unique machine-readable identifier, e.g. "default-software-project". */
  bundleId: string;
  /** Human-readable display name. */
  name: string;
  /** Semver string for content — author-controlled. */
  version: string;
  description: string;
  author?: string;
  license?: string;
  /**
   * Integer schema version. Bump on breaking format changes.
   * Current supported version: 1.
   */
  schemaVersion: 1;
}

export interface BundleProject {
  name: string;
  description?: string;
  icon?: string;
  settings?: Record<string, unknown>;
}

export interface BundleKanbanColumn {
  slug: string;
  label: string;
  order: number;
  wip_limit?: number;
}

export interface BundleKanban {
  columns: BundleKanbanColumn[];
  /** slug of the column where new issues are placed. */
  defaultColumn: string;
}

export interface BundleTeamMember {
  /** Cast name (e.g. "Lead", "Backend"). Re-cast by Init Mode on apply. */
  name: string;
  role: string;
  persistent: boolean;
  /**
   * Markdown charter body. Inlined when ≤ 4 KB.
   * Mutually exclusive with `charterPath`.
   */
  charter?: string;
  /**
   * Relative path to an external charter .md file when body > 4 KB.
   * e.g. "bundle/team/lead.md"
   */
  charterPath?: string;
}

export interface BundleCeremony {
  id: string;
  name: string;
  scope: 'project' | 'board' | 'task';
  trigger: BundleCeremonyTrigger;
  steps: BundleWorkflowStep[];
  /**
   * Inline YAML workflow body. Preferred format for ceremonies stored in
   * bundle JSON — lets the loader reuse validateWorkflowYaml directly.
   * Mutually exclusive with `bodyPath`.
   */
  workflowYaml?: string;
  /** Relative path to external .yaml when body > 4 KB. */
  bodyPath?: string;
}

export interface BundleWorkflow {
  id: string;
  name: string;
  description?: string;
  triggerKind: BundleCeremonyTriggerKind;
  triggerConfig?: Record<string, unknown>;
  /** Inline YAML content. Mutually exclusive with `bodyPath`. */
  workflowYaml?: string;
  /** Relative path to external .yaml when body > 4 KB. */
  bodyPath?: string;
}

export interface BundleSkill {
  key: string;
  name: string;
  description?: string;
  category?: string;
  /** Inline prompt addendum body. Mutually exclusive with `bodyPath`. */
  promptAddendum?: string;
  /** Relative path to external .md when body > 4 KB. */
  bodyPath?: string;
}

export interface BundleTool {
  key: string;
  name: string;
  description: string;
  category?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
}

export interface BundleMcpServer {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  description?: string;
  transport?: 'stdio' | 'http';
  url?: string;
}

export interface BundleRoutingRule {
  pattern: string;
  matchType: 'label' | 'keyword' | 'assignee' | 'catchall';
  agentName: string;
  priority?: number;
  rawRule?: string;
}

export interface BundleAgent {
  name: string;
  role: string;
  model?: string;
  persistent?: boolean;
  charter?: string;
  charterPath?: string;
}

// ---------------------------------------------------------------------------
// Root bundle type
// ---------------------------------------------------------------------------

/**
 * SquadboardBundle — the complete wire format for a project bundle.
 *
 * All sections except `manifest` are optional. A loader that encounters
 * an unknown section MUST ignore it and emit a warning.
 */
export interface SquadboardBundle {
  manifest: BundleManifest;
  project?: BundleProject;
  kanban?: BundleKanban;
  team?: BundleTeamMember[];
  ceremonies?: BundleCeremony[];
  workflows?: BundleWorkflow[];
  skills?: BundleSkill[];
  tools?: BundleTool[];
  mcpServers?: BundleMcpServer[];
  routing?: BundleRoutingRule[];
  agents?: BundleAgent[];
}

// ---------------------------------------------------------------------------
// Loader result type (shared between server loader and CLI output)
// ---------------------------------------------------------------------------

export interface ApplyResult {
  applied: string[];
  skipped: string[];
  warnings: string[];
  errors: string[];
}
