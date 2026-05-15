/**
 * workflow-runner.ts — YAML workflow execution engine (Demo 6 / Demo 10)
 *
 * Advances workflow_runs step by step. Steps desugar to issue_runs (Invariant 1).
 * The stepper still picks up resulting issue_runs via FOR UPDATE SKIP LOCKED (Invariant 2).
 *
 * Step types:
 *   route      → resolveRoute() → create issue_run kind='agent_run'
 *   agent_run  → issue_run already exists; poll for completion
 *   approve    → peer review gate (Demo 9)
 *   fan_out    → materializeFanOut() → waiting_children → checkFanOutCompletion()
 *   handoff    → create agent_run issueRun for target agent; complete immediately
 *
 * pinnedAgentRevisions: snapshotted per step at step start (open question #1 resolution).
 */
import { eq, and, sql } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { resolveRoute } from './router.js';
import { parseWorkflowYaml } from '../services/workflow-parser.js';
import { createPeerReviewRuns, collectReviewDecisions, shouldBlock, isQuorumMet, injectReviewerFeedback, recordApproval, } from './peer-reviewer.js';
import { materializeAndSpawnFanOut, checkFanOutCompletion } from './fan-out.js';
import { appendSystemComment } from '../services/issues.js';
import { eventBus } from '../realtime/event-bus.js';
// ---------------------------------------------------------------------------
// Internal helper — look up projectId for a workflow_run (for flow events)
// ---------------------------------------------------------------------------
async function getProjectIdForWorkflowRun(workflowRunId) {
    const db = getDb();
    const rows = await db.execute(sql `
    SELECT i.project_id
    FROM   workflow_runs wr
    JOIN   issues i ON wr.issue_id = i.id
    WHERE  wr.id = ${workflowRunId}::uuid
    LIMIT  1
  `);
    return rows.rows[0]?.project_id ?? null;
}
export async function createWorkflowRun(issueId, workflowVersionId, trigger) {
    const db = getDb();
    const { workflowRuns, stepRuns, workflowVersions } = schema;
    // Load YAML content for the version
    const [wv] = await db
        .select({ yamlContent: workflowVersions.yamlContent })
        .from(workflowVersions)
        .where(eq(workflowVersions.id, workflowVersionId))
        .limit(1);
    if (!wv) {
        throw new Error(`workflow_version ${workflowVersionId} not found`);
    }
    const definition = await parseWorkflowYaml(wv.yamlContent);
    // Derive requestChangesPolicy from the first approve step (or default 'first')
    const approveStep = definition.steps.find((s) => s.type === 'approve');
    const requestChangesPolicy = approveStep?.type === 'approve'
        ? (approveStep.request_changes_policy ?? 'first')
        : 'first';
    // INSERT workflow_run
    const [wfRun] = await db
        .insert(workflowRuns)
        .values({
        issueId,
        workflowVersionId,
        status: 'pending',
        currentStepIndex: 0,
        requestChangesPolicy,
        triggerSource: trigger ?? null,
    })
        .returning({ id: workflowRuns.id });
    // INSERT step_runs (one per step)
    if (definition.steps.length > 0) {
        await db.insert(stepRuns).values(definition.steps.map((step, index) => ({
            workflowRunId: wfRun.id,
            stepIndex: index,
            stepType: step.type,
            status: 'pending',
        })));
    }
    console.log(`[workflow-runner] created workflow_run ${wfRun.id} for issue ${issueId} ` +
        `(version ${workflowVersionId}, ${definition.steps.length} steps, policy=${requestChangesPolicy})`);
    // ── Flow event: instance started ──────────────────────────────────────────
    const projectId = await getProjectIdForWorkflowRun(wfRun.id);
    if (projectId) {
        eventBus.emitFlowEvent('flow.instance.started', projectId, {
            instanceId: wfRun.id,
            agentId: null,
            kind: 'workflow_run',
        });
    }
    return wfRun.id;
}
// ---------------------------------------------------------------------------
// advanceWorkflowRun
// ---------------------------------------------------------------------------
/**
 * Advance a workflow_run by one step.
 *
 * Called by the dispatcher on each tick for running workflow_runs.
 * Idempotent — safe to call repeatedly until the workflow completes.
 *
 * Step dispatch:
 *   route      → resolveRoute() + createRoutedStepRun()
 *   agent_run  → check linked issue_run completion
 *   approve    → stub (Demo 9 fills in quorum logic)
 */
export async function advanceWorkflowRun(workflowRunId) {
    const db = getDb();
    const { workflowRuns, stepRuns, issueRuns, workflowVersions, issues, agents } = schema;
    // Load workflow_run
    const [wfRun] = await db
        .select()
        .from(workflowRuns)
        .where(eq(workflowRuns.id, workflowRunId))
        .limit(1);
    if (!wfRun || wfRun.status === 'completed' || wfRun.status === 'failed' || wfRun.status === 'cancelled')
        return;
    const currentIndex = wfRun.currentStepIndex ?? 0;
    // Load current step_run
    const [currentStep] = await db
        .select()
        .from(stepRuns)
        .where(and(eq(stepRuns.workflowRunId, workflowRunId), eq(stepRuns.stepIndex, currentIndex)))
        .limit(1);
    if (!currentStep) {
        console.error(`[workflow-runner] no step_run at index ${currentIndex} for workflow_run ${workflowRunId}`);
        return;
    }
    // Load step definition from either the workflow version YAML or inline steps JSON
    // (inline steps are set on fan_out child workflow_runs that have no workflowVersionId)
    let definition;
    if (wfRun.workflowVersionId) {
        const [wv] = await db
            .select({ yamlContent: workflowVersions.yamlContent })
            .from(workflowVersions)
            .where(eq(workflowVersions.id, wfRun.workflowVersionId))
            .limit(1);
        if (wv) {
            definition = await parseWorkflowYaml(wv.yamlContent);
        }
    }
    else if (wfRun.inlineStepsJson) {
        try {
            const inlineSteps = JSON.parse(wfRun.inlineStepsJson);
            definition = { name: 'inline', steps: inlineSteps };
        }
        catch {
            console.error(`[workflow-runner] failed to parse inlineStepsJson for workflow_run ${workflowRunId}`);
        }
    }
    // For inline child steps, also check the step_run's stepConfig as fallback
    let stepDef = definition?.steps[currentIndex];
    if (!stepDef && currentStep.stepConfig) {
        try {
            stepDef = JSON.parse(currentStep.stepConfig);
        }
        catch {
            // ignore parse errors
        }
    }
    // --- Dispatch based on step type ---
    switch (currentStep.stepType) {
        case 'route':
            await handleRouteStep(wfRun, currentStep, stepDef);
            break;
        case 'agent_run':
            await handleAgentRunStep(wfRun, currentStep);
            break;
        case 'approve':
            await handleApproveStep(wfRun, currentStep, stepDef);
            break;
        case 'fan_out':
            await handleFanOutStep(wfRun, currentStep, stepDef);
            break;
        case 'handoff':
            await handleHandoffStep(wfRun, currentStep, stepDef);
            break;
        default:
            console.warn(`[workflow-runner] unknown step type '${currentStep.stepType}' — skipping`);
            await advanceToNextStep(workflowRunId, currentIndex);
            break;
    }
}
// ---------------------------------------------------------------------------
// Step handlers
// ---------------------------------------------------------------------------
async function handleRouteStep(wfRun, stepRun, _stepDef) {
    const db = getDb();
    const { stepRuns, issueRuns, agents, issues, projects } = schema;
    if (stepRun.status === 'completed') {
        await advanceToNextStep(wfRun.id, wfRun.currentStepIndex ?? 0);
        return;
    }
    // Snapshot pinnedAgentRevisions at step start (Invariant: per step at step start)
    const allAgents = await db
        .select({ name: agents.name, charterHash: agents.charterHash })
        .from(agents)
        .where(eq(agents.projectId, (await db.select({ projectId: issues.projectId }).from(issues).where(eq(issues.id, wfRun.issueId)).limit(1))[0].projectId));
    const pinnedRevisions = {};
    for (const a of allAgents) {
        if (a.charterHash)
            pinnedRevisions[a.name] = a.charterHash;
    }
    // Resolve route
    const [issue] = await db.select().from(issues).where(eq(issues.id, wfRun.issueId)).limit(1);
    if (!issue) {
        console.error(`[workflow-runner] issue ${wfRun.issueId} not found`);
        return;
    }
    const [project] = await db
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.id, issue.projectId))
        .limit(1);
    if (!project)
        return;
    const routeResult = await resolveRoute(issue.projectId, {
        title: issue.title,
        body: issue.body ?? '',
        labels: [],
    });
    if (!routeResult) {
        console.warn(`[workflow-runner] route step: no matching rule for issue ${wfRun.issueId} — staying pending`);
        return;
    }
    // Find the agent record
    const [agent] = await db
        .select()
        .from(agents)
        .where(and(eq(agents.projectId, issue.projectId), eq(agents.name, routeResult.agentName)))
        .limit(1);
    if (!agent) {
        console.warn(`[workflow-runner] route step: agent '${routeResult.agentName}' not found`);
        return;
    }
    // Create issue_run (Invariant 1: routing desugars to agent_run)
    const [newRun] = await db
        .insert(issueRuns)
        .values({
        issueId: wfRun.issueId,
        agentId: agent.id,
        kind: 'agent_run',
        status: 'pending',
    })
        .returning({ id: issueRuns.id });
    // Link step_run to issue_run; snapshot pinnedAgentRevisions
    await db
        .update(stepRuns)
        .set({
        issueRunId: newRun.id,
        status: 'running',
        pinnedAgentRevisions: JSON.stringify(pinnedRevisions),
        updatedAt: new Date(),
    })
        .where(eq(stepRuns.id, stepRun.id));
    await db
        .update(schema.workflowRuns)
        .set({ status: 'running', updatedAt: new Date() })
        .where(eq(schema.workflowRuns.id, wfRun.id));
    console.log(`[workflow-runner] route step created issue_run ${newRun.id} → agent ${agent.name}`);
}
async function handleAgentRunStep(wfRun, stepRun) {
    const db = getDb();
    const { stepRuns, issueRuns } = schema;
    if (stepRun.status === 'completed') {
        await advanceToNextStep(wfRun.id, wfRun.currentStepIndex ?? 0);
        return;
    }
    // If no issueRunId yet, check if we have a resolvedAgentId (fan_out child path)
    if (!stepRun.issueRunId) {
        if (stepRun.resolvedAgentId) {
            // Fan-out child: create issueRun directly from the pre-resolved agent
            const [newRun] = await db
                .insert(issueRuns)
                .values({
                issueId: wfRun.issueId,
                agentId: stepRun.resolvedAgentId,
                kind: 'agent_run',
                status: 'pending',
            })
                .returning({ id: issueRuns.id });
            await db
                .update(stepRuns)
                .set({ issueRunId: newRun.id, status: 'running', updatedAt: new Date() })
                .where(eq(stepRuns.id, stepRun.id));
            await db
                .update(schema.workflowRuns)
                .set({ status: 'running', updatedAt: new Date() })
                .where(eq(schema.workflowRuns.id, wfRun.id));
            console.log(`[workflow-runner] fan-out child agent_run: created issue_run ${newRun.id} ` +
                `for workflow_run ${wfRun.id}`);
        }
        // No issueRunId and no resolvedAgentId — wait for route step to create one
        return;
    }
    // Check linked issue_run
    const [run] = await db
        .select({ status: issueRuns.status })
        .from(issueRuns)
        .where(eq(issueRuns.id, stepRun.issueRunId))
        .limit(1);
    if (!run)
        return;
    if (run.status === 'completed') {
        await db
            .update(stepRuns)
            .set({ status: 'completed', updatedAt: new Date() })
            .where(eq(stepRuns.id, stepRun.id));
        await advanceToNextStep(wfRun.id, wfRun.currentStepIndex ?? 0);
    }
    else if (run.status === 'failed' || run.status === 'cancelled') {
        await db
            .update(stepRuns)
            .set({ status: run.status, updatedAt: new Date() })
            .where(eq(stepRuns.id, stepRun.id));
        await db
            .update(schema.workflowRuns)
            .set({ status: 'failed', updatedAt: new Date() })
            .where(eq(schema.workflowRuns.id, wfRun.id));
        console.warn(`[workflow-runner] workflow_run ${wfRun.id} failed at agent_run step ${stepRun.stepIndex}`);
        // ── Flow event: workflow_run ended (failed) ──────────────────────────────
        const pid = await getProjectIdForWorkflowRun(wfRun.id);
        if (pid) {
            eventBus.emitFlowEvent('flow.instance.ended', pid, { instanceId: wfRun.id, status: 'failed' });
        }
    }
    // else: still running/pending — wait for next tick
}
async function handleApproveStep(wfRun, stepRun, stepDef) {
    const db = getDb();
    const { stepRuns, issueRuns, agents, issues, workflowRuns } = schema;
    // Already approved — advance.
    if (stepRun.status === 'completed') {
        await advanceToNextStep(wfRun.id, wfRun.currentStepIndex ?? 0);
        return;
    }
    const policy = wfRun.requestChangesPolicy ?? 'first';
    // Narrow to ApproveStep fields (approvers/quorum/exclude_author only exist on approve steps)
    const approveStepDef = stepDef?.type === 'approve' ? stepDef : undefined;
    const approverNames = approveStepDef?.approvers ?? [];
    const quorum = approveStepDef?.quorum;
    const excludeAuthor = approveStepDef?.exclude_author ?? false;
    // -----------------------------------------------------------------------
    // Phase A: First tick — spin up peer_review issueRuns for each reviewer.
    // -----------------------------------------------------------------------
    if (stepRun.status === 'pending') {
        // Resolve reviewer agents by name within this project.
        const [issue] = await db
            .select({ projectId: issues.projectId })
            .from(issues)
            .where(eq(issues.id, wfRun.issueId))
            .limit(1);
        if (!issue) {
            console.error(`[workflow-runner] issue ${wfRun.issueId} not found for approve step`);
            return;
        }
        // Determine which agent ran the prior step (for reviewer lockout).
        const priorStepIndex = (wfRun.currentStepIndex ?? 0) - 1;
        let priorAgentId = null;
        let priorOutput = '';
        if (priorStepIndex >= 0) {
            const [priorStep] = await db
                .select()
                .from(stepRuns)
                .where(and(eq(stepRuns.workflowRunId, wfRun.id), eq(stepRuns.stepIndex, priorStepIndex)))
                .limit(1);
            if (priorStep?.issueRunId) {
                const [priorRun] = await db
                    .select({ agentId: issueRuns.agentId, output: issueRuns.output })
                    .from(issueRuns)
                    .where(eq(issueRuns.id, priorStep.issueRunId))
                    .limit(1);
                priorAgentId = priorRun?.agentId ?? null;
                priorOutput = priorRun?.output ?? '';
            }
        }
        // Resolve approver agent IDs; apply exclude_author lockout.
        const reviewerAgentIds = [];
        for (const name of approverNames) {
            const [ag] = await db
                .select({ id: agents.id, name: agents.name })
                .from(agents)
                .where(and(eq(agents.projectId, issue.projectId), eq(agents.name, name)))
                .limit(1);
            if (!ag) {
                console.warn(`[workflow-runner] approve step: reviewer agent '${name}' not found — skipping`);
                continue;
            }
            if (excludeAuthor && ag.id === priorAgentId) {
                console.log(`[workflow-runner] reviewer lockout: '${name}' is the author — excluded`);
                continue;
            }
            reviewerAgentIds.push(ag.id);
        }
        if (reviewerAgentIds.length === 0) {
            // No reviewers available — auto-approve and advance.
            console.warn(`[workflow-runner] approve step has no eligible reviewers — auto-approving`);
            await db
                .update(stepRuns)
                .set({ status: 'completed', reviewDecision: 'approve', updatedAt: new Date() })
                .where(eq(stepRuns.id, stepRun.id));
            await advanceToNextStep(wfRun.id, wfRun.currentStepIndex ?? 0);
            return;
        }
        // Create peer_review issueRuns (Invariant 1).
        await createPeerReviewRuns(wfRun.id, stepRun.id, wfRun.issueId, reviewerAgentIds, priorOutput);
        // Mark approve step_run as running (stepper will tick it).
        await db
            .update(stepRuns)
            .set({ status: 'running', updatedAt: new Date() })
            .where(eq(stepRuns.id, stepRun.id));
        await db
            .update(workflowRuns)
            .set({ status: 'running', updatedAt: new Date() })
            .where(eq(workflowRuns.id, wfRun.id));
        console.log(`[workflow-runner] approve step ${stepRun.stepIndex} for workflow_run ${wfRun.id} ` +
            `initiated with ${reviewerAgentIds.length} reviewer(s), policy=${policy}`);
        await appendSystemComment({
            issueId: wfRun.issueId,
            eventKind: 'review.opened',
            summary: `Review step ${stepRun.stepIndex + 1} opened with ${reviewerAgentIds.length} reviewer(s) (policy: ${policy}${quorum ? `, quorum ${quorum.n}-of-${quorum.of}` : ''}${excludeAuthor ? ', author excluded' : ''}).`,
            eventPayload: {
                workflowRunId: wfRun.id,
                stepRunId: stepRun.id,
                stepIndex: stepRun.stepIndex,
                reviewerCount: reviewerAgentIds.length,
                policy,
                quorum,
                excludeAuthor,
            },
        }).catch((e) => console.warn(`[workflow-runner] system-comment review.opened failed:`, e));
        return;
    }
    // -----------------------------------------------------------------------
    // Phase B: Subsequent ticks — poll for all peer_review issueRuns complete.
    // -----------------------------------------------------------------------
    if (stepRun.status === 'running') {
        const { allComplete, decisions } = await collectReviewDecisions(stepRun.id);
        if (!allComplete) {
            // Reviewers still running — wait.
            return;
        }
        // Check quorum (N-of-M) before evaluating policy.
        const quorumMet = isQuorumMet(decisions, quorum);
        if (!quorumMet) {
            // Quorum not reached yet — but all runs completed (some may have failed/been skipped).
            // If every run is done and quorum still not met, we must re-queue.
            console.log(`[workflow-runner] approve step ${stepRun.stepIndex}: quorum not met ` +
                `(${decisions.filter((d) => d.decision === 'approve').length} approvals, need ${quorum?.n ?? 1}) — re-queuing`);
        }
        const blocked = shouldBlock(decisions, policy, quorum) || !quorumMet;
        if (blocked) {
            // Re-queue the prior agent_run step with reviewer feedback injected.
            await injectReviewerFeedback(stepRun.id, wfRun.id, decisions);
            await requeuePriorStep(wfRun, stepRun);
            const requestChangesCount = decisions.filter((d) => d.decision === 'request_changes').length;
            await appendSystemComment({
                issueId: wfRun.issueId,
                eventKind: 'review.requested_changes',
                summary: `Review step ${stepRun.stepIndex + 1} requested changes (${requestChangesCount} of ${decisions.length} reviewer(s)) — prior step re-queued.`,
                eventPayload: {
                    workflowRunId: wfRun.id,
                    stepRunId: stepRun.id,
                    stepIndex: stepRun.stepIndex,
                    decisions: decisions.map((d) => ({
                        agentId: d.agentId,
                        decision: d.decision,
                        comment: d.comment ?? null,
                    })),
                    policy,
                    quorum,
                },
            }).catch((e) => console.warn(`[workflow-runner] system-comment requested_changes failed:`, e));
        }
        else {
            // All reviewers approved (and quorum met if configured) — advance.
            await recordApproval(stepRun.id, wfRun.id, decisions);
            await db
                .update(stepRuns)
                .set({ status: 'completed', updatedAt: new Date() })
                .where(eq(stepRuns.id, stepRun.id));
            await advanceToNextStep(wfRun.id, wfRun.currentStepIndex ?? 0);
            const approvalCount = decisions.filter((d) => d.decision === 'approve').length;
            await appendSystemComment({
                issueId: wfRun.issueId,
                eventKind: 'review.approved',
                summary: `Review step ${stepRun.stepIndex + 1} approved (${approvalCount} of ${decisions.length} reviewer(s)).`,
                eventPayload: {
                    workflowRunId: wfRun.id,
                    stepRunId: stepRun.id,
                    stepIndex: stepRun.stepIndex,
                    decisions: decisions.map((d) => ({
                        agentId: d.agentId,
                        decision: d.decision,
                    })),
                    policy,
                    quorum,
                },
            }).catch((e) => console.warn(`[workflow-runner] system-comment review.approved failed:`, e));
        }
    }
}
// ---------------------------------------------------------------------------
// handleFanOutStep — Demo 10 Invariant 5
// ---------------------------------------------------------------------------
async function handleFanOutStep(wfRun, stepRun, stepDef) {
    const db = getDb();
    const { stepRuns, workflowRuns, issues } = schema;
    if (!stepDef) {
        console.error(`[workflow-runner] fan_out step ${stepRun.stepIndex} missing step definition`);
        return;
    }
    // ── Phase A: First tick — materialize child workflow_runs ─────────────────
    if (stepRun.status === 'pending') {
        const [issue] = await db
            .select()
            .from(issues)
            .where(eq(issues.id, wfRun.issueId))
            .limit(1);
        if (!issue) {
            console.error(`[workflow-runner] fan_out: issue ${wfRun.issueId} not found`);
            return;
        }
        try {
            const { childWorkflowRunIds: childIds, spawnResults, parallelSpawnSkippedReason } = await materializeAndSpawnFanOut(wfRun.id, stepRun.id, stepDef, issue, db);
            // Mark parent stepRun as waiting_children (transaction already set 'splitting',
            // but post-COMMIT we advance to 'waiting_children')
            await db
                .update(stepRuns)
                .set({
                status: 'waiting_children',
                splitTargets: JSON.stringify(childIds),
                updatedAt: new Date(),
            })
                .where(eq(stepRuns.id, stepRun.id));
            await db
                .update(workflowRuns)
                .set({ status: 'running', updatedAt: new Date() })
                .where(eq(workflowRuns.id, wfRun.id));
            const mode = stepDef.mode ?? 'serial';
            console.log(`[workflow-runner] fan_out step ${stepRun.stepIndex} spawned ${childIds.length} children ` +
                `for workflow_run ${wfRun.id} (mode=${mode})`);
            if (mode === 'parallel' && spawnResults) {
                const ok = spawnResults.filter((r) => r.status === 'success').length;
                const fail = spawnResults.filter((r) => r.status === 'failed').length;
                console.log(`[workflow-runner] parallel spawn: ${ok} succeeded, ${fail} failed ` +
                    `(parent_step=${stepRun.id})`);
            }
            else if (mode === 'parallel' && parallelSpawnSkippedReason) {
                console.warn(`[workflow-runner] parallel spawn skipped — ${parallelSpawnSkippedReason}; ` +
                    `dispatcher will pick up children serially`);
            }
        }
        catch (err) {
            console.error(`[workflow-runner] fan_out materialization failed:`, err);
            await db
                .update(stepRuns)
                .set({ status: 'failed', updatedAt: new Date() })
                .where(eq(stepRuns.id, stepRun.id));
            await db
                .update(workflowRuns)
                .set({ status: 'failed', updatedAt: new Date() })
                .where(eq(workflowRuns.id, wfRun.id));
        }
        return;
    }
    // ── Phase B: Subsequent ticks — poll children via merge gate ─────────────
    if (stepRun.status === 'waiting_children') {
        const mergeStrategy = stepDef.merge_strategy ?? 'all';
        const onChildFailure = stepDef.on_child_failure ?? 'fail_fast';
        const { done, failed, results } = await checkFanOutCompletion(wfRun.id, mergeStrategy, onChildFailure, db);
        if (!done)
            return; // children still running — wait for next tick
        if (failed) {
            console.warn(`[workflow-runner] fan_out step ${stepRun.stepIndex} failed: a child failed ` +
                `and on_child_failure='fail_fast'`);
            await db
                .update(stepRuns)
                .set({ status: 'failed', updatedAt: new Date() })
                .where(eq(stepRuns.id, stepRun.id));
            await db
                .update(workflowRuns)
                .set({ status: 'failed', updatedAt: new Date() })
                .where(eq(workflowRuns.id, wfRun.id));
            return;
        }
        // Merge child outputs into this step_run's output field
        const mergedOutput = JSON.stringify(results.map((r) => ({ workflowRunId: r.workflowRunId, status: r.status, output: r.output })), null, 2);
        await db
            .update(stepRuns)
            .set({ status: 'completed', output: mergedOutput, updatedAt: new Date() })
            .where(eq(stepRuns.id, stepRun.id));
        console.log(`[workflow-runner] fan_out step ${stepRun.stepIndex} completed (${results.length} children, ` +
            `strategy=${mergeStrategy})`);
        await advanceToNextStep(wfRun.id, wfRun.currentStepIndex ?? 0);
    }
}
// ---------------------------------------------------------------------------
// handleHandoffStep — Demo 10 fire-and-forget transfer
// ---------------------------------------------------------------------------
async function handleHandoffStep(wfRun, stepRun, stepDef) {
    const db = getDb();
    const { stepRuns, workflowRuns, issueRuns, issues, agents } = schema;
    if (stepRun.status === 'completed') {
        await advanceToNextStep(wfRun.id, wfRun.currentStepIndex ?? 0);
        return;
    }
    if (!stepDef) {
        console.error(`[workflow-runner] handoff step ${stepRun.stepIndex} missing step definition`);
        return;
    }
    const [issue] = await db
        .select()
        .from(issues)
        .where(eq(issues.id, wfRun.issueId))
        .limit(1);
    if (!issue)
        return;
    // Resolve target agent by name
    const [targetAgent] = await db
        .select()
        .from(agents)
        .where(and(eq(agents.projectId, issue.projectId), eq(agents.name, stepDef.to)))
        .limit(1);
    if (!targetAgent) {
        console.error(`[workflow-runner] handoff step: agent '${stepDef.to}' not found`);
        // Fail gracefully — skip the handoff but don't block the workflow
        await db
            .update(stepRuns)
            .set({ status: 'completed', updatedAt: new Date() })
            .where(eq(stepRuns.id, stepRun.id));
        await advanceToNextStep(wfRun.id, wfRun.currentStepIndex ?? 0);
        return;
    }
    // Gather prior step output for inputContext
    const priorIndex = (wfRun.currentStepIndex ?? 0) - 1;
    let priorOutput = '';
    if (priorIndex >= 0) {
        const priorStepRows = await db
            .select({ issueRunId: stepRuns.issueRunId })
            .from(stepRuns)
            .where(and(eq(stepRuns.workflowRunId, wfRun.id), eq(stepRuns.stepIndex, priorIndex)))
            .limit(1);
        if (priorStepRows[0]?.issueRunId) {
            const [priorRun] = await db
                .select({ output: issueRuns.output })
                .from(issueRuns)
                .where(eq(issueRuns.id, priorStepRows[0].issueRunId))
                .limit(1);
            priorOutput = priorRun?.output ?? '';
        }
    }
    const inputContext = stepDef.message
        ? `## Handoff Message\n\n${stepDef.message}\n\n---\n\n${priorOutput}`
        : priorOutput;
    // Create a new issueRun for the target agent (Invariant 1: kind='agent_run')
    const [newRun] = await db
        .insert(issueRuns)
        .values({
        issueId: wfRun.issueId,
        agentId: targetAgent.id,
        kind: 'agent_run',
        status: 'pending',
        inputContext: inputContext || null,
    })
        .returning({ id: issueRuns.id });
    // Update issue assignee to target agent
    await db
        .update(issues)
        .set({ assigneeId: targetAgent.id, updatedAt: new Date() })
        .where(eq(issues.id, wfRun.issueId));
    // Mark handoff step completed immediately (fire-and-forget; stepper picks up the new run)
    await db
        .update(stepRuns)
        .set({ issueRunId: newRun.id, status: 'completed', updatedAt: new Date() })
        .where(eq(stepRuns.id, stepRun.id));
    await db
        .update(workflowRuns)
        .set({ status: 'running', updatedAt: new Date() })
        .where(eq(workflowRuns.id, wfRun.id));
    console.log(`[workflow-runner] handoff step ${stepRun.stepIndex} → agent '${stepDef.to}' ` +
        `(issue_run ${newRun.id}); workflow advancing`);
    await advanceToNextStep(wfRun.id, wfRun.currentStepIndex ?? 0);
}
// ---------------------------------------------------------------------------
// requeuePriorStep — re-run the agent_run step before an approve gate
// ---------------------------------------------------------------------------
/**
 * Reset the prior agent_run step to pending (with feedback in inputContext)
 * and wind the workflow back so the agent revises its work.
 *
 * The prior step's issueRun is NOT recycled — a fresh pending issueRun will be
 * spawned by the next handleAgentRunStep tick after we clear issueRunId.
 */
async function requeuePriorStep(wfRun, approveStepRun) {
    const db = getDb();
    const { stepRuns, workflowRuns, issueRuns } = schema;
    const priorIndex = approveStepRun.stepIndex - 1;
    if (priorIndex < 0) {
        console.warn(`[workflow-runner] approve step at index 0 — no prior step to re-queue`);
        return;
    }
    const [priorStep] = await db
        .select()
        .from(stepRuns)
        .where(and(eq(stepRuns.workflowRunId, wfRun.id), eq(stepRuns.stepIndex, priorIndex)))
        .limit(1);
    if (!priorStep) {
        console.error(`[workflow-runner] no prior step_run at index ${priorIndex} for re-queue`);
        return;
    }
    // Build feedback context from the approve step's stored suggestions.
    const suggestions = Array.isArray(approveStepRun.reviewSuggestions)
        ? approveStepRun.reviewSuggestions
        : [];
    const comment = approveStepRun.reviewComment ?? '';
    const feedbackContext = buildFeedbackContext(comment, suggestions);
    // Create a new issueRun with the feedback injected so the agent sees it.
    // We clear the prior step's issueRunId so handleAgentRunStep waits for the new run.
    // The new issueRun copies agentId from the old one.
    if (priorStep.issueRunId) {
        const [oldRun] = await db
            .select({ agentId: issueRuns.agentId })
            .from(issueRuns)
            .where(eq(issueRuns.id, priorStep.issueRunId))
            .limit(1);
        if (oldRun) {
            const [newRun] = await db
                .insert(issueRuns)
                .values({
                issueId: wfRun.issueId,
                agentId: oldRun.agentId,
                kind: 'agent_run',
                status: 'pending',
                inputContext: feedbackContext,
            })
                .returning({ id: issueRuns.id });
            // Reset prior step_run: link to new issueRun, set pending.
            await db
                .update(stepRuns)
                .set({
                status: 'pending',
                issueRunId: newRun.id,
                retryCount: (priorStep.retryCount ?? 0) + 1,
                updatedAt: new Date(),
            })
                .where(eq(stepRuns.id, priorStep.id));
        }
    }
    else {
        // Prior step had no issueRunId — just reset to pending.
        await db
            .update(stepRuns)
            .set({ status: 'pending', updatedAt: new Date() })
            .where(eq(stepRuns.id, priorStep.id));
    }
    // Reset the approve step to pending so it will re-initiate reviews after the revision.
    await db
        .update(stepRuns)
        .set({
        status: 'pending',
        reviewDecision: null,
        reviewComment: null,
        reviewSuggestions: null,
        updatedAt: new Date(),
    })
        .where(eq(stepRuns.id, approveStepRun.id));
    // Wind workflow back to the prior step index.
    await db
        .update(workflowRuns)
        .set({ currentStepIndex: priorIndex, updatedAt: new Date() })
        .where(eq(workflowRuns.id, wfRun.id));
    console.log(`[workflow-runner] re-queued prior step ${priorIndex} for workflow_run ${wfRun.id} ` +
        `with reviewer feedback (${suggestions.length} suggestion(s))`);
}
function buildFeedbackContext(comment, suggestions) {
    const lines = ['## Reviewer Feedback (requires revision)', ''];
    if (comment) {
        lines.push(comment, '');
    }
    if (suggestions.length > 0) {
        lines.push('**Suggestions:**');
        for (const s of suggestions) {
            lines.push(`- ${s}`);
        }
        lines.push('');
    }
    lines.push('Please address the feedback above and resubmit your work.');
    return lines.join('\n');
}
// ---------------------------------------------------------------------------
// advanceToNextStep
// ---------------------------------------------------------------------------
async function advanceToNextStep(workflowRunId, currentIndex) {
    const db = getDb();
    const { workflowRuns, stepRuns } = schema;
    const nextIndex = currentIndex + 1;
    // Check whether a next step exists
    const [nextStep] = await db
        .select({ id: stepRuns.id })
        .from(stepRuns)
        .where(and(eq(stepRuns.workflowRunId, workflowRunId), eq(stepRuns.stepIndex, nextIndex)))
        .limit(1);
    if (nextStep) {
        await db
            .update(workflowRuns)
            .set({ currentStepIndex: nextIndex, updatedAt: new Date() })
            .where(eq(workflowRuns.id, workflowRunId));
        console.log(`[workflow-runner] workflow_run ${workflowRunId} advanced to step ${nextIndex}`);
        // ── Flow event: heartbeat on step advancement ────────────────────────────
        const pid = await getProjectIdForWorkflowRun(workflowRunId);
        if (pid) {
            eventBus.emitFlowHeartbeat(pid, workflowRunId, { instanceId: workflowRunId, status: 'active' });
        }
    }
    else {
        // All steps complete
        await db
            .update(workflowRuns)
            .set({ status: 'completed', updatedAt: new Date() })
            .where(eq(workflowRuns.id, workflowRunId));
        console.log(`[workflow-runner] workflow_run ${workflowRunId} completed`);
        // ── Flow event: instance ended ───────────────────────────────────────────
        const pid = await getProjectIdForWorkflowRun(workflowRunId);
        if (pid) {
            eventBus.emitFlowEvent('flow.instance.ended', pid, { instanceId: workflowRunId, status: 'completed' });
        }
    }
}
// ---------------------------------------------------------------------------
// tickWorkflowAdvancement — called by dispatcher on every tick (Demo 10)
// ---------------------------------------------------------------------------
/**
 * Advance all non-terminal workflow_runs by one step.
 *
 * This is the entry point the dispatcher calls every tick to drive workflow
 * execution. All active (pending | running) workflow_runs are ticked.
 * Fan-out waiting_children status is handled inside advanceWorkflowRun via
 * handleFanOutStep Phase B.
 *
 * Invariant 2 compliance: this function does NOT touch issue_runs status.
 * Only the stepper (claimAndRun) does that.
 */
export async function tickWorkflowAdvancement() {
    const db = getDb();
    // Find all active workflow_runs (including children waiting for their first step)
    const activeRuns = await db.execute(sql `
    SELECT id FROM workflow_runs
    WHERE status NOT IN ('completed', 'failed', 'cancelled')
    ORDER BY created_at
  `);
    const runIds = activeRuns.rows.map((r) => r.id);
    if (runIds.length === 0)
        return;
    if (process.env.LOG_LEVEL === 'debug') {
        console.debug(`[workflow-runner] ticking ${runIds.length} active workflow_run(s)`);
    }
    for (const runId of runIds) {
        try {
            await advanceWorkflowRun(runId);
        }
        catch (err) {
            console.error(`[workflow-runner] error advancing workflow_run ${runId}:`, err);
        }
    }
}
//# sourceMappingURL=workflow-runner.js.map