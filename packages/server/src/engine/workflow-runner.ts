/**
 * workflow-runner.ts — YAML workflow execution engine (Demo 6)
 *
 * Advances workflow_runs step by step. Steps desugar to issue_runs (Invariant 1).
 * The stepper still picks up resulting issue_runs via FOR UPDATE SKIP LOCKED (Invariant 2).
 *
 * Step types:
 *   route      → resolveRoute() → create issue_run kind='agent_run'
 *   agent_run  → issue_run already exists; poll for completion
 *   approve    → stub for Demo 9 (creates a pending record)
 *
 * pinnedAgentRevisions: snapshotted per step at step start (open question #1 resolution).
 */

import { eq, and } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { resolveRoute } from './router.js';
import { parseWorkflowYaml } from '../services/workflow-parser.js';

// ---------------------------------------------------------------------------
// createWorkflowRun
// ---------------------------------------------------------------------------

/**
 * Initialise a workflow_run for an issue under a specific workflow version.
 *
 *  1. Parse the YAML to enumerate steps
 *  2. INSERT workflow_run (with workflowVersionId)
 *  3. INSERT step_runs (one per step, all pending)
 *
 * @returns The new workflowRunId.
 */
export async function createWorkflowRun(
  issueId: string,
  workflowVersionId: string,
): Promise<string> {
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

  // INSERT workflow_run
  const [wfRun] = await db
    .insert(workflowRuns)
    .values({
      issueId,
      workflowVersionId,
      status: 'pending',
      currentStepIndex: 0,
    })
    .returning({ id: workflowRuns.id });

  // INSERT step_runs (one per step)
  if (definition.steps.length > 0) {
    await db.insert(stepRuns).values(
      definition.steps.map((step, index) => ({
        workflowRunId: wfRun.id,
        stepIndex: index,
        stepType: step.type,
        status: 'pending' as const,
      })),
    );
  }

  console.log(
    `[workflow-runner] created workflow_run ${wfRun.id} for issue ${issueId} ` +
    `(version ${workflowVersionId}, ${definition.steps.length} steps)`,
  );
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
export async function advanceWorkflowRun(workflowRunId: string): Promise<void> {
  const db = getDb();
  const { workflowRuns, stepRuns, issueRuns, workflowVersions, issues, agents } = schema;

  // Load workflow_run
  const [wfRun] = await db
    .select()
    .from(workflowRuns)
    .where(eq(workflowRuns.id, workflowRunId))
    .limit(1);

  if (!wfRun || wfRun.status === 'completed' || wfRun.status === 'failed') return;

  const currentIndex = wfRun.currentStepIndex ?? 0;

  // Load current step_run
  const [currentStep] = await db
    .select()
    .from(stepRuns)
    .where(
      and(
        eq(stepRuns.workflowRunId, workflowRunId),
        eq(stepRuns.stepIndex, currentIndex),
      ),
    )
    .limit(1);

  if (!currentStep) {
    console.error(`[workflow-runner] no step_run at index ${currentIndex} for workflow_run ${workflowRunId}`);
    return;
  }

  // Load the workflow YAML for this step's context
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

  const stepDef = definition?.steps[currentIndex];

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

    default:
      console.warn(`[workflow-runner] unknown step type '${currentStep.stepType}' — skipping`);
      await advanceToNextStep(workflowRunId, currentIndex);
      break;
  }
}

// ---------------------------------------------------------------------------
// Step handlers
// ---------------------------------------------------------------------------

async function handleRouteStep(
  wfRun: typeof schema.workflowRuns.$inferSelect,
  stepRun: typeof schema.stepRuns.$inferSelect,
  _stepDef: { type: string } | undefined,
): Promise<void> {
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
    .where(eq(agents.projectId,
      (await db.select({ projectId: issues.projectId }).from(issues).where(eq(issues.id, wfRun.issueId)).limit(1))[0].projectId,
    ));
  const pinnedRevisions: Record<string, string> = {};
  for (const a of allAgents) {
    if (a.charterHash) pinnedRevisions[a.name] = a.charterHash;
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
  if (!project) return;

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

async function handleAgentRunStep(
  wfRun: typeof schema.workflowRuns.$inferSelect,
  stepRun: typeof schema.stepRuns.$inferSelect,
): Promise<void> {
  const db = getDb();
  const { stepRuns, issueRuns } = schema;

  if (stepRun.status === 'completed') {
    await advanceToNextStep(wfRun.id, wfRun.currentStepIndex ?? 0);
    return;
  }

  if (!stepRun.issueRunId) {
    // No issue_run yet — wait for route step to create one (or direct creation)
    return;
  }

  // Check linked issue_run
  const [run] = await db
    .select({ status: issueRuns.status })
    .from(issueRuns)
    .where(eq(issueRuns.id, stepRun.issueRunId))
    .limit(1);

  if (!run) return;

  if (run.status === 'completed') {
    await db
      .update(stepRuns)
      .set({ status: 'completed', updatedAt: new Date() })
      .where(eq(stepRuns.id, stepRun.id));
    await advanceToNextStep(wfRun.id, wfRun.currentStepIndex ?? 0);
  } else if (run.status === 'failed' || run.status === 'cancelled') {
    await db
      .update(stepRuns)
      .set({ status: run.status, updatedAt: new Date() })
      .where(eq(stepRuns.id, stepRun.id));
    await db
      .update(schema.workflowRuns)
      .set({ status: 'failed', updatedAt: new Date() })
      .where(eq(schema.workflowRuns.id, wfRun.id));
    console.warn(`[workflow-runner] workflow_run ${wfRun.id} failed at agent_run step ${stepRun.stepIndex}`);
  }
  // else: still running/pending — wait for next tick
}

async function handleApproveStep(
  wfRun: typeof schema.workflowRuns.$inferSelect,
  stepRun: typeof schema.stepRuns.$inferSelect,
  stepDef: { approvers?: string[]; timeout?: string } | undefined,
): Promise<void> {
  // Demo 9 stub — approval gate is not yet implemented.
  // For now: log the pending approval and leave the step in 'pending'.
  // Demo 9 will fill in quorum logic, approver resolution, and timeout handling.
  if (stepRun.status === 'pending') {
    console.log(
      `[workflow-runner] approve step ${stepRun.stepIndex} for workflow_run ${wfRun.id} is pending approval ` +
      `(approvers: ${JSON.stringify(stepDef?.approvers ?? [])}, timeout: ${stepDef?.timeout ?? 'none'}) — stub until Demo 9`,
    );
  }
}

// ---------------------------------------------------------------------------
// advanceToNextStep
// ---------------------------------------------------------------------------

async function advanceToNextStep(workflowRunId: string, currentIndex: number): Promise<void> {
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
  } else {
    // All steps complete
    await db
      .update(workflowRuns)
      .set({ status: 'completed', updatedAt: new Date() })
      .where(eq(workflowRuns.id, workflowRunId));
    console.log(`[workflow-runner] workflow_run ${workflowRunId} completed`);
  }
}
