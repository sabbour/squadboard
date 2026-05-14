import { pgTable, uuid, text, timestamp, integer, pgEnum, primaryKey } from 'drizzle-orm/pg-core';

export const agentStatusEnum = pgEnum('agent_status', ['active', 'disabled', 'retired']);

export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  path: text('path').notNull(), // path to .squad/ directory
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
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
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
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
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const comments = pgTable('comments', {
  id: uuid('id').primaryKey().defaultRandom(),
  issueId: uuid('issue_id').notNull().references(() => issues.id, { onDelete: 'cascade' }),
  body: text('body').notNull(),
  authorId: uuid('author_id'), // null = system comment
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const labels = pgTable('labels', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  color: text('color').notNull().default('#388bfd'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
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
// Engine data layer — Demo 4 / Demo 5
// ---------------------------------------------------------------------------

export const runStatusEnum = pgEnum('run_status', ['pending', 'running', 'completed', 'failed', 'cancelled']);
export const workspaceStrategyEnum = pgEnum('workspace_strategy', ['scratch', 'dir', 'worktree']);

// Invariant 1: routing desugars to issue_runs with kind='agent_run'.
export const issueRunKindEnum = pgEnum('issue_run_kind', ['agent_run', 'route', 'peer_review', 'split']);

export const issueRuns = pgTable('issue_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  issueId: uuid('issue_id').notNull().references(() => issues.id, { onDelete: 'cascade' }),
  agentId: uuid('agent_id').notNull().references(() => agents.id),
  kind: issueRunKindEnum('kind').notNull().default('agent_run'),
  status: runStatusEnum('status').notNull().default('pending'),
  workspaceStrategy: workspaceStrategyEnum('workspace_strategy').notNull().default('scratch'),
  workspacePath: text('workspace_path'),
  leaseExpiresAt: timestamp('lease_expires_at'),
  heartbeatAt: timestamp('heartbeat_at'),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  output: text('output'),
  errorMessage: text('error_message'),
  costTokens: integer('cost_tokens').default(0),
  costUsd: text('cost_usd').default('0'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const workflowRuns = pgTable('workflow_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  issueId: uuid('issue_id').notNull().references(() => issues.id),
  status: runStatusEnum('status').notNull().default('pending'),
  currentStepIndex: integer('current_step_index').default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const stepRuns = pgTable('step_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  workflowRunId: uuid('workflow_run_id').notNull().references(() => workflowRuns.id, { onDelete: 'cascade' }),
  issueRunId: uuid('issue_run_id').references(() => issueRuns.id),
  stepIndex: integer('step_index').notNull(),
  stepType: text('step_type').notNull(),
  status: runStatusEnum('status').notNull().default('pending'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export type IssueRun = typeof issueRuns.$inferSelect;
export type NewIssueRun = typeof issueRuns.$inferInsert;
export type WorkflowRun = typeof workflowRuns.$inferSelect;
export type NewWorkflowRun = typeof workflowRuns.$inferInsert;
export type StepRun = typeof stepRuns.$inferSelect;
export type NewStepRun = typeof stepRuns.$inferInsert;

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
  loadedAt: timestamp('loaded_at').notNull().defaultNow(),
});

export type RoutingRule = typeof routingRules.$inferSelect;
export type NewRoutingRule = typeof routingRules.$inferInsert;
