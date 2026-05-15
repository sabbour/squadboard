import { pgTable, uuid, text, timestamp, integer, boolean, pgEnum, primaryKey, numeric, jsonb, uniqueIndex, customType } from 'drizzle-orm/pg-core';

// Bytea custom type — stores binary data (images, blobs) in PostgreSQL BYTEA columns.
// The pg driver delivers bytea columns as Node.js Buffer objects, so no conversion needed.
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() { return 'bytea'; },
});

export const agentStatusEnum = pgEnum('agent_status', ['active', 'disabled', 'retired']);

export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  path: text('path').notNull(), // path to .squad/ directory
  monthlyBudgetUsd: numeric('monthly_budget_usd', { precision: 10, scale: 2 }), // opt-in budget cap
  // Demo 15: GitHub Sync (OQ #8 resolution — OFF by default, opt-in per project)
  githubSyncEnabled: boolean('github_sync_enabled').notNull().default(false),
  githubToken: text('github_token'),            // PAT stored plaintext (hacking phase; use secrets manager in prod)
  githubOwner: text('github_owner'),            // GitHub org or user
  githubRepo: text('github_repo'),              // GitHub repository name
  githubSyncLastAt: timestamp('github_sync_last_at', { withTimezone: true }), // timestamp of last successful pull
  // GitHub App auth (follow-up to Demo 15 PAT auth — null means PAT for backward compat)
  githubAuthType: text('github_auth_type'),            // 'pat' | 'app' — null treated as 'pat'
  githubAppId: text('github_app_id'),                  // numeric GitHub App ID as string
  githubAppInstallationId: text('github_app_installation_id'), // installation ID for this repo
  githubAppPrivateKey: text('github_app_private_key'), // PEM private key, plaintext (hacking phase)
  // Project-level default model used by the auto-model resolution chain
  // (sdk/model-defaults.ts). Null means "use BUILTIN_FALLBACK".
  defaultModel: text('default_model'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const settings = pgTable('settings', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: text('key').notNull().unique(),
  value: text('value'),
  projectId: uuid('project_id').references(() => projects.id),
});

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type Setting = typeof settings.$inferSelect;
export type NewSetting = typeof settings.$inferInsert;

export const agents = pgTable('agents', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  role: text('role').notNull(),
  model: text('model'),
  status: agentStatusEnum('status').notNull().default('active'),
  charterPath: text('charter_path').notNull(),
  historyPath: text('history_path'),
  charterHash: text('charter_hash'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Agent = typeof agents.$inferSelect;
export type NewAgent = typeof agents.$inferInsert;

// ---------------------------------------------------------------------------
// Board data layer — Demo 2
// ---------------------------------------------------------------------------

export const columnStatusEnum = pgEnum('column_status', ['backlog', 'todo', 'in_progress', 'in_review', 'done']);

export const issues = pgTable('issues', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  body: text('body').default(''),
  status: columnStatusEnum('status').notNull().default('backlog'),
  assigneeId: uuid('assignee_id'), // references agents.id later
  position: integer('position').notNull().default(0),
  archived: integer('archived').notNull().default(0), // 0 = active, 1 = archived (soft delete)
  /** Optimistic concurrency token (Demo 12 / OQ #6). Incremented on every PATCH. */
  version: integer('version').notNull().default(1),
  // Demo 15: GitHub Sync fields
  githubIssueNumber: integer('github_issue_number'),  // linked GitHub issue number
  githubIssueUrl: text('github_issue_url'),            // html_url of the GitHub issue
  githubNodeId: text('github_node_id'),                // GitHub GraphQL node_id
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const comments = pgTable('comments', {
  id: uuid('id').primaryKey().defaultRandom(),
  issueId: uuid('issue_id').notNull().references(() => issues.id, { onDelete: 'cascade' }),
  body: text('body').notNull(),
  authorId: uuid('author_id'), // null = system or unknown
  // Demo 15: GitHub Sync
  githubCommentId: text('github_comment_id'),  // GitHub comment ID (stringified integer)
  // Phase 9: multi-actor timeline
  authorKind: text('author_kind').notNull().default('human'), // 'human' | 'agent' | 'system'
  authorRef: text('author_ref'),                                // user id, agent id, or system source (nullable)
  mentions: jsonb('mentions').notNull().default([]),            // string[] of agent ids mentioned via @
  eventKind: text('event_kind'),                                // when authorKind='system': run.started | deliverable.submitted | review.requested_changes | column.changed | …
  eventPayload: jsonb('event_payload'),                         // structured payload for system events
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const labels = pgTable('labels', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  color: text('color').notNull().default('#388bfd'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const issueLabels = pgTable('issue_labels', {
  issueId: uuid('issue_id').notNull().references(() => issues.id, { onDelete: 'cascade' }),
  labelId: uuid('label_id').notNull().references(() => labels.id, { onDelete: 'cascade' }),
}, (t) => ({ pk: primaryKey({ columns: [t.issueId, t.labelId] }) }));

export type Issue = typeof issues.$inferSelect;
export type NewIssue = typeof issues.$inferInsert;
export type Comment = typeof comments.$inferSelect;
export type NewComment = typeof comments.$inferInsert;
export type Label = typeof labels.$inferSelect;
export type NewLabel = typeof labels.$inferInsert;

// ---------------------------------------------------------------------------
// Column metadata overlay — Phase 8 vertical slice (2026-05-15)
// Stores per-project display overrides for the 5 hard-coded column_status enum
// values. Does NOT replace the enum; Phase 8 proper will do that later.
// Color is stored as a 6-digit hex string (e.g. '#1f6feb').
// ---------------------------------------------------------------------------
export const columnMeta = pgTable(
  'column_meta',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    columnId: text('column_id').notNull(), // 'backlog'|'todo'|'in_progress'|'in_review'|'done'
    label: text('label').notNull(),
    description: text('description'),
    color: text('color').notNull(),        // '#rrggbb' hex
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    uqProjectColumn: uniqueIndex('column_meta_project_column_uq').on(t.projectId, t.columnId),
  }),
);

export type ColumnMeta = typeof columnMeta.$inferSelect;
export type NewColumnMeta = typeof columnMeta.$inferInsert;

// ---------------------------------------------------------------------------
// Engine data layer — Demo 4 / Demo 5
// ---------------------------------------------------------------------------

// Demo 10 adds 'splitting' (fan_out in progress) and 'waiting_children' (fan_out waiting for children)
export const runStatusEnum = pgEnum('run_status', ['pending', 'running', 'completed', 'failed', 'cancelled', 'splitting', 'waiting_children']);
export const workspaceStrategyEnum = pgEnum('workspace_strategy', ['scratch', 'dir', 'worktree']);

// Invariant 1: routing desugars to issue_runs with kind='agent_run'.
// 'specifier_run' is the Tier-3 LLM routing variant (AC Demo 8 Durability-1).
export const issueRunKindEnum = pgEnum('issue_run_kind', ['agent_run', 'route', 'peer_review', 'split', 'specifier_run']);

export const issueRuns = pgTable('issue_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  issueId: uuid('issue_id').notNull().references(() => issues.id, { onDelete: 'cascade' }),
  agentId: uuid('agent_id').notNull().references(() => agents.id),
  kind: issueRunKindEnum('kind').notNull().default('agent_run'),
  status: runStatusEnum('status').notNull().default('pending'),
  workspaceStrategy: workspaceStrategyEnum('workspace_strategy').notNull().default('scratch'),
  workspacePath: text('workspace_path'),
  // Demo 9: back-reference to the approve step_run that spawned this peer_review run.
  stepRunId: uuid('step_run_id'),
  // Demo 9: additional context prepended to issueBody for peer_review runs.
  inputContext: text('input_context'),
  leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
  heartbeatAt: timestamp('heartbeat_at', { withTimezone: true }),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  output: text('output'),
  errorMessage: text('error_message'),
  // Legacy total-token field kept for backward compat
  costTokens: integer('cost_tokens').default(0),
  // Demo 7: granular token tracking
  inputTokens: integer('input_tokens').default(0),
  outputTokens: integer('output_tokens').default(0),
  costUsd: text('cost_usd').default('0'),
  // Demo 8: routing audit fields
  routingTier: integer('routing_tier'),        // 1 | 2 | 3 — which tier resolved this run
  routingScore: numeric('routing_score', { precision: 5, scale: 4 }), // Tier-2 keyword score
  routingReasoning: text('routing_reasoning'), // Tier-3 LLM reasoning or Tier-2 score breakdown
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const workflowRuns = pgTable('workflow_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  issueId: uuid('issue_id').notNull().references(() => issues.id),
  workflowVersionId: uuid('workflow_version_id'), // set when a versioned workflow drives this run
  status: runStatusEnum('status').notNull().default('pending'),
  currentStepIndex: integer('current_step_index').default(0),
  // Demo 9: peer review blocking policy ('first' | 'majority' | 'all') — default GitHub semantics
  requestChangesPolicy: text('request_changes_policy').default('first'),
  // Demo 10: fan_out / child workflow support (Invariant 5)
  parentWorkflowRunId: text('parent_workflow_run_id'),   // UUID stored as text (self-referential)
  childWorkflowRunIds: jsonb('child_workflow_run_ids').default('[]'), // string[]
  pinnedAgentRevisions: text('pinned_agent_revisions'),  // JSON: {agentName: charterHash}; inherited from parent
  variables: jsonb('variables').default('{}'),            // propagated from parent on fan_out
  inlineStepsJson: text('inline_steps_json'),            // JSON: WorkflowStep[] for fan_out child workflows
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const stepRuns = pgTable('step_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  workflowRunId: uuid('workflow_run_id').notNull().references(() => workflowRuns.id, { onDelete: 'cascade' }),
  issueRunId: uuid('issue_run_id').references(() => issueRuns.id),
  stepIndex: integer('step_index').notNull(),
  stepType: text('step_type').notNull(),
  status: runStatusEnum('status').notNull().default('pending'),
  pinnedAgentRevisions: text('pinned_agent_revisions'), // JSON: {agentName: charterHash}; snapshotted at step start
  // Demo 7: retry policy
  retryCount: integer('retry_count').default(0),
  maxRetries: integer('max_retries').default(3),
  retryDelay: integer('retry_delay').default(0), // ms delay before next retry (reserved for future use)
  // Demo 7: lease for step-level crash recovery
  leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
  heartbeatAt: timestamp('heartbeat_at', { withTimezone: true }),
  // Demo 9: peer review outcome fields (set when this step_run is an approve step)
  reviewDecision: text('review_decision'),     // 'approve' | 'request_changes'
  reviewComment: text('review_comment'),
  reviewSuggestions: jsonb('review_suggestions'), // string[]
  // Demo 10: fan_out step support (Invariant 5)
  splitTargets: jsonb('split_targets'),          // resolved split targets (SplitTarget[])
  output: text('output'),                        // step output; fan_out merges children outputs here
  stepConfig: jsonb('step_config'),              // inline step config for fan_out child steps (WorkflowStep)
  resolvedAgentId: text('resolved_agent_id'),    // pre-resolved agent UUID for agent_run in fan_out children
  // Phase 15: stamped by spawnFanOutChildren() when a fan_out runs in parallel mode
  sessionId: text('session_id'),                 // opaque SDK session id (when spawned via SDK spawnParallel)
  startedAt: timestamp('started_at', { withTimezone: true }),            // when spawn flipped this step_run to 'running'
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type IssueRun = typeof issueRuns.$inferSelect;
export type NewIssueRun = typeof issueRuns.$inferInsert;
export type WorkflowRun = typeof workflowRuns.$inferSelect;
export type NewWorkflowRun = typeof workflowRuns.$inferInsert;
export type StepRun = typeof stepRuns.$inferSelect;
export type NewStepRun = typeof stepRuns.$inferInsert;

// ---------------------------------------------------------------------------
// Peer review audit trail — Demo 9
// ---------------------------------------------------------------------------

// All 4 review verbs are recorded here: approve, request_changes, comment, dismiss.
// Invariant 1: peer_review desugars to issue_runs; review_events captures the outcome.
// Phase 9: stepRunId becomes nullable so deliverable reviews can use this same
// table; deliverableId joins to the deliverables table. CHECK constraint
// (enforced in db/index.ts DDL) requires exactly one of stepRunId/deliverableId.
export const reviewEvents = pgTable('review_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  workflowRunId: uuid('workflow_run_id').references(() => workflowRuns.id, { onDelete: 'cascade' }),
  stepRunId: uuid('step_run_id').references(() => stepRuns.id, { onDelete: 'cascade' }),
  deliverableId: uuid('deliverable_id'),       // FK to deliverables(id) added at runtime; declared in deliverables table for clarity
  issueRunId: uuid('issue_run_id').references(() => issueRuns.id), // the peer_review issueRun, null for human reviews
  reviewerAgentId: uuid('reviewer_agent_id').references(() => agents.id), // null for human reviewers
  reviewerName: text('reviewer_name'), // display name (human or agent name)
  verb: text('verb').notNull(), // 'approve' | 'request_changes' | 'comment' | 'dismiss'
  body: text('body'),
  suggestions: jsonb('suggestions'), // string[] — structured suggestions from request_changes
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type ReviewEvent = typeof reviewEvents.$inferSelect;
export type NewReviewEvent = typeof reviewEvents.$inferInsert;

// ---------------------------------------------------------------------------
// Routing tier 1 — Demo 5
// ---------------------------------------------------------------------------

// Cache of compiled routing rules loaded from .squad/routing.md
export const routingRules = pgTable('routing_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  priority: integer('priority').notNull().default(0),
  pattern: text('pattern').notNull(),       // the match pattern (label, keyword, etc.)
  matchType: text('match_type').notNull(),  // 'label' | 'keyword' | 'assignee' | 'catchall'
  agentName: text('agent_name').notNull(),  // target agent name
  rawRule: text('raw_rule').notNull(),      // original line from routing.md
  loadedAt: timestamp('loaded_at', { withTimezone: true }).notNull().defaultNow(),
});

export type RoutingRule = typeof routingRules.$inferSelect;
export type NewRoutingRule = typeof routingRules.$inferInsert;

// ---------------------------------------------------------------------------
// YAML Workflow definitions — Demo 6
// ---------------------------------------------------------------------------

export const workflows = pgTable('workflows', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  slug: text('slug').notNull(),         // kebab-case identifier
  description: text('description'),
  // Phase 10: Ceremonies unification — trigger taxonomy. Workflows are now a
  // triggerKind of "ceremony"; the DB table keeps the historical name.
  //   triggerKind:   'on_issue_entry' | 'on_schedule' | 'on_event' | 'manual'
  //   triggerConfig: shape depends on triggerKind (see routes/ceremonies.ts).
  //   kind:          'workflow' | 'ceremony' | 'review_policy' | 'narrative'
  triggerKind: text('trigger_kind').notNull().default('on_issue_entry'),
  triggerConfig: jsonb('trigger_config').notNull().default({}),
  kind: text('kind').notNull().default('ceremony'),
  // Phase 11: lifecycle status — controls whether the scheduler / event
  //   dispatcher will fire this ceremony.
  //   'active'   : eligible for triggers
  //   'draft'    : freshly translated, awaiting human review (review page)
  //   'paused'   : temporarily disabled (kept for future UX; not auto-set)
  //   'archived' : soft-deleted; hidden from default lists
  status: text('status').notNull().default('active'),
  // Phase 11: when this row is an executable translation of a narrative,
  //   parentNarrativeId points back at the kind='narrative' source. NULL
  //   when the ceremony was authored directly (not derived from prose).
  parentNarrativeId: uuid('parent_narrative_id'),
  // Phase 11: translation failure surface. Populated on a failed convert /
  //   translate attempt; cleared when a retry succeeds.
  lastTranslationError: text('last_translation_error'),
  lastTranslationAttemptAt: timestamp('last_translation_attempt_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Immutable versioned snapshots; updates create a new version row.
export const workflowVersions = pgTable('workflow_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  workflowId: uuid('workflow_id').notNull().references(() => workflows.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),     // monotonic, starting at 1
  yamlContent: text('yaml_content').notNull(),
  jsonSchema: text('json_schema'),           // parsed JSON Schema for output validation (Invariant 4)
  pinnedAgentRevisions: text('pinned_agent_revisions'), // JSON: {agentName: charterHash}
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Links an issue to the active workflow version it runs under.
export const issueWorkflows = pgTable('issue_workflows', {
  issueId: uuid('issue_id').primaryKey().references(() => issues.id, { onDelete: 'cascade' }),
  workflowVersionId: uuid('workflow_version_id').notNull().references(() => workflowVersions.id),
  attachedAt: timestamp('attached_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Workflow = typeof workflows.$inferSelect;
export type NewWorkflow = typeof workflows.$inferInsert;
export type WorkflowVersion = typeof workflowVersions.$inferSelect;
export type NewWorkflowVersion = typeof workflowVersions.$inferInsert;
export type IssueWorkflow = typeof issueWorkflows.$inferSelect;
export type NewIssueWorkflow = typeof issueWorkflows.$inferInsert;

// ---------------------------------------------------------------------------
// Phase 10 — Ceremony schedules (recurring on_schedule triggers)
// ---------------------------------------------------------------------------
// One row per scheduled ceremony. The heartbeat sweep picks up any row with
// nextFireAt <= now() and enabled=true, spawns a workflowRun, then advances
// nextFireAt using cron-parser.
export const ceremonySchedules = pgTable('ceremony_schedules', {
  id: uuid('id').primaryKey().defaultRandom(),
  workflowId: uuid('workflow_id').notNull().references(() => workflows.id, { onDelete: 'cascade' }),
  cronExpr: text('cron_expr').notNull(),
  timezone: text('timezone').notNull().default('UTC'),
  nextFireAt: timestamp('next_fire_at', { withTimezone: true }).notNull(),
  lastFiredAt: timestamp('last_fired_at', { withTimezone: true }),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type CeremonySchedule = typeof ceremonySchedules.$inferSelect;
export type NewCeremonySchedule = typeof ceremonySchedules.$inferInsert;

// ---------------------------------------------------------------------------
// Demo 8 — Routing Tiers 2 + 3
// ---------------------------------------------------------------------------

/**
 * Cached keyword sets extracted from each agent's charter.md.
 * Populated on agent sync; consumed by Tier-2 keyword scoring.
 */
export const agentKeywords = pgTable('agent_keywords', {
  agentId: uuid('agent_id').primaryKey().references(() => agents.id, { onDelete: 'cascade' }),
  // JSON-serialized string[]: keywords extracted from Skills/Expertise section
  keywords: text('keywords').notNull().default('[]'),
  // Focus areas extracted from charter (used for label matching in Tier 2)
  focusAreas: text('focus_areas').notNull().default('[]'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type AgentKeywords = typeof agentKeywords.$inferSelect;
export type NewAgentKeywords = typeof agentKeywords.$inferInsert;

/**
 * Immutable audit log of every routing decision (all tiers).
 * One row per issue that enters the router — logged regardless of which tier matched.
 */
export const routingLog = pgTable('routing_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  issueId: uuid('issue_id').references(() => issues.id, { onDelete: 'set null' }),
  // Which tier produced the match (1 | 2 | 3); null if all tiers missed (triage)
  tier: integer('tier'),
  resolvedAgent: text('resolved_agent'),
  matchedRule: text('matched_rule'),             // Tier-1 rawRule, Tier-2 pattern, 'llm' for Tier-3
  score: numeric('score', { precision: 5, scale: 4 }), // Tier-2 keyword score
  reasoning: text('reasoning'),                  // Tier-3 LLM reasoning or Tier-2 score breakdown
  // The issueRun created for specifier_run (Tier-3 only)
  specifierRunId: uuid('specifier_run_id').references(() => issueRuns.id, { onDelete: 'set null' }),
  decidedAt: timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
});

export type RoutingLog = typeof routingLog.$inferSelect;
export type NewRoutingLog = typeof routingLog.$inferInsert;

// ---------------------------------------------------------------------------
// Demo 10 — Fan-Out + Handoff (Invariant 5)
// ---------------------------------------------------------------------------

/**
 * issue_links: records the parent→child relationship created by fan_out materialisation.
 * One row per child issue per fan_out invocation.
 */
export const issueLinks = pgTable('issue_links', {
  id: uuid('id').primaryKey().defaultRandom(),
  parentIssueId: uuid('parent_issue_id').notNull().references(() => issues.id, { onDelete: 'cascade' }),
  childIssueId: uuid('child_issue_id').notNull().references(() => issues.id, { onDelete: 'cascade' }),
  linkType: text('link_type').notNull().default('fan_out'), // 'fan_out' | 'handoff'
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type IssueLink = typeof issueLinks.$inferSelect;
export type NewIssueLink = typeof issueLinks.$inferInsert;

/**
 * handoff_context: stores variables, message, and split-target info propagated
 * from parent to each child during fan_out materialization or a handoff step.
 */
export const handoffContext = pgTable('handoff_context', {
  id: uuid('id').primaryKey().defaultRandom(),
  workflowRunId: uuid('workflow_run_id').notNull().references(() => workflowRuns.id, { onDelete: 'cascade' }),
  stepRunId: uuid('step_run_id').notNull().references(() => stepRuns.id, { onDelete: 'cascade' }),
  targetIssueId: uuid('target_issue_id').references(() => issues.id, { onDelete: 'set null' }),
  // Serialised context: includes splitTarget info, inherited variables, handoff message
  contextJson: jsonb('context_json').notNull().default('{}'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type HandoffContext = typeof handoffContext.$inferSelect;
export type NewHandoffContext = typeof handoffContext.$inferInsert;

// ---------------------------------------------------------------------------
// Demo 15 — GitHub Sync
// ---------------------------------------------------------------------------

/**
 * Audit log for every GitHub sync operation (push or pull).
 * One row per entity (issue or comment) per sync attempt.
 */
export const githubSyncLog = pgTable('github_sync_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  direction: text('direction').notNull(),    // 'push' | 'pull'
  entityType: text('entity_type').notNull(), // 'issue' | 'comment' | 'batch'
  entityId: text('entity_id').notNull(),     // local UUID or GitHub number as string
  githubNumber: integer('github_number'),    // GitHub issue / comment number (if known)
  status: text('status').notNull(),          // 'ok' | 'error'
  errorMsg: text('error_msg'),
  syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
});

export type GithubSyncLog = typeof githubSyncLog.$inferSelect;
export type NewGithubSyncLog = typeof githubSyncLog.$inferInsert;

// ---------------------------------------------------------------------------
// Live multi-agent sessions (Squad-IRL "run-first" slice)
// ---------------------------------------------------------------------------
//
// A live_session is a free-form, multi-turn conversation against one or more
// agents in a project. It is intentionally separate from `issue_runs` (which
// are issue-scoped, one-shot, workflow-driven) — live sessions are the web
// equivalent of `squad` shell sessions.
//
// Each session aggregates token + cost totals across its turns; events are
// captured into live_session_events for the timeline view.

export const liveSessionStatusEnum = pgEnum('live_session_status', [
  'active',
  'idle',
  'completed',
  'failed',
  'cancelled',
]);

export const liveSessions = pgTable('live_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'set null' }),
  agentName: text('agent_name'),                  // snapshot — survives agent rename/delete
  title: text('title'),                           // first prompt summary, or user-supplied
  status: liveSessionStatusEnum('status').notNull().default('active'),
  model: text('model'),                           // SDK model id used for this session
  sdkSessionId: text('sdk_session_id'),           // SquadClient session id (opaque)
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  costUsd: numeric('cost_usd', { precision: 12, scale: 6 }).notNull().default('0'),
  turnCount: integer('turn_count').notNull().default(0),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});

export const liveSessionEvents = pgTable('live_session_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id').notNull().references(() => liveSessions.id, { onDelete: 'cascade' }),
  // Mirrors SessionEventType in realtime/event-bus.ts:
  // 'session.started' | 'session.message' | 'session.delta' | 'session.tool'
  // | 'session.usage' | 'session.error' | 'session.completed'
  type: text('type').notNull(),
  // Free-form payload — message body, delta chunk, tool name+args, usage tuple, etc.
  payload: jsonb('payload').notNull().default('{}'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type LiveSession = typeof liveSessions.$inferSelect;
export type NewLiveSession = typeof liveSessions.$inferInsert;
export type LiveSessionEvent = typeof liveSessionEvents.$inferSelect;
export type NewLiveSessionEvent = typeof liveSessionEvents.$inferInsert;

// ---------------------------------------------------------------------------
// Phase 8: Review policies — workflow approve-step primitives
// ---------------------------------------------------------------------------

// Named, reusable policy bundles. scope='system' rows are shipped with
// Squadboard and seeded idempotently on bootstrap (matched by slug).
// scope='project' rows are user-defined within a project.
//
// payload jsonb shape: ReviewPolicyPayload (see services/review-policy-resolver.ts)
export const reviewPolicyPresets = pgTable('review_policy_presets', {
  id: uuid('id').primaryKey().defaultRandom(),
  scope: text('scope').notNull(), // 'system' | 'project' (CHECK constraint enforced in DDL)
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  slug: text('slug').notNull(),   // stable identifier within (scope, projectId)
  name: text('name').notNull(),   // display label
  description: text('description'),
  payload: jsonb('payload').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Scope-level inherited defaults. UNIQUE(scope, scopeId) guarantees a single
// default per scope-instance. scope='board' is enum-allowed but rejected at
// the route layer until the boards table lands (Phase 8 boards work).
export const reviewPolicyDefaults = pgTable('review_policy_defaults', {
  id: uuid('id').primaryKey().defaultRandom(),
  scope: text('scope').notNull(), // 'project' | 'board'
  scopeId: uuid('scope_id').notNull(),
  payload: jsonb('payload').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type ReviewPolicyPreset = typeof reviewPolicyPresets.$inferSelect;
export type NewReviewPolicyPreset = typeof reviewPolicyPresets.$inferInsert;
export type ReviewPolicyDefault = typeof reviewPolicyDefaults.$inferSelect;
export type NewReviewPolicyDefault = typeof reviewPolicyDefaults.$inferInsert;

// ---------------------------------------------------------------------------
// Phase 9: Deliverables — first-class artifact records produced by runs.
// ---------------------------------------------------------------------------
//
// Joins issues ↔ runs ↔ artifacts. A deliverable is the reviewable form of
// what a run produced (raw text from issueRuns.output / stepRuns.output).
// kind drives the kind-specific viewer on the client (text → markdown,
// files → diff/code, links → preview, structured → JSON tree).
//
// Status lifecycle:
//   draft       — not yet visible to reviewers
//   submitted   — auto-extracted from a successful run, awaiting review
//   approved    — accepted via review action
//   changes_requested — review_event with verb='request_changes' captured
//   superseded  — replaced by a newer deliverable (forward-only in v1)
//
// supersededByDeliverableId points at the new deliverable that replaced
// this one (if any) — set when a revision-spawn run produces a new
// deliverable for the same issue.
export const deliverables = pgTable('deliverables', {
  id: uuid('id').primaryKey().defaultRandom(),
  issueId: uuid('issue_id').notNull().references(() => issues.id, { onDelete: 'cascade' }),
  runId: uuid('run_id'),                               // issue_run that produced this; nullable for human-uploaded
  stepRunId: uuid('step_run_id'),                      // step_run that produced this (workflow case); nullable
  kind: text('kind').notNull(),                        // 'text' | 'files' | 'links' | 'structured'
  title: text('title').notNull(),
  summary: text('summary'),
  payload: jsonb('payload').notNull(),                 // kind-specific shape
  status: text('status').notNull().default('submitted'), // draft | submitted | approved | changes_requested | superseded
  producedAt: timestamp('produced_at', { withTimezone: true }).notNull().defaultNow(),
  supersededByDeliverableId: uuid('superseded_by_deliverable_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Deliverable = typeof deliverables.$inferSelect;
export type NewDeliverable = typeof deliverables.$inferInsert;

// ---------------------------------------------------------------------------
// Phase 14: Quick capture (AI-formulated inbox)
// ---------------------------------------------------------------------------
//
// A user types a brief, raw idea into the global "+ Capture" button or a
// per-project FAB. We store the raw draft, then call an LLM to formulate a
// clean issue (title, body, suggested labels/project/column, confidence,
// rationale). The user reviews the formulated draft and either publishes it
// to a project board (creating a real `issues` row) or saves it for later /
// discards it.
//
// userId is nullable for the single-user mode shipped in v1. Future auth
// will wire this to a `users` table.
//
// Status transitions:
//   captured  → formulated → published    (terminal — issue created)
//                         → discarded     (soft delete)
//
// publishedIssueId is set when status='published' so the inbox can link
// straight to the resulting board card.
export const inboxItems = pgTable('inbox_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id'),
  originalDraft: text('original_draft').notNull(),
  formulatedTitle: text('formulated_title'),
  formulatedBody: text('formulated_body'),
  suggestedLabels: jsonb('suggested_labels').notNull().default([]),
  suggestedProjectId: uuid('suggested_project_id').references(() => projects.id, { onDelete: 'set null' }),
  suggestedColumn: text('suggested_column'),
  confidence: text('confidence'),
  rationale: text('rationale'),
  status: text('status').notNull().default('captured'),
  publishedIssueId: uuid('published_issue_id').references(() => issues.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type InboxItem = typeof inboxItems.$inferSelect;
export type NewInboxItem = typeof inboxItems.$inferInsert;

// ---------------------------------------------------------------------------
// Phase 13: Skills, Tools, MCP servers — capability registries
// ---------------------------------------------------------------------------
//
// Three project-scoped registries, each with a per-agent join table. Skills
// are prompt-augmentation snippets prepended to an agent's system prompt;
// Tools are catalogued external actions (typically backed by an MCP server);
// MCP servers are connection definitions whose secret header values are
// AES-256-GCM encrypted at rest using `${project.path}/.secret-key`.

export const skills = pgTable('skills', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  category: text('category'),
  promptAddendum: text('prompt_addendum').notNull(),
  curatedKey: text('curated_key'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const agentSkills = pgTable('agent_skills', {
  agentId: uuid('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  skillId: uuid('skill_id').notNull().references(() => skills.id, { onDelete: 'cascade' }),
  assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ pk: primaryKey({ columns: [t.agentId, t.skillId] }) }));

export type Skill = typeof skills.$inferSelect;
export type NewSkill = typeof skills.$inferInsert;
export type AgentSkill = typeof agentSkills.$inferSelect;
export type NewAgentSkill = typeof agentSkills.$inferInsert;

export const tools = pgTable('tools', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  category: text('category'),
  // FK to mcp_servers added at runtime once mcp_servers exists.
  mcpServerId: uuid('mcp_server_id'),
  inputSchema: jsonb('input_schema'),
  outputSchema: jsonb('output_schema'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const agentTools = pgTable('agent_tools', {
  agentId: uuid('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  toolId: uuid('tool_id').notNull().references(() => tools.id, { onDelete: 'cascade' }),
  assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ pk: primaryKey({ columns: [t.agentId, t.toolId] }) }));

export type Tool = typeof tools.$inferSelect;
export type NewTool = typeof tools.$inferInsert;
export type AgentTool = typeof agentTools.$inferSelect;
export type NewAgentTool = typeof agentTools.$inferInsert;

export const mcpServers = pgTable('mcp_servers', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  transport: text('transport').notNull(), // 'http' | 'stdio'
  url: text('url'),
  command: text('command'),
  args: jsonb('args').notNull().default([]),
  // Headers stored as [{name, cipher}] — value is AES-256-GCM ciphertext (hex).
  // Plain GET responses scrub `cipher` and return [{name, hasSecret}].
  headers: jsonb('headers').notNull().default([]),
  // Per-row IV + auth tag for the headers ciphertexts (single envelope across
  // all header values to keep the schema simple). Null until first header set.
  headersIv: text('headers_iv'),
  headersTag: text('headers_tag'),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const agentMcpServers = pgTable('agent_mcp_servers', {
  agentId: uuid('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  mcpServerId: uuid('mcp_server_id').notNull().references(() => mcpServers.id, { onDelete: 'cascade' }),
  assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ pk: primaryKey({ columns: [t.agentId, t.mcpServerId] }) }));

export type McpServer = typeof mcpServers.$inferSelect;
export type NewMcpServer = typeof mcpServers.$inferInsert;
export type AgentMcpServer = typeof agentMcpServers.$inferSelect;
export type NewAgentMcpServer = typeof agentMcpServers.$inferInsert;

// ---------------------------------------------------------------------------
// Phase 17: Ask / Consult mode — free-form brainstorm sessions
// ---------------------------------------------------------------------------
//
// Distinct from `live_sessions` (Phase 1) which run an agent against an
// issue and produce deliverables. Consults are open-ended chats with either
// a hired agent (mode='agent', charter loaded, propose-only tool surface)
// or a raw model (mode='model', no tools, plain "thinking partner" system
// prompt). They never advance the workflow engine; they emit `consult.*`
// events, persist to consult_sessions/_messages, and tag cost as
// kind='consult' so the Costs page can filter them out of issue rollups.

export const consultModeEnum = pgEnum('consult_mode', ['agent', 'model']);

export const consultStatusEnum = pgEnum('consult_status', [
  'active',
  'idle',
  'completed',
  'failed',
  'cancelled',
]);

export const consultSessions = pgTable('consult_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  // Nullable — cross-project consults are allowed (the global `?` shortcut
  // opens one with no project bound).
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  // Auto-derived from the first user message; user-editable later.
  name: text('name'),
  mode: consultModeEnum('mode').notNull().default('agent'),
  // Only set when mode='agent'. NULL after agent deletion (snapshot below).
  agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'set null' }),
  agentName: text('agent_name'),
  model: text('model'),
  status: consultStatusEnum('status').notNull().default('active'),
  sdkSessionId: text('sdk_session_id'),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  costUsd: numeric('cost_usd', { precision: 12, scale: 6 }).notNull().default('0'),
  messageCount: integer('message_count').notNull().default(0),
  // When user switches mode mid-conversation we fork a new session and
  // record the parent here so the UI can render breadcrumb/lineage.
  forkedFromSessionId: uuid('forked_from_session_id'),
  errorMessage: text('error_message'),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const consultMessageRoleEnum = pgEnum('consult_message_role', [
  'user',
  'assistant',
  'system',
  'tool',
]);

export const consultMessages = pgTable('consult_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id').notNull().references(() => consultSessions.id, { onDelete: 'cascade' }),
  role: consultMessageRoleEnum('role').notNull(),
  content: text('content').notNull().default(''),
  // Assistant chain-of-thought / reasoning trace (rendered in the
  // collapsible thinking pane). Streamed deltas accumulate here.
  reasoningContent: text('reasoning_content'),
  // Populated when role='tool' (i.e. a propose_* tool result).
  toolName: text('tool_name'),
  toolArgs: jsonb('tool_args'),
  toolResult: jsonb('tool_result'),
  // Per-message usage / cost. Aggregated up to consult_sessions on each turn.
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  costUsd: numeric('cost_usd', { precision: 12, scale: 6 }),
  ts: timestamp('ts', { withTimezone: true }).notNull().defaultNow(),
});

export const consultProposalKindEnum = pgEnum('consult_proposal_kind', [
  'issue',
  'ceremony',
  'inbox_item',
  'capture_to_decision',
  'assign_agent_to_issue',
]);

export const consultProposalStatusEnum = pgEnum('consult_proposal_status', [
  'pending',
  'accepted',
  'edited',
  'discarded',
]);

// Each propose_* tool call from an agent-mode consult lands here as a
// pending proposal. The UI renders inline cards and the user clicks
// Accept (optionally with edits) or Discard. Accepting a proposal
// dispatches to the appropriate downstream API (issues, inbox,
// ceremonies/import-narrative, decisions inbox, dispatcher).
export const consultProposals = pgTable('consult_proposals', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id').notNull().references(() => consultSessions.id, { onDelete: 'cascade' }),
  // Optional pointer to the assistant message that spawned this proposal.
  messageId: uuid('message_id').references(() => consultMessages.id, { onDelete: 'set null' }),
  kind: consultProposalKindEnum('kind').notNull(),
  // Original arguments as the LLM produced them.
  payload: jsonb('payload').notNull().default({}),
  // Optional user edits captured at Accept time.
  editedPayload: jsonb('edited_payload'),
  status: consultProposalStatusEnum('status').notNull().default('pending'),
  // Downstream artefact reference once accepted — e.g. { issueId, url }.
  result: jsonb('result'),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
});

export type ConsultSession = typeof consultSessions.$inferSelect;
export type NewConsultSession = typeof consultSessions.$inferInsert;
export type ConsultMessage = typeof consultMessages.$inferSelect;
export type NewConsultMessage = typeof consultMessages.$inferInsert;
export type ConsultProposal = typeof consultProposals.$inferSelect;
export type NewConsultProposal = typeof consultProposals.$inferInsert;

// ---------------------------------------------------------------------------
// Issue Attachments — image uploads stored as bytea in PG
// ---------------------------------------------------------------------------

export const issueAttachments = pgTable('issue_attachments', {
  id:        uuid('id').primaryKey().defaultRandom(),
  issueId:   uuid('issue_id').notNull().references(() => issues.id, { onDelete: 'cascade' }),
  filename:  text('filename').notNull(),
  mimeType:  text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  content:   bytea('content').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type IssueAttachment    = typeof issueAttachments.$inferSelect;
export type NewIssueAttachment = typeof issueAttachments.$inferInsert;

// ---------------------------------------------------------------------------
// Phase 19: Templates & Portability
// ---------------------------------------------------------------------------

export const templates = pgTable('templates', {
  id:          uuid('id').primaryKey().defaultRandom(),
  kind:        text('kind').notNull(),        // 'workflow' | 'team' | 'project'
  name:        text('name').notNull(),
  description: text('description'),
  payload:     jsonb('payload').notNull(),    // serialised bundle; shape depends on kind
  // Optional: the project this template was saved from. NULL for built-ins.
  projectId:   uuid('project_id'),
  createdAt:   timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt:   timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type Template    = typeof templates.$inferSelect;
export type NewTemplate = typeof templates.$inferInsert;
