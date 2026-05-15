/**
 * services/flow.ts — Phase 12 flow aggregator.
 *
 * Two surfaces:
 *   1. Per-task DAG  → getIssueFlow(projectId, issueId)
 *      Returns nodes (one per step_run, or one per issue_run if no
 *      workflow attached) + edges derived from the workflow definition's
 *      step ordering plus fan_out parent→children links.
 *
 *   2. Project flow board → getProjectFlow(projectId)
 *      Returns the kanban columns with their open issues, each issue
 *      enriched with the most recent active issue_run summary and the
 *      most recent deliverable. Used by the lane-board UI.
 *
 * Both functions are designed for batched SQL: at most a handful of
 * round-trips regardless of the issue count (target ≤200/project).
 */
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { parseWorkflowYaml } from './workflow-parser.js';
// ---------------------------------------------------------------------------
// Column catalog — mirrors columnStatusEnum in db/schema.ts
// ---------------------------------------------------------------------------
const COLUMN_CATALOG = [
    { slug: 'backlog', name: 'Backlog', color: '#7d8590' },
    { slug: 'todo', name: 'Todo', color: '#388bfd' },
    { slug: 'in_progress', name: 'In Progress', color: '#d29922' },
    { slug: 'in_review', name: 'In Review', color: '#a371f7' },
    { slug: 'done', name: 'Done', color: '#3fb950' },
];
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function summarise(text, max = 200) {
    if (!text)
        return null;
    const trimmed = text.trim();
    if (trimmed.length <= max)
        return trimmed;
    return trimmed.slice(0, max) + '…';
}
function toIso(value) {
    if (value == null)
        return null;
    if (value instanceof Date)
        return value.toISOString();
    if (typeof value === 'string') {
        // Postgres raw SQL may return e.g. "2026-05-14 20:25:07.740715-07" — coerce to Date.
        const d = new Date(value);
        if (!isNaN(d.getTime()))
            return d.toISOString();
        return value;
    }
    return null;
}
function deriveStepLabel(stepType, definitionStep) {
    const label = definitionStep?.label;
    if (label && typeof label === 'string')
        return label;
    switch (stepType) {
        case 'agent_run': return 'Agent run';
        case 'route': return 'Route';
        case 'approve': return 'Approve';
        case 'fan_out': return 'Fan out';
        case 'handoff': return 'Handoff';
        default: return stepType;
    }
}
function reviewStateFor(stepType, decision) {
    if (stepType !== 'approve')
        return null;
    if (decision === 'approve')
        return 'approved';
    if (decision === 'request_changes')
        return 'changes_requested';
    return 'pending';
}
// ---------------------------------------------------------------------------
// getIssueFlow — per-task DAG
// ---------------------------------------------------------------------------
export async function getIssueFlow(projectId, issueId) {
    const db = getDb();
    // 1. Issue + ownership check
    const [issue] = await db
        .select()
        .from(schema.issues)
        .where(and(eq(schema.issues.id, issueId), eq(schema.issues.projectId, projectId)))
        .limit(1);
    if (!issue) {
        const err = new Error('Issue not found in project');
        err.status = 404;
        throw err;
    }
    // 2. Active workflow version (if attached)
    const [iw] = await db
        .select({
        versionId: schema.issueWorkflows.workflowVersionId,
        yaml: schema.workflowVersions.yamlContent,
        workflowId: schema.workflowVersions.workflowId,
        workflowName: schema.workflows.name,
    })
        .from(schema.issueWorkflows)
        .innerJoin(schema.workflowVersions, eq(schema.issueWorkflows.workflowVersionId, schema.workflowVersions.id))
        .innerJoin(schema.workflows, eq(schema.workflowVersions.workflowId, schema.workflows.id))
        .where(eq(schema.issueWorkflows.issueId, issueId))
        .limit(1);
    let workflowVersion = null;
    let definitionSteps = [];
    if (iw) {
        workflowVersion = { id: iw.versionId, name: iw.workflowName };
        try {
            const def = await parseWorkflowYaml(iw.yaml);
            definitionSteps = def.steps;
        }
        catch {
            definitionSteps = [];
        }
    }
    // 3. Workflow runs for this issue (root + fan_out children)
    const wfRuns = await db
        .select()
        .from(schema.workflowRuns)
        .where(eq(schema.workflowRuns.issueId, issueId))
        .orderBy(schema.workflowRuns.createdAt);
    const wfRunIds = wfRuns.map((r) => r.id);
    // 4. Step runs across all workflow runs for this issue
    const stepRunRows = wfRunIds.length > 0
        ? await db
            .select()
            .from(schema.stepRuns)
            .where(inArray(schema.stepRuns.workflowRunId, wfRunIds))
            .orderBy(schema.stepRuns.workflowRunId, schema.stepRuns.stepIndex)
        : [];
    // 5. Issue runs (for agentName/role + bare runs when no workflow)
    const issueRunRows = await db
        .select()
        .from(schema.issueRuns)
        .where(eq(schema.issueRuns.issueId, issueId))
        .orderBy(schema.issueRuns.createdAt);
    // 6. Agents lookup (only those referenced)
    const agentIds = new Set();
    for (const r of issueRunRows)
        agentIds.add(r.agentId);
    const agentRows = agentIds.size > 0
        ? await db
            .select({ id: schema.agents.id, name: schema.agents.name, role: schema.agents.role })
            .from(schema.agents)
            .where(inArray(schema.agents.id, Array.from(agentIds)))
        : [];
    const agentById = new Map(agentRows.map((a) => [a.id, a]));
    // 7. Deliverables for this issue (group by stepRunId, fall back to runId)
    const deliverableRows = await db
        .select({
        id: schema.deliverables.id,
        title: schema.deliverables.title,
        status: schema.deliverables.status,
        kind: schema.deliverables.kind,
        stepRunId: schema.deliverables.stepRunId,
        runId: schema.deliverables.runId,
    })
        .from(schema.deliverables)
        .where(eq(schema.deliverables.issueId, issueId))
        .orderBy(desc(schema.deliverables.producedAt));
    const deliverablesByStep = new Map();
    const deliverablesByRun = new Map();
    for (const d of deliverableRows) {
        const fd = { id: d.id, title: d.title, status: d.status, kind: d.kind };
        if (d.stepRunId) {
            const arr = deliverablesByStep.get(d.stepRunId) ?? [];
            arr.push(fd);
            deliverablesByStep.set(d.stepRunId, arr);
        }
        else if (d.runId) {
            const arr = deliverablesByRun.get(d.runId) ?? [];
            arr.push(fd);
            deliverablesByRun.set(d.runId, arr);
        }
    }
    // 8. Review events: scoped to this issue's step_runs OR workflow_runs
    const stepRunIds = stepRunRows.map((s) => s.id);
    const reviewRows = (stepRunIds.length > 0 || wfRunIds.length > 0)
        ? await db
            .select({
            id: schema.reviewEvents.id,
            stepRunId: schema.reviewEvents.stepRunId,
            workflowRunId: schema.reviewEvents.workflowRunId,
            verb: schema.reviewEvents.verb,
            reviewerName: schema.reviewEvents.reviewerName,
            createdAt: schema.reviewEvents.createdAt,
        })
            .from(schema.reviewEvents)
            .where(stepRunIds.length > 0 && wfRunIds.length > 0
            ? sql `${schema.reviewEvents.stepRunId} IN (${sql.join(stepRunIds.map((id) => sql `${id}`), sql `, `)})
                  OR ${schema.reviewEvents.workflowRunId} IN (${sql.join(wfRunIds.map((id) => sql `${id}`), sql `, `)})`
            : stepRunIds.length > 0
                ? inArray(schema.reviewEvents.stepRunId, stepRunIds)
                : inArray(schema.reviewEvents.workflowRunId, wfRunIds))
            .orderBy(schema.reviewEvents.createdAt)
        : [];
    // ── Build edges ──────────────────────────────────────────────────────
    const edges = [];
    const childIdsByParent = new Map();
    // Group step runs by workflow run for sequencing
    const stepsByWfRun = new Map();
    for (const sr of stepRunRows) {
        const arr = stepsByWfRun.get(sr.workflowRunId) ?? [];
        arr.push(sr);
        stepsByWfRun.set(sr.workflowRunId, arr);
    }
    // Sequential edges within each workflow run (already sorted by stepIndex)
    for (const arr of stepsByWfRun.values()) {
        for (let i = 1; i < arr.length; i++) {
            edges.push({ from: arr[i - 1].id, to: arr[i].id, kind: 'sequence' });
        }
    }
    // fan_out: parent's fan_out step → first step of each child workflow_run
    // Find children via workflow_runs.parent_workflow_run_id
    const childWfRunsByParent = new Map();
    for (const wr of wfRuns) {
        if (wr.parentWorkflowRunId) {
            const arr = childWfRunsByParent.get(wr.parentWorkflowRunId) ?? [];
            arr.push(wr);
            childWfRunsByParent.set(wr.parentWorkflowRunId, arr);
        }
    }
    for (const parentWf of wfRuns) {
        const children = childWfRunsByParent.get(parentWf.id) ?? [];
        if (children.length === 0)
            continue;
        // Find this workflow_run's fan_out step (the parent step that spawned)
        const parentSteps = stepsByWfRun.get(parentWf.id) ?? [];
        const fanOutStep = parentSteps.find((s) => s.stepType === 'fan_out');
        if (!fanOutStep)
            continue;
        for (const childWf of children) {
            const childSteps = stepsByWfRun.get(childWf.id) ?? [];
            if (childSteps.length === 0)
                continue;
            const firstChild = childSteps[0];
            edges.push({ from: fanOutStep.id, to: firstChild.id, kind: 'fan_out' });
            const arr = childIdsByParent.get(fanOutStep.id) ?? [];
            arr.push(firstChild.id);
            childIdsByParent.set(fanOutStep.id, arr);
        }
    }
    // review edges: approve step → its peer_review issue_runs (if any)
    const peerReviewByStepRunId = new Map();
    for (const ir of issueRunRows) {
        if (ir.stepRunId) {
            const arr = peerReviewByStepRunId.get(ir.stepRunId) ?? [];
            arr.push(ir);
            peerReviewByStepRunId.set(ir.stepRunId, arr);
        }
    }
    // (Edges not added for issue_runs because step nodes track them inline as
    // reviewEvents; the dotted "review" edge in the spec is reserved for cases
    // where a peer_review step_run exists. We expose them in childIds so the
    // UI can choose to render them.)
    // ── Build node list (FlowStepRun[]) ─────────────────────────────────
    const stepRuns = [];
    if (stepRunRows.length === 0) {
        // No workflow attached → derive nodes from issue_runs themselves.
        for (let i = 0; i < issueRunRows.length; i++) {
            const ir = issueRunRows[i];
            const agent = agentById.get(ir.agentId);
            stepRuns.push({
                id: ir.id,
                stepIndex: i,
                kind: ir.kind ?? 'agent_run',
                label: deriveStepLabel(ir.kind ?? 'agent_run'),
                status: ir.status,
                startedAt: toIso(ir.startedAt),
                completedAt: toIso(ir.completedAt),
                agentName: agent?.name ?? null,
                agentRole: agent?.role ?? null,
                parentStepRunId: null,
                childIds: [],
                outputSummary: summarise(ir.output),
                reviewState: null,
                deliverables: deliverablesByRun.get(ir.id) ?? [],
            });
            // Sequential edges between bare issue_runs
            if (i > 0) {
                edges.push({ from: issueRunRows[i - 1].id, to: ir.id, kind: 'sequence' });
            }
        }
    }
    else {
        // Workflow case → step_run is the canonical node.
        // Map workflow_run → optional parent step_run id (the fan_out step that
        // spawned this child workflow). Used to populate parentStepRunId.
        const parentStepIdByChildWfRun = new Map();
        for (const parentWf of wfRuns) {
            const children = childWfRunsByParent.get(parentWf.id) ?? [];
            if (children.length === 0)
                continue;
            const fanOutStep = (stepsByWfRun.get(parentWf.id) ?? []).find((s) => s.stepType === 'fan_out');
            if (!fanOutStep)
                continue;
            for (const c of children)
                parentStepIdByChildWfRun.set(c.id, fanOutStep.id);
        }
        // Lookup issue_run → its agent for each step (via stepRuns.issueRunId)
        const issueRunById = new Map(issueRunRows.map((r) => [r.id, r]));
        for (const sr of stepRunRows) {
            // Find a related issue_run for agent attribution
            let agentName = null;
            let agentRole = null;
            if (sr.issueRunId) {
                const ir = issueRunById.get(sr.issueRunId);
                if (ir) {
                    const agent = agentById.get(ir.agentId);
                    agentName = agent?.name ?? null;
                    agentRole = agent?.role ?? null;
                }
            }
            // Find the matching definition step (only for the root workflow run)
            const isRootWfRun = wfRuns.find((w) => w.id === sr.workflowRunId)?.parentWorkflowRunId == null;
            const defStep = isRootWfRun ? definitionSteps[sr.stepIndex] : undefined;
            const parentStepRunId = parentStepIdByChildWfRun.get(sr.workflowRunId) ?? null;
            const node = {
                id: sr.id,
                stepIndex: sr.stepIndex,
                kind: sr.stepType,
                label: deriveStepLabel(sr.stepType, defStep),
                status: sr.status,
                startedAt: null, // step_runs lacks dedicated startedAt; fall back to created/updated
                completedAt: null,
                agentName,
                agentRole,
                parentStepRunId,
                childIds: childIdsByParent.get(sr.id) ?? [],
                outputSummary: summarise(sr.output),
                reviewState: reviewStateFor(sr.stepType, sr.reviewDecision),
                deliverables: deliverablesByStep.get(sr.id) ?? [],
            };
            // Best-effort timestamps from createdAt/updatedAt
            if (sr.createdAt)
                node.startedAt = toIso(sr.createdAt);
            if (sr.updatedAt && (sr.status === 'completed' || sr.status === 'failed' || sr.status === 'cancelled')) {
                node.completedAt = toIso(sr.updatedAt);
            }
            stepRuns.push(node);
        }
    }
    // ── Review events (flat list) ───────────────────────────────────────
    const reviewEvents = reviewRows.map((r) => ({
        stepRunId: r.stepRunId ?? null,
        kind: r.verb,
        actorName: r.reviewerName ?? null,
        ts: toIso(r.createdAt) ?? '',
    }));
    return {
        issue: {
            id: issue.id,
            title: issue.title,
            columnSlug: issue.status,
            status: issue.status,
        },
        workflowVersion,
        stepRuns,
        edges,
        reviewEvents,
    };
}
// ---------------------------------------------------------------------------
// getProjectFlow — kanban + active-run summary
// ---------------------------------------------------------------------------
export async function getProjectFlow(projectId) {
    const db = getDb();
    // 1. Open issues (not archived)
    const issueRows = await db
        .select()
        .from(schema.issues)
        .where(and(eq(schema.issues.projectId, projectId), eq(schema.issues.archived, 0)))
        .orderBy(schema.issues.status, schema.issues.position, schema.issues.createdAt);
    if (issueRows.length === 0) {
        return {
            columns: COLUMN_CATALOG.map((c) => ({ ...c, issues: [] })),
            activeRunsCount: 0,
            pendingReviewsCount: 0,
        };
    }
    const issueIds = issueRows.map((i) => i.id);
    // 2. Most recent issue_run per issue (active run preferred). Single SQL with
    //    a window function to keep it O(1) round-trips.
    const runRowsResult = await db.execute(sql `
    SELECT id, issue_id, kind, status, agent_id, started_at, created_at
    FROM (
      SELECT
        ir.id, ir.issue_id, ir.kind, ir.status, ir.agent_id,
        ir.started_at, ir.created_at,
        ROW_NUMBER() OVER (
          PARTITION BY ir.issue_id
          ORDER BY
            CASE WHEN ir.status IN ('running','pending','splitting','waiting_children') THEN 0 ELSE 1 END,
            ir.created_at DESC
        ) AS rn
      FROM issue_runs ir
      WHERE ir.issue_id IN (${sql.join(issueIds.map((id) => sql `${id}`), sql `, `)})
    ) ranked
    WHERE rn = 1
  `);
    const runRows = runRowsResult.rows;
    const runByIssue = new Map(runRows.map((r) => [r.issue_id, r]));
    // 3. Lookup agent names referenced by those runs
    const agentIds = Array.from(new Set(runRows.map((r) => r.agent_id))).filter(Boolean);
    const agentRows = agentIds.length > 0
        ? await db
            .select({ id: schema.agents.id, name: schema.agents.name })
            .from(schema.agents)
            .where(inArray(schema.agents.id, agentIds))
        : [];
    const agentById = new Map(agentRows.map((a) => [a.id, a.name]));
    // 4. Most recent deliverable per issue — same window pattern.
    const delvRowsResult = await db.execute(sql `
    SELECT id, issue_id, title, kind, status, created_at
    FROM (
      SELECT
        d.id, d.issue_id, d.title, d.kind, d.status, d.created_at,
        ROW_NUMBER() OVER (PARTITION BY d.issue_id ORDER BY d.produced_at DESC, d.created_at DESC) AS rn
      FROM deliverables d
      WHERE d.issue_id IN (${sql.join(issueIds.map((id) => sql `${id}`), sql `, `)})
    ) ranked
    WHERE rn = 1
  `);
    const delvRows = delvRowsResult.rows;
    const delvByIssue = new Map(delvRows.map((d) => [d.issue_id, d]));
    // 5. Aggregate counters (one query each, scoped to this project's issues)
    const activeRunsResult = await db.execute(sql `
    SELECT COUNT(*)::int AS n
    FROM issue_runs ir
    WHERE ir.issue_id IN (${sql.join(issueIds.map((id) => sql `${id}`), sql `, `)})
      AND ir.status IN ('running','pending','splitting','waiting_children')
  `);
    const activeRunsCount = (activeRunsResult.rows[0]?.n ?? 0);
    // Pending reviews = approve step_runs in 'pending'/'running' status whose
    // workflow_run is on an issue in this project.
    const pendingReviewsResult = await db.execute(sql `
    SELECT COUNT(*)::int AS n
    FROM step_runs sr
    JOIN workflow_runs wr ON wr.id = sr.workflow_run_id
    WHERE wr.issue_id IN (${sql.join(issueIds.map((id) => sql `${id}`), sql `, `)})
      AND sr.step_type = 'approve'
      AND sr.status IN ('pending','running')
  `);
    const pendingReviewsCount = (pendingReviewsResult.rows[0]?.n ?? 0);
    // 6. Build columns
    const columns = COLUMN_CATALOG.map((c) => ({ ...c, issues: [] }));
    const colBySlug = new Map(columns.map((c) => [c.slug, c]));
    for (const issue of issueRows) {
        const col = colBySlug.get(issue.status);
        if (!col)
            continue;
        const run = runByIssue.get(issue.id);
        const delv = delvByIssue.get(issue.id);
        col.issues.push({
            id: issue.id,
            title: issue.title,
            status: issue.status,
            activeRunSummary: run
                ? {
                    runId: run.id,
                    kind: run.kind,
                    status: run.status,
                    agentName: agentById.get(run.agent_id) ?? null,
                    startedAt: toIso(run.started_at) ?? toIso(run.created_at),
                }
                : null,
            lastDeliverable: delv
                ? {
                    id: delv.id,
                    title: delv.title,
                    kind: delv.kind,
                    status: delv.status,
                    createdAt: toIso(delv.created_at) ?? '',
                }
                : null,
        });
    }
    return {
        columns,
        activeRunsCount,
        pendingReviewsCount,
    };
}
// Suppress "unused" lint for the helper kept for future expansion.
void isNull;
//# sourceMappingURL=flow.js.map