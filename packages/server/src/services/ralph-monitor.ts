import { and, eq, inArray } from 'drizzle-orm';
import { getDb, getPool, schema } from '../db/index.js';
import type { Sweep, SweepResult } from '../engine/heartbeat.js';
import { eventBus } from '../realtime/event-bus.js';

export const RALPH_MONITOR_STATES = ['active', 'paused', 'idle', 'stopped'] as const;
export type RalphMonitorState = typeof RALPH_MONITOR_STATES[number];

export type RalphWorkCandidateKind =
  | 'ready_unassigned_card'
  | 'member_assigned_pickup'
  | 'ci_failure'
  | 'review_changes'
  | 'auto_merge_pr'
  | 'draft_attention';

export interface RalphWorkCandidate {
  id: string;
  kind: RalphWorkCandidateKind;
  projectId: string;
  title: string;
  createdAt: string;
  issueId?: string;
  runId?: string;
  agentId?: string;
  agentName?: string;
  prNumber?: number;
  metadata?: Record<string, unknown>;
}

export interface RalphMonitorSettings {
  projectId: string;
  autonomyEnabled: boolean;
  autoMergeEnabled: boolean;
  state: RalphMonitorState;
  lastAction: RalphMonitorActionSummary | null;
  nextAction: RalphMonitorActionSummary | null;
  lastDecisionAt: string | null;
}

export interface RalphMonitorActionSummary {
  type: string;
  label: string;
  outcome?: string;
  targetId?: string;
  targetType?: string;
  runId?: string;
  detail?: string;
  at: string;
}

export interface RalphMonitorDecision {
  kind: 'action' | 'no_action';
  reason: string;
  nextState: RalphMonitorState;
  selected: RalphWorkCandidate | null;
  action: RalphMonitorActionSummary | null;
  lastAction: RalphMonitorActionSummary;
  nextAction: RalphMonitorActionSummary | null;
}

export interface RalphMonitorAuditRecord {
  projectId: string;
  state: RalphMonitorState;
  decision: 'action' | 'no_action';
  action: string;
  reason: string;
  selectedKind: RalphWorkCandidateKind | null;
  targetType: string | null;
  targetId: string | null;
  payload: Record<string, unknown>;
}

export interface RalphMonitorSweepResult {
  status: RalphMonitorSettings;
  decision: RalphMonitorDecision;
  candidates: RalphWorkCandidate[];
  audit: RalphMonitorAuditRecord;
}

type ProjectMonitorRow = {
  id: string;
  ralphAutonomyEnabled?: boolean | null;
  ralphAutoMergeEnabled?: boolean | null;
  ralphMonitorState?: string | null;
  ralphMonitorLastAction?: unknown;
  ralphMonitorNextAction?: unknown;
  ralphMonitorLastDecisionAt?: Date | string | null;
};

type CandidateRow = Record<string, unknown> & {
  id?: string | null;
  issue_id?: string | null;
  run_id?: string | null;
  agent_id?: string | null;
  agent_name?: string | null;
  title?: string | null;
  created_at?: Date | string | null;
  pr_number?: number | string | null;
};

const PRIORITY: Record<RalphWorkCandidateKind, number> = {
  ready_unassigned_card: 10,
  member_assigned_pickup: 20,
  ci_failure: 30,
  review_changes: 40,
  auto_merge_pr: 50,
  draft_attention: 60,
};

function isRalphMonitorState(value: unknown): value is RalphMonitorState {
  return typeof value === 'string' && (RALPH_MONITOR_STATES as readonly string[]).includes(value);
}

export function assertRalphMonitorState(value: unknown): asserts value is RalphMonitorState {
  if (!isRalphMonitorState(value)) {
    throw Object.assign(
      new Error(`state must be one of: ${RALPH_MONITOR_STATES.join(', ')}`),
      { status: 400 },
    );
  }
}

function iso(value: Date | string | null | undefined): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return new Date(0).toISOString();
}

function nowIso(now: Date): string {
  return now.toISOString();
}

function actionTypeForCandidate(kind: RalphWorkCandidateKind): string {
  switch (kind) {
    case 'ready_unassigned_card':
      return 'route_ready_card';
    case 'member_assigned_pickup':
      return 'dispatch_assigned_issue';
    case 'ci_failure':
      return 'surface_ci_failure';
    case 'review_changes':
      return 'route_review_feedback';
    case 'auto_merge_pr':
      return 'merge_approved_green_pr';
    case 'draft_attention':
      return 'surface_draft_pr';
  }
}

function labelForCandidate(candidate: RalphWorkCandidate): string {
  switch (candidate.kind) {
    case 'ready_unassigned_card':
      return `Triage Ready card: ${candidate.title}`;
    case 'member_assigned_pickup':
      return `Dispatch assigned issue to ${candidate.agentName ?? 'assigned agent'}: ${candidate.title}`;
    case 'ci_failure':
      return `Investigate failing CI on PR #${candidate.prNumber ?? 'unknown'}: ${candidate.title}`;
    case 'review_changes':
      return `Address requested changes: ${candidate.title}`;
    case 'auto_merge_pr':
      return `Auto-merge approved green PR #${candidate.prNumber ?? 'unknown'}: ${candidate.title}`;
    case 'draft_attention':
      return `Check draft PR #${candidate.prNumber ?? 'unknown'}: ${candidate.title}`;
  }
}

function targetTypeForCandidate(candidate: RalphWorkCandidate): string {
  if (candidate.runId) return 'issue_run';
  if (candidate.issueId) return 'issue';
  return 'candidate';
}

function targetIdForCandidate(candidate: RalphWorkCandidate): string {
  return candidate.runId ?? candidate.issueId ?? candidate.id;
}

function normalizeActionSummary(value: unknown): RalphMonitorActionSummary | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.type !== 'string' || typeof record.label !== 'string') return null;
  return {
    type: record.type,
    label: record.label,
    outcome: typeof record.outcome === 'string' ? record.outcome : undefined,
    targetId: typeof record.targetId === 'string' ? record.targetId : undefined,
    targetType: typeof record.targetType === 'string' ? record.targetType : undefined,
    runId: typeof record.runId === 'string' ? record.runId : undefined,
    detail: typeof record.detail === 'string' ? record.detail : undefined,
    at: typeof record.at === 'string' ? record.at : new Date(0).toISOString(),
  };
}

export function normalizeRalphMonitorSettings(row: ProjectMonitorRow): RalphMonitorSettings {
  const autonomyEnabled = row.ralphAutonomyEnabled === true;
  const state = autonomyEnabled && isRalphMonitorState(row.ralphMonitorState)
    ? row.ralphMonitorState
    : 'stopped';

  return {
    projectId: row.id,
    autonomyEnabled,
    autoMergeEnabled: row.ralphAutoMergeEnabled === true,
    state,
    lastAction: normalizeActionSummary(row.ralphMonitorLastAction),
    nextAction: normalizeActionSummary(row.ralphMonitorNextAction),
    lastDecisionAt: row.ralphMonitorLastDecisionAt
      ? iso(row.ralphMonitorLastDecisionAt)
      : null,
  };
}

export function prioritizeRalphWork(
  candidates: RalphWorkCandidate[],
  settings: Pick<RalphMonitorSettings, 'autoMergeEnabled'>,
): RalphWorkCandidate | null {
  const eligible = candidates.filter((candidate) =>
    candidate.kind !== 'auto_merge_pr' || settings.autoMergeEnabled,
  );

  eligible.sort((a, b) => {
    const priorityDelta = PRIORITY[a.kind] - PRIORITY[b.kind];
    if (priorityDelta !== 0) return priorityDelta;
    const timeDelta = Date.parse(a.createdAt) - Date.parse(b.createdAt);
    if (Number.isFinite(timeDelta) && timeDelta !== 0) return timeDelta;
    return a.id.localeCompare(b.id);
  });

  return eligible[0] ?? null;
}

export function decideRalphMonitor(input: {
  settings: RalphMonitorSettings;
  candidates: RalphWorkCandidate[];
  now?: Date;
}): RalphMonitorDecision {
  const now = input.now ?? new Date();
  const at = nowIso(now);
  const { settings } = input;

  if (!settings.autonomyEnabled) {
    return {
      kind: 'no_action',
      reason: 'autonomy_disabled',
      nextState: 'stopped',
      selected: null,
      action: null,
      lastAction: {
        type: 'none',
        label: 'Ralph autonomy is disabled for this project',
        outcome: 'blocked',
        at,
      },
      nextAction: {
        type: 'enable_opt_in',
        label: 'Enable Ralph autonomy to start monitoring',
        at,
      },
    };
  }

  if (settings.state === 'paused' || settings.state === 'stopped') {
    return {
      kind: 'no_action',
      reason: `monitor_${settings.state}`,
      nextState: settings.state,
      selected: null,
      action: null,
      lastAction: {
        type: 'none',
        label: `Ralph monitor is ${settings.state}`,
        outcome: 'blocked',
        at,
      },
      nextAction: {
        type: settings.state === 'paused' ? 'resume_monitor' : 'start_monitor',
        label: settings.state === 'paused' ? 'Resume Ralph monitor' : 'Start Ralph monitor',
        at,
      },
    };
  }

  const selected = prioritizeRalphWork(input.candidates, settings);
  if (!selected) {
    return {
      kind: 'no_action',
      reason: 'no_candidates',
      nextState: 'idle',
      selected: null,
      action: null,
      lastAction: {
        type: 'none',
        label: 'No eligible Ralph work found',
        outcome: 'idle',
        at,
      },
      nextAction: {
        type: 'poll',
        label: 'Continue watching for squad work',
        at,
      },
    };
  }

  const action: RalphMonitorActionSummary = {
    type: actionTypeForCandidate(selected.kind),
    label: labelForCandidate(selected),
    outcome: 'selected',
    targetId: targetIdForCandidate(selected),
    targetType: targetTypeForCandidate(selected),
    at,
  };

  return {
    kind: 'action',
    reason: selected.kind,
    nextState: 'active',
    selected,
    action,
    lastAction: action,
    nextAction: action,
  };
}

export function buildRalphMonitorAuditRecord(input: {
  projectId: string;
  settings: RalphMonitorSettings;
  decision: RalphMonitorDecision;
  candidates: RalphWorkCandidate[];
}): RalphMonitorAuditRecord {
  const { decision } = input;
  const selected = decision.selected;
  return {
    projectId: input.projectId,
    state: decision.nextState,
    decision: decision.kind,
    action: decision.action?.type ?? 'none',
    reason: decision.reason,
    selectedKind: selected?.kind ?? null,
    targetType: selected ? targetTypeForCandidate(selected) : null,
    targetId: selected ? targetIdForCandidate(selected) : null,
    payload: {
      settings: input.settings,
      decision,
      candidates: input.candidates.map((candidate) => ({
        id: candidate.id,
        kind: candidate.kind,
        issueId: candidate.issueId,
        runId: candidate.runId,
        agentName: candidate.agentName,
        prNumber: candidate.prNumber,
      })),
    },
  };
}

function candidateFromRow(kind: RalphWorkCandidateKind, projectId: string, row: CandidateRow): RalphWorkCandidate {
  const issueId = typeof row.issue_id === 'string' ? row.issue_id : undefined;
  const runId = typeof row.run_id === 'string' ? row.run_id : undefined;
  const fallbackId = typeof row.id === 'string' ? row.id : `${kind}:${runId ?? issueId ?? 'unknown'}`;
  const prNumber = typeof row.pr_number === 'number'
    ? row.pr_number
    : typeof row.pr_number === 'string'
      ? Number.parseInt(row.pr_number, 10)
      : undefined;

  return {
    id: `${kind}:${fallbackId}`,
    kind,
    projectId,
    title: typeof row.title === 'string' && row.title.trim() ? row.title : fallbackId,
    createdAt: iso(row.created_at),
    issueId,
    runId,
    agentId: typeof row.agent_id === 'string' ? row.agent_id : undefined,
    agentName: typeof row.agent_name === 'string' ? row.agent_name : undefined,
    prNumber: Number.isFinite(prNumber) ? prNumber : undefined,
    metadata: { source: 'db' },
  };
}

export async function collectRalphMonitorCandidates(
  projectId: string,
  settings: Pick<RalphMonitorSettings, 'autoMergeEnabled'>,
): Promise<RalphWorkCandidate[]> {
  const pool = getPool();
  const candidates: RalphWorkCandidate[] = [];

  const readyUnassigned = await pool.query<CandidateRow>(
    `
      SELECT i.id AS issue_id, i.id, i.title, i.created_at
      FROM issues i
      JOIN column_meta cm
        ON cm.project_id = i.project_id
       AND cm.column_id = i.status
       AND cm.semantic = 'ready'
      WHERE i.project_id = $1
        AND i.archived = 0
        AND i.assignee_id IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM issue_runs existing
          WHERE existing.issue_id = i.id
            AND existing.status IN ('pending', 'running')
        )
        AND (
          i.github_issue_number IS NULL
          OR EXISTS (
            SELECT 1
            FROM issue_labels il
            JOIN labels l ON l.id = il.label_id
            WHERE il.issue_id = i.id
              AND LOWER(l.name) IN ('squad', 'squad:triage', 'squad:untriaged')
          )
        )
      ORDER BY i.created_at ASC, i.id ASC
      LIMIT 10
    `,
    [projectId],
  );
  candidates.push(...readyUnassigned.rows.map((row) => candidateFromRow('ready_unassigned_card', projectId, row)));

  const assigned = await pool.query<CandidateRow>(
    `
      SELECT DISTINCT ON (i.id)
        i.id AS issue_id,
        i.id,
        i.title,
        i.created_at,
        a.id AS agent_id,
        a.name AS agent_name
      FROM issues i
      JOIN column_meta cm
        ON cm.project_id = i.project_id
       AND cm.column_id = i.status
       AND cm.semantic = 'ready'
      JOIN agents a
        ON a.project_id = i.project_id
       AND a.status = 'active'
      WHERE i.project_id = $1
        AND i.archived = 0
        AND (
          i.assignee_id = a.id
          OR EXISTS (
            SELECT 1
            FROM issue_labels il
            JOIN labels l ON l.id = il.label_id
            WHERE il.issue_id = i.id
              AND (
                LOWER(l.name) = 'squad:' || LOWER(a.name)
                OR LOWER(l.name) = 'squad:' || LOWER(a.name) || '/assigned'
              )
          )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM issue_runs existing
          WHERE existing.issue_id = i.id
            AND existing.status IN ('pending', 'running')
        )
      ORDER BY i.id, i.created_at ASC, a.name ASC
      LIMIT 10
    `,
    [projectId],
  );
  candidates.push(...assigned.rows.map((row) => candidateFromRow('member_assigned_pickup', projectId, row)));

  const ciFailures = await pool.query<CandidateRow>(
    `
      SELECT ir.id AS run_id, ir.id, ir.issue_id, i.title, ir.pr_number, ir.updated_at AS created_at
      FROM issue_runs ir
      JOIN issues i ON i.id = ir.issue_id
      WHERE i.project_id = $1
        AND i.archived = 0
        AND ir.pr_number IS NOT NULL
        AND ir.ci_state = 'failing'
        AND COALESCE(ir.pr_state, 'open') IN ('open', 'draft')
      ORDER BY ir.updated_at ASC, ir.id ASC
      LIMIT 10
    `,
    [projectId],
  );
  candidates.push(...ciFailures.rows.map((row) => candidateFromRow('ci_failure', projectId, row)));

  const reviewChanges = await pool.query<CandidateRow>(
    `
      SELECT DISTINCT ON (ir.id)
        ir.id AS run_id,
        ir.id,
        ir.issue_id,
        i.title,
        ir.pr_number,
        re.created_at
      FROM review_events re
      JOIN issue_runs ir ON ir.id = re.issue_run_id
      JOIN issues i ON i.id = ir.issue_id
      WHERE i.project_id = $1
        AND i.archived = 0
        AND LOWER(re.verb) IN ('request_changes', 'changes_requested')
      ORDER BY ir.id, re.created_at DESC
      LIMIT 10
    `,
    [projectId],
  );
  candidates.push(...reviewChanges.rows.map((row) => candidateFromRow('review_changes', projectId, row)));

  if (settings.autoMergeEnabled) {
    const autoMerge = await pool.query<CandidateRow>(
      `
        SELECT ir.id AS run_id, ir.id, ir.issue_id, i.title, ir.pr_number, ir.updated_at AS created_at
        FROM issue_runs ir
        JOIN issues i ON i.id = ir.issue_id
        WHERE i.project_id = $1
          AND i.archived = 0
          AND ir.pr_number IS NOT NULL
          AND COALESCE(ir.pr_state, 'open') = 'open'
          AND ir.ci_state = 'passing'
          AND EXISTS (
            SELECT 1
            FROM review_events re
            WHERE re.issue_run_id = ir.id
              AND LOWER(re.verb) = 'approve'
          )
          AND NOT EXISTS (
            SELECT 1
            FROM review_events re
            WHERE re.issue_run_id = ir.id
              AND LOWER(re.verb) IN ('request_changes', 'changes_requested')
          )
        ORDER BY ir.updated_at ASC, ir.id ASC
        LIMIT 10
      `,
      [projectId],
    );
    candidates.push(...autoMerge.rows.map((row) => candidateFromRow('auto_merge_pr', projectId, row)));
  }

  const drafts = await pool.query<CandidateRow>(
    `
      SELECT ir.id AS run_id, ir.id, ir.issue_id, i.title, ir.pr_number, ir.updated_at AS created_at
      FROM issue_runs ir
      JOIN issues i ON i.id = ir.issue_id
      WHERE i.project_id = $1
        AND i.archived = 0
        AND ir.pr_number IS NOT NULL
        AND ir.pr_state = 'draft'
      ORDER BY ir.updated_at ASC, ir.id ASC
      LIMIT 10
    `,
    [projectId],
  );
  candidates.push(...drafts.rows.map((row) => candidateFromRow('draft_attention', projectId, row)));

  return candidates;
}

async function loadProjectSettings(projectId: string): Promise<RalphMonitorSettings | null> {
  const db = getDb();
  const [row] = await db
    .select({
      id: schema.projects.id,
      ralphAutonomyEnabled: schema.projects.ralphAutonomyEnabled,
      ralphAutoMergeEnabled: schema.projects.ralphAutoMergeEnabled,
      ralphMonitorState: schema.projects.ralphMonitorState,
      ralphMonitorLastAction: schema.projects.ralphMonitorLastAction,
      ralphMonitorNextAction: schema.projects.ralphMonitorNextAction,
      ralphMonitorLastDecisionAt: schema.projects.ralphMonitorLastDecisionAt,
    })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .limit(1);

  return row ? normalizeRalphMonitorSettings(row) : null;
}

export async function getRalphMonitorStatus(projectId: string): Promise<RalphMonitorSettings | null> {
  return loadProjectSettings(projectId);
}

export async function updateRalphMonitorSettings(projectId: string, input: {
  enabled?: boolean;
  autoMergeEnabled?: boolean;
  state?: RalphMonitorState;
}): Promise<RalphMonitorSettings | null> {
  const current = await loadProjectSettings(projectId);
  if (!current) return null;

  let autonomyEnabled = input.enabled ?? current.autonomyEnabled;
  const autoMergeEnabled = input.autoMergeEnabled ?? current.autoMergeEnabled;
  let state = input.state ?? current.state;

  if (input.enabled === true && input.state === undefined && current.state === 'stopped') {
    state = 'active';
  }
  if (input.enabled === false) {
    autonomyEnabled = false;
    state = 'stopped';
  }
  if (!autonomyEnabled) state = 'stopped';

  const pool = getPool();
  await pool.query(
    `
      UPDATE projects
      SET ralph_autonomy_enabled = $2,
          ralph_auto_merge_enabled = $3,
          ralph_monitor_state = $4,
          updated_at = NOW()
      WHERE id = $1
    `,
    [projectId, autonomyEnabled, autoMergeEnabled, state],
  );

  return loadProjectSettings(projectId);
}

async function persistRalphMonitorDecision(audit: RalphMonitorAuditRecord): Promise<void> {
  const pool = getPool();
  await pool.query(
    `
      INSERT INTO ralph_monitor_events
        (project_id, state, decision, action, reason, selected_kind, target_type, target_id, payload, created_at)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, NOW())
    `,
    [
      audit.projectId,
      audit.state,
      audit.decision,
      audit.action,
      audit.reason,
      audit.selectedKind,
      audit.targetType,
      audit.targetId,
      JSON.stringify(audit.payload),
    ],
  );
}

async function dispatchAssignedIssue(candidate: RalphWorkCandidate): Promise<{ outcome: string; detail?: string; runId?: string }> {
  if (!candidate.issueId || !candidate.agentId) {
    return { outcome: 'skipped', detail: 'candidate is missing issueId or agentId' };
  }

  const db = getDb();
  const [existing] = await db
    .select({ id: schema.issueRuns.id })
    .from(schema.issueRuns)
    .where(and(
      eq(schema.issueRuns.issueId, candidate.issueId),
      inArray(schema.issueRuns.status, ['pending', 'running']),
    ))
    .limit(1);

  if (existing) {
    return { outcome: 'skipped', detail: 'issue already has an active run', runId: existing.id };
  }

  const [run] = await db
    .insert(schema.issueRuns)
    .values({
      issueId: candidate.issueId,
      agentId: candidate.agentId,
    })
    .returning();

  if (run) {
    eventBus.emitRunEvent('run.started', candidate.projectId, { run });
  }

  return { outcome: 'dispatched', runId: run?.id };
}

async function executeRalphMonitorAction(
  decision: RalphMonitorDecision,
): Promise<{ outcome: string; detail?: string; runId?: string } | null> {
  if (!decision.selected || !decision.action) return null;
  if (decision.selected.kind === 'member_assigned_pickup') {
    return dispatchAssignedIssue(decision.selected);
  }
  return {
    outcome: 'planned',
    detail: 'decision recorded for follow-up; no live GitHub side effect in this slice',
  };
}

function withActionResult(
  decision: RalphMonitorDecision,
  result: { outcome: string; detail?: string; runId?: string } | null,
): RalphMonitorDecision {
  if (!result || !decision.action) return decision;
  const lastAction = {
    ...decision.action,
    outcome: result.outcome,
    detail: result.detail,
    runId: result.runId,
  };
  return {
    ...decision,
    action: lastAction,
    lastAction,
    nextAction: lastAction,
  };
}

export async function runRalphMonitorSweep(projectId: string): Promise<RalphMonitorSweepResult | null> {
  const settings = await loadProjectSettings(projectId);
  if (!settings) return null;

  const candidates = settings.autonomyEnabled && ['active', 'idle'].includes(settings.state)
    ? await collectRalphMonitorCandidates(projectId, settings)
    : [];

  const initialDecision = decideRalphMonitor({ settings, candidates });
  const actionResult = initialDecision.kind === 'action'
    ? await executeRalphMonitorAction(initialDecision)
    : null;
  const decision = withActionResult(initialDecision, actionResult);
  const audit = buildRalphMonitorAuditRecord({ projectId, settings, decision, candidates });

  await persistRalphMonitorDecision(audit);
  const pool = getPool();
  await pool.query(
    `
      UPDATE projects
      SET ralph_monitor_state = $2,
          ralph_monitor_last_action = $3::jsonb,
          ralph_monitor_next_action = $4::jsonb,
          ralph_monitor_last_decision_at = NOW(),
          updated_at = NOW()
      WHERE id = $1
    `,
    [
      projectId,
      decision.nextState,
      JSON.stringify(decision.lastAction),
      decision.nextAction ? JSON.stringify(decision.nextAction) : null,
    ],
  );

  const status = await loadProjectSettings(projectId);
  return status ? { status, decision, candidates, audit } : null;
}

export const ralphMonitorSweep: Sweep = {
  id: 'ralph-monitor',
  label: 'Ralph monitor',
  description: 'Checks opted-in projects for the next Ready, assigned, CI, review, or PR follow-up action.',
  scope: 'project',
  intervalMs: 30_000,
  enabled: true,

  async run(): Promise<SweepResult> {
    const db = getDb();
    const rows = await db
      .select({ id: schema.projects.id })
      .from(schema.projects)
      .where(and(
        eq(schema.projects.ralphAutonomyEnabled, true),
        inArray(schema.projects.ralphMonitorState, ['active', 'idle']),
      ));

    let acted = 0;
    let errors = 0;
    for (const row of rows) {
      try {
        const result = await runRalphMonitorSweep(row.id);
        if (result?.decision.kind === 'action') acted += 1;
      } catch (err) {
        errors += 1;
        console.warn(`[ralph-monitor] sweep failed for project ${row.id}:`, err);
      }
    }

    return {
      acted,
      errors,
      details: `${rows.length} opted-in project(s) checked`,
      projectIds: rows.map((row) => row.id),
    };
  },
};
