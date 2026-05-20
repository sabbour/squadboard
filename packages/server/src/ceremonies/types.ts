/**
 * types.ts — CER-3: WorkflowYaml interface for the canonical .workflow.yaml format.
 *
 * This is the in-memory representation of a serialized ceremony; it maps 1:1
 * to the canonical YAML format (apiVersion: squad.io/v1, kind: Ceremony).
 * Derived DB fields (id, createdAt, origin) are intentionally absent.
 *
 * CER-5 (W29): Extended GithubEventTriggerFilters with prSize, reviewState,
 * milestone, author, branch, and draft fields.
 */

// ---------------------------------------------------------------------------
// CER-5: Github event filter types
// ---------------------------------------------------------------------------

export interface PrSizeFilter {
  /** Minimum lines changed (additions + deletions), inclusive. */
  min?: number;
  /** Maximum lines changed (additions + deletions), inclusive. Omit = no upper bound. */
  max?: number;
}

export type ReviewStateValue = 'approved' | 'changes_requested' | 'commented' | 'dismissed';

export interface ReviewStateFilter {
  /** For pull_request_review events: payload review.state must be one of these values. */
  in: ReviewStateValue[];
}

export interface MilestoneFilter {
  /** Match if milestone title is in this list (case-sensitive exact match). */
  in?: string[];
  /** Match if milestone id is in this list. Mutually exclusive with `in`. */
  ids?: number[];
}

export interface AuthorFilter {
  /** GitHub login(s) — exact match. GitHub logins compared case-sensitively. */
  in: string[];
}

export interface BranchFilter {
  /** Base branch name(s) — exact match. */
  in: string[];
}

export interface DraftFilter {
  /** true = only draft PRs, false = only non-draft PRs. */
  equals: boolean;
}

export interface GithubEventTriggerFilters {
  /** At least one label must match (OR semantics — mirrors existing CER-3 spec). */
  labels?: string[];
  /** Path matching is evaluated by the trigger router (out of matcher scope). */
  paths?: string[];
  /** CER-5: Filter by PR size (additions + deletions). */
  prSize?: PrSizeFilter;
  /** CER-5: Filter by review state (for pull_request_review events). */
  reviewState?: ReviewStateFilter;
  /** CER-5: Filter by milestone title or id. */
  milestone?: MilestoneFilter;
  /** CER-5: Filter by PR/issue author GitHub login. */
  author?: AuthorFilter;
  /** CER-5: Filter by base branch name. */
  branch?: BranchFilter;
  /** CER-5: Filter by draft status. */
  draft?: DraftFilter;
}

// ---------------------------------------------------------------------------
// Trigger shapes
// ---------------------------------------------------------------------------

export interface GithubEventTrigger {
  type: 'github-event';
  event: string;
  filters?: GithubEventTriggerFilters;
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
  /** CER-6 (W29): The specific lifecycle signal this ceremony subscribes to. */
  signalName?: string;
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
  category?: string;
  tags?: string[];
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
