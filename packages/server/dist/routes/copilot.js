/**
 * routes/copilot.ts — Wave 20 G4.1 + G4.3
 *
 * G4.1  POST /api/projects/:projectId/issues/:issueId/copilot/assign
 *         — Assign the issue to @copilot (dispatch workflow or assign GH issue).
 *
 * G4.3  GET    /api/projects/:projectId/copilot/rules        — list auto-assign rules
 *       POST   /api/projects/:projectId/copilot/rules        — create rule
 *       PATCH  /api/projects/:projectId/copilot/rules/:id    — update rule (toggle enabled)
 *       DELETE /api/projects/:projectId/copilot/rules/:id    — delete rule
 */
import { Router } from 'express';
import { eq, and } from 'drizzle-orm';
import { getDb, getPool, schema } from '../db/index.js';
import { eventBus } from '../realtime/event-bus.js';
import { assignToCopilot, GitOpsError } from '../services/github-git-ops.js';
// ─── Router ──────────────────────────────────────────────────────────────────
export const copilotRouter = Router({ mergeParams: true });
function handleError(res, err) {
    if (err instanceof GitOpsError) {
        res.status(err.httpStatus).json({ error: err.detail });
        return;
    }
    console.error('[copilot] error:', err);
    res.status(500).json({ error: 'Internal server error' });
}
// ─── G4.1 ────────────────────────────────────────────────────────────────────
/**
 * POST /api/projects/:projectId/issues/:issueId/copilot/assign
 *
 * Body (all optional):
 *   { ref?: string, inputs?: Record<string, string> }
 *
 * Behaviour:
 *   1. Resolves the project's github_owner, github_repo, copilot_workflow_file.
 *   2. Ensures a virtual @copilot agent row exists for this project.
 *   3. Dispatches (workflow or issue assign) via assignToCopilot().
 *   4. Inserts an issue_runs row with agent_kind='copilot' + external_ref.
 *   5. Emits `copilot.assigned` WS event.
 */
copilotRouter.post('/:projectId/issues/:issueId/copilot/assign', async (req, res) => {
    const { projectId, issueId } = req.params;
    const { ref = 'main', inputs } = req.body;
    try {
        const db = getDb();
        // Resolve project config.
        const [project] = await db
            .select({
            githubOwner: schema.projects.githubOwner,
            githubRepo: schema.projects.githubRepo,
            copilotWorkflowFile: schema.projects.copilotWorkflowFile,
        })
            .from(schema.projects)
            .where(eq(schema.projects.id, projectId))
            .limit(1);
        if (!project) {
            res.status(404).json({ error: 'Project not found' });
            return;
        }
        if (!project.githubOwner || !project.githubRepo) {
            res.status(422).json({
                error: 'GitHub owner/repo not configured on this project. Enable GitHub sync first.',
            });
            return;
        }
        // Ensure the issue belongs to this project.
        const [issue] = await db
            .select({ id: schema.issues.id, projectId: schema.issues.projectId })
            .from(schema.issues)
            .where(and(eq(schema.issues.id, issueId), eq(schema.issues.projectId, projectId)))
            .limit(1);
        if (!issue) {
            res.status(404).json({ error: 'Issue not found in this project' });
            return;
        }
        // Ensure a virtual @copilot agent row exists for this project (upsert).
        const copilotAgentRow = await ensureCopilotAgent(projectId);
        // Dispatch to GitHub.
        const dispatchResult = await assignToCopilot({
            issueId,
            owner: project.githubOwner,
            repo: project.githubRepo,
            workflowFile: project.copilotWorkflowFile ?? undefined,
            ref,
            inputs,
        });
        // Persist the issue_runs row.
        const externalRef = {
            owner: project.githubOwner,
            repo: project.githubRepo,
        };
        if (dispatchResult.workflowRunId)
            externalRef['workflowRunId'] = dispatchResult.workflowRunId;
        if (dispatchResult.runUrl)
            externalRef['runUrl'] = dispatchResult.runUrl;
        if (dispatchResult.issueNumber)
            externalRef['issueNumber'] = dispatchResult.issueNumber;
        const [run] = await db
            .insert(schema.issueRuns)
            .values({
            issueId,
            agentId: copilotAgentRow.id,
            status: 'pending',
            workspaceStrategy: 'scratch',
            externalRef,
        })
            .returning();
        // Emit WS event.
        eventBus.emitCopilotEvent('copilot.pr.detected', projectId, {
            run_id: run.id,
            mode: dispatchResult.mode,
            external_ref: externalRef,
        });
        eventBus.emitRunEvent('run.started', projectId, { run });
        res.status(201).json({ run, dispatch: dispatchResult });
    }
    catch (err) {
        handleError(res, err);
    }
});
// ─── G4.3 — Rules CRUD ───────────────────────────────────────────────────────
/**
 * GET /api/projects/:projectId/copilot/rules
 */
copilotRouter.get('/:projectId/copilot/rules', async (req, res) => {
    const { projectId } = req.params;
    try {
        const db = getDb();
        const rules = await db
            .select()
            .from(schema.copilotAutoAssignRules)
            .where(eq(schema.copilotAutoAssignRules.projectId, projectId));
        res.json(rules);
    }
    catch (err) {
        handleError(res, err);
    }
});
/**
 * POST /api/projects/:projectId/copilot/rules
 * Body: { label: string, enabled?: boolean }
 */
copilotRouter.post('/:projectId/copilot/rules', async (req, res) => {
    const { projectId } = req.params;
    const { label, enabled = true } = req.body;
    if (typeof label !== 'string' || !label.trim()) {
        res.status(400).json({ error: '`label` must be a non-empty string' });
        return;
    }
    try {
        const db = getDb();
        const [rule] = await db
            .insert(schema.copilotAutoAssignRules)
            .values({ projectId, label: label.trim(), enabled: Boolean(enabled) })
            .returning();
        res.status(201).json(rule);
    }
    catch (err) {
        handleError(res, err);
    }
});
/**
 * PATCH /api/projects/:projectId/copilot/rules/:id
 * Body: { enabled: boolean }
 */
copilotRouter.patch('/:projectId/copilot/rules/:id', async (req, res) => {
    const { projectId, id } = req.params;
    const { enabled } = req.body;
    if (typeof enabled !== 'boolean') {
        res.status(400).json({ error: '`enabled` must be a boolean' });
        return;
    }
    try {
        const db = getDb();
        const [updated] = await db
            .update(schema.copilotAutoAssignRules)
            .set({ enabled })
            .where(and(eq(schema.copilotAutoAssignRules.id, id), eq(schema.copilotAutoAssignRules.projectId, projectId)))
            .returning();
        if (!updated) {
            res.status(404).json({ error: 'Rule not found' });
            return;
        }
        res.json(updated);
    }
    catch (err) {
        handleError(res, err);
    }
});
/**
 * DELETE /api/projects/:projectId/copilot/rules/:id
 */
copilotRouter.delete('/:projectId/copilot/rules/:id', async (req, res) => {
    const { projectId, id } = req.params;
    try {
        const db = getDb();
        await db
            .delete(schema.copilotAutoAssignRules)
            .where(and(eq(schema.copilotAutoAssignRules.id, id), eq(schema.copilotAutoAssignRules.projectId, projectId)));
        res.status(204).end();
    }
    catch (err) {
        handleError(res, err);
    }
});
// ─── Helper: ensure @copilot virtual agent row ───────────────────────────────
/**
 * Finds or creates the virtual @copilot agent row for a given project.
 * The agent has agent_kind='copilot', status='active', charterPath='@copilot'.
 */
async function ensureCopilotAgent(projectId) {
    const db = getDb();
    const pool = getPool();
    // Upsert: insert if no copilot agent exists for this project, return existing otherwise.
    const result = await pool.query(`
    INSERT INTO agents (id, project_id, name, role, model, status, charter_path, agent_kind, created_at, updated_at)
    VALUES (gen_random_uuid(), $1, '@copilot', 'copilot-coding-agent', NULL, 'active', '@copilot', 'copilot', NOW(), NOW())
    ON CONFLICT DO NOTHING
    RETURNING id
    `, [projectId]);
    if (result.rows.length > 0)
        return result.rows[0];
    // Row already existed — fetch it.
    const [existing] = await db
        .select({ id: schema.agents.id })
        .from(schema.agents)
        .where(and(eq(schema.agents.projectId, projectId), eq(schema.agents.agentKind, 'copilot')))
        .limit(1);
    if (!existing) {
        throw new Error(`[copilot] Failed to find or create @copilot agent for project ${projectId}`);
    }
    return existing;
}
/**
 * G4.3 — Auto-dispatch triggered by a webhook issues.labeled event.
 *
 * Called from routes/github-sync.ts inside the issues.labeled branch.
 * Finds enabled rules matching the label, checks idempotency, dispatches.
 */
export async function handleLabeledAutoAssign(params) {
    const { projectId, label, issueId, githubIssueNumber } = params;
    if (!issueId)
        return; // can't dispatch without a local issue UUID
    const db = getDb();
    const pool = getPool();
    // Find enabled rules matching this label for this project.
    const rules = await db
        .select({ id: schema.copilotAutoAssignRules.id })
        .from(schema.copilotAutoAssignRules)
        .where(and(eq(schema.copilotAutoAssignRules.projectId, projectId), eq(schema.copilotAutoAssignRules.label, label), eq(schema.copilotAutoAssignRules.enabled, true)));
    if (rules.length === 0)
        return;
    // Resolve project config.
    const [project] = await db
        .select({
        githubOwner: schema.projects.githubOwner,
        githubRepo: schema.projects.githubRepo,
        copilotWorkflowFile: schema.projects.copilotWorkflowFile,
    })
        .from(schema.projects)
        .where(eq(schema.projects.id, projectId))
        .limit(1);
    if (!project?.githubOwner || !project?.githubRepo)
        return;
    for (const rule of rules) {
        // Idempotency: skip if (rule_id, issue_id) already dispatched.
        const guard = await pool.query(`SELECT id FROM copilot_auto_assign_dispatches WHERE rule_id = $1 AND issue_id = $2 LIMIT 1`, [rule.id, issueId]);
        if (guard.rows.length > 0)
            continue;
        try {
            const copilotAgent = await ensureCopilotAgent(projectId);
            const dispatchResult = await assignToCopilot({
                issueId,
                owner: project.githubOwner,
                repo: project.githubRepo,
                workflowFile: project.copilotWorkflowFile ?? undefined,
                ref: 'main',
            });
            const externalRef = {
                owner: project.githubOwner,
                repo: project.githubRepo,
                autoAssignRuleId: rule.id,
            };
            if (dispatchResult.workflowRunId)
                externalRef['workflowRunId'] = dispatchResult.workflowRunId;
            if (dispatchResult.runUrl)
                externalRef['runUrl'] = dispatchResult.runUrl;
            if (dispatchResult.issueNumber)
                externalRef['issueNumber'] = dispatchResult.issueNumber;
            const [run] = await db
                .insert(schema.issueRuns)
                .values({
                issueId,
                agentId: copilotAgent.id,
                status: 'pending',
                workspaceStrategy: 'scratch',
                externalRef,
            })
                .returning();
            // Record the dispatch for idempotency.
            await pool.query(`INSERT INTO copilot_auto_assign_dispatches (id, rule_id, issue_id, created_at)
         VALUES (gen_random_uuid(), $1, $2, NOW())
         ON CONFLICT DO NOTHING`, [rule.id, issueId]);
            eventBus.emitCopilotEvent('copilot.pr.detected', projectId, {
                run_id: run.id,
                mode: dispatchResult.mode,
                trigger: 'auto_assign_label',
                label,
                external_ref: externalRef,
            });
            eventBus.emitRunEvent('run.started', projectId, { run });
            console.log(`[copilot] auto-dispatched to @copilot for issue ${issueId} (label="${label}", rule=${rule.id})`);
        }
        catch (err) {
            console.error(`[copilot] auto-assign dispatch failed for rule ${rule.id}:`, err);
        }
    }
}
//# sourceMappingURL=copilot.js.map