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

/** Routes a workflow to a named agent for processing. */
export interface BundleWorkflowRouteStep {
  type: 'route';
  label?: string;
  agent?: string;
  prompt?: string;
  timeout?: string;
}

/** Invokes an agent and waits for it to complete before continuing. */
export interface BundleWorkflowAgentRunStep {
  type: 'agent_run';
  label?: string;
  agent?: string;
  prompt?: string;
  timeout?: string;
}

/** Pauses a workflow and waits for human approval before continuing. */
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

/** Splits a workflow into parallel (or serial) sub-branches, then merges results. */
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

/** Transfers control to another agent without waiting for a response. */
export interface BundleWorkflowHandoffStep {
  type: 'handoff';
  label?: string;
  agent?: string;
  prompt?: string;
}

/**
 * Discriminated union of all workflow step types.
 * Use the `type` field to narrow to the concrete step interface.
 */
export type BundleWorkflowStep =
  | BundleWorkflowRouteStep
  | BundleWorkflowAgentRunStep
  | BundleWorkflowApproveStep
  | BundleWorkflowFanOutStep
  | BundleWorkflowHandoffStep;

// ---------------------------------------------------------------------------
// Ceremony trigger types (mirrors triggerKind / triggerConfig)
// ---------------------------------------------------------------------------

/**
 * Allowed trigger kinds for ceremonies and workflows.
 * Use `'github'` for GitHub webhook-driven triggers (Stream G Phase 2B).
 */
export type BundleCeremonyTriggerKind =
  | 'on_issue_entry'
  | 'on_schedule'
  | 'on_event'
  | 'manual'
  | 'github';         // Stream G Phase 2B: GitHub webhook event trigger

/** Generic trigger descriptor stored in a bundle ceremony or workflow. */
export interface BundleCeremonyTrigger {
  kind: BundleCeremonyTriggerKind;
  /** Matches the shape of triggerConfig for the given kind. */
  config?: Record<string, unknown>;
}

/**
 * GitHub webhook trigger — fires a ceremony when a matching GitHub event arrives.
 * Set `kind: 'github'` to use this trigger type.
 *
 * @example
 * ```yaml
 * triggers:
 *   - kind: github
 *     event: pull_request
 *     action: opened          # optional — omit to match all actions
 *     filters:
 *       label: bug            # PR/issue must have this label
 *       branch: main          # PR base branch or push ref must match
 *       author_team: maintainers  # GitHub org team membership check (gh api)
 * ```
 */
export interface BundleCeremonyGithubTrigger {
  kind: 'github';
  /** GitHub event name: pull_request | push | issues | issue_comment | workflow_run | check_run | pull_request_review | pull_request_review_comment */
  event: string;
  /** Optional: narrow by payload.action (e.g. "opened", "completed"). Omit to match all actions. */
  action?: string;
  /** Optional field filters applied against the event payload */
  filters?: {
    /** Issue or PR must carry this label */
    label?: string;
    /** PR base branch or push ref must match this string (exact or glob) */
    branch?: string;
    /** Payload author must be a member of this GitHub org team (checks via `gh api`) */
    author_team?: string;
  };
}

// ---------------------------------------------------------------------------
// Top-level section types
// ---------------------------------------------------------------------------

/** Bundle-level metadata: identity, versioning, and schema compatibility. */
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

/** Top-level project settings: display name, description, and custom config. */
export interface BundleProject {
  name: string;
  description?: string;
  icon?: string;
  settings?: Record<string, unknown>;
}

/** A single column in the project's Kanban board. */
export interface BundleKanbanColumn {
  slug: string;
  label: string;
  order: number;
  wip_limit?: number;
}

/** Kanban board configuration: column definitions and the default intake column. */
export interface BundleKanban {
  columns: BundleKanbanColumn[];
  /** slug of the column where new issues are placed. */
  defaultColumn: string;
}

/** An agent team member with an optional inline or external charter. */
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

/** A ceremony definition: trigger, workflow steps, and optional inline YAML. */
export interface BundleCeremony {
  id: string;
  name: string;
  scope: 'project' | 'board' | 'task';
  /** Discriminated union: standard triggers or GitHub webhook trigger (kind='github'). */
  trigger: BundleCeremonyTrigger | BundleCeremonyGithubTrigger;
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

/** A standalone workflow definition, independent of a ceremony. */
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

/** A skill (prompt addendum) that can be applied to an agent's capabilities. */
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

/** A tool integration record, including its input/output schema. */
export interface BundleTool {
  key: string;
  name: string;
  description: string;
  category?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
}

/** An MCP server that agents in this project can connect to. */
export interface BundleMcpServer {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  description?: string;
  transport?: 'stdio' | 'http';
  url?: string;
}

/** A routing rule that maps an issue pattern to a named agent. */
export interface BundleRoutingRule {
  pattern: string;
  matchType: 'label' | 'keyword' | 'assignee' | 'catchall';
  agentName: string;
  priority?: number;
  rawRule?: string;
}

/** An agent definition with an optional inline or external charter. */
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

/** Result returned by the Squadboard bundle loader after applying a bundle. */
export interface ApplyResult {
  applied: string[];
  skipped: string[];
  warnings: string[];
  errors: string[];
}
