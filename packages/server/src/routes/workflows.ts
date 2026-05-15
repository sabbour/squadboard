/**
 * workflows.ts — Workflow API routes (Demo 6 + Demo 9)
 *
 * Mounts:
 *   workflowsRouter     → /api/projects/:projectId/workflows
 *   issueWorkflowRouter → /api/projects/:projectId/issues/:issueId/workflow
 *   workflowRunsRouter  → /api/workflow-runs  (Demo 9: review endpoints)
 *   stepRunsRouter      → /api/step-runs      (Demo 9: manual review override)
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { eq, and } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { parseWorkflowYaml, validateWorkflowYaml } from '../services/workflow-parser.js';
import { createWorkflowRun } from '../engine/workflow-runner.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function handleError(res: Response, err: unknown) {
  console.error('[workflows] error:', err);
  res.status(500).json({ error: 'Internal server error' });
}

// ---------------------------------------------------------------------------
// workflowsRouter — /api/projects/:projectId/workflows
// ---------------------------------------------------------------------------

export const workflowsRouter = Router({ mergeParams: true });

// GET /   — list workflows for a project
workflowsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params as Record<string, string>;
    const db = getDb();

    const rows = await db
      .select()
      .from(schema.workflows)
      .where(eq(schema.workflows.projectId, projectId));

    res.json(rows);
  } catch (err) {
    handleError(res, err);
  }
});

// POST /   — create workflow (parse YAML, validate, version 1)
workflowsRouter.post('/', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params as Record<string, string>;
    const { yamlContent } = req.body as { yamlContent?: string };

    if (!yamlContent) {
      res.status(400).json({ error: '`yamlContent` is required' });
      return;
    }

    const { valid, errors } = validateWorkflowYaml(yamlContent);
    if (!valid) {
      res.status(422).json({ error: 'Invalid workflow YAML', errors });
      return;
    }

    const definition = await parseWorkflowYaml(yamlContent);
    const slug = definition.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    const db = getDb();

    const [workflow] = await db
      .insert(schema.workflows)
      .values({
        projectId,
        name: definition.name,
        slug,
        description: definition.description,
      })
      .returning();

    const [version] = await db
      .insert(schema.workflowVersions)
      .values({
        workflowId: workflow.id,
        version: 1,
        yamlContent,
        jsonSchema: definition.outputSchema ? JSON.stringify(definition.outputSchema) : null,
        isActive: true,
      })
      .returning();

    res.status(201).json({ workflow, version });
  } catch (err) {
    handleError(res, err);
  }
});

// GET /:id   — get workflow + active version
workflowsRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const { projectId, id } = req.params as Record<string, string>;
    const db = getDb();

    const [workflow] = await db
      .select()
      .from(schema.workflows)
      .where(and(eq(schema.workflows.id, id), eq(schema.workflows.projectId, projectId)))
      .limit(1);

    if (!workflow) {
      res.status(404).json({ error: 'Workflow not found' });
      return;
    }

    const versions = await db
      .select()
      .from(schema.workflowVersions)
      .where(eq(schema.workflowVersions.workflowId, id));

    const activeVersion = versions.find((v) => v.isActive) ?? versions[versions.length - 1] ?? null;

    res.json({ workflow, activeVersion, versions });
  } catch (err) {
    handleError(res, err);
  }
});

// PUT /:id   — update (creates new version; old versions become immutable history)
workflowsRouter.put('/:id', async (req: Request, res: Response) => {
  try {
    const { projectId, id } = req.params as Record<string, string>;
    const { yamlContent } = req.body as { yamlContent?: string };

    if (!yamlContent) {
      res.status(400).json({ error: '`yamlContent` is required' });
      return;
    }

    const { valid, errors } = validateWorkflowYaml(yamlContent);
    if (!valid) {
      res.status(422).json({ error: 'Invalid workflow YAML', errors });
      return;
    }

    const db = getDb();

    const [workflow] = await db
      .select()
      .from(schema.workflows)
      .where(and(eq(schema.workflows.id, id), eq(schema.workflows.projectId, projectId)))
      .limit(1);

    if (!workflow) {
      res.status(404).json({ error: 'Workflow not found' });
      return;
    }

    const definition = await parseWorkflowYaml(yamlContent);

    // Deactivate existing active versions
    const existingVersions = await db
      .select({ version: schema.workflowVersions.version })
      .from(schema.workflowVersions)
      .where(eq(schema.workflowVersions.workflowId, id));

    const nextVersion = existingVersions.length > 0
      ? Math.max(...existingVersions.map((v) => v.version)) + 1
      : 1;

    await db
      .update(schema.workflowVersions)
      .set({ isActive: false })
      .where(and(
        eq(schema.workflowVersions.workflowId, id),
        eq(schema.workflowVersions.isActive, true),
      ));

    const [newVersion] = await db
      .insert(schema.workflowVersions)
      .values({
        workflowId: id,
        version: nextVersion,
        yamlContent,
        jsonSchema: definition.outputSchema ? JSON.stringify(definition.outputSchema) : null,
        isActive: true,
      })
      .returning();

    // Update workflow metadata
    await db
      .update(schema.workflows)
      .set({
        name: definition.name,
        description: definition.description,
        updatedAt: new Date(),
      })
      .where(eq(schema.workflows.id, id));

    res.json({ workflow: { ...workflow, name: definition.name }, version: newVersion });
  } catch (err) {
    handleError(res, err);
  }
});

// DELETE /:id   — archive workflow (deactivates all versions)
workflowsRouter.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { projectId, id } = req.params as Record<string, string>;
    const db = getDb();

    const [workflow] = await db
      .select()
      .from(schema.workflows)
      .where(and(eq(schema.workflows.id, id), eq(schema.workflows.projectId, projectId)))
      .limit(1);

    if (!workflow) {
      res.status(404).json({ error: 'Workflow not found' });
      return;
    }

    await db
      .update(schema.workflowVersions)
      .set({ isActive: false })
      .where(eq(schema.workflowVersions.workflowId, id));

    res.json({ message: 'Workflow archived', workflowId: id });
  } catch (err) {
    handleError(res, err);
  }
});

// ---------------------------------------------------------------------------
// issueWorkflowRouter — /api/projects/:projectId/issues/:issueId/workflow
// ---------------------------------------------------------------------------

export const issueWorkflowRouter = Router({ mergeParams: true });

// POST /   — attach workflow to issue
issueWorkflowRouter.post('/', async (req: Request, res: Response) => {
  try {
    const { issueId } = req.params as Record<string, string>;
    const { workflowVersionId } = req.body as { workflowVersionId?: string };

    if (!workflowVersionId) {
      res.status(400).json({ error: '`workflowVersionId` is required' });
      return;
    }

    const db = getDb();

    // Upsert: if already attached, replace with new version
    await db
      .delete(schema.issueWorkflows)
      .where(eq(schema.issueWorkflows.issueId, issueId));

    const [record] = await db
      .insert(schema.issueWorkflows)
      .values({ issueId, workflowVersionId })
      .returning();

    res.status(201).json(record);
  } catch (err) {
    handleError(res, err);
  }
});

// DELETE /   — detach workflow from issue
issueWorkflowRouter.delete('/', async (req: Request, res: Response) => {
  try {
    const { issueId } = req.params as Record<string, string>;
    const db = getDb();

    await db
      .delete(schema.issueWorkflows)
      .where(eq(schema.issueWorkflows.issueId, issueId));

    res.json({ message: 'Workflow detached', issueId });
  } catch (err) {
    handleError(res, err);
  }
});

// POST /start   — start workflow execution
issueWorkflowRouter.post('/start', async (req: Request, res: Response) => {
  try {
    const { issueId } = req.params as Record<string, string>;
    const db = getDb();

    const [attachment] = await db
      .select()
      .from(schema.issueWorkflows)
      .where(eq(schema.issueWorkflows.issueId, issueId))
      .limit(1);

    if (!attachment) {
      res.status(404).json({ error: 'No workflow attached to this issue' });
      return;
    }

    const workflowRunId = await createWorkflowRun(issueId, attachment.workflowVersionId);

    res.status(201).json({ workflowRunId, message: 'Workflow execution started' });
  } catch (err) {
    handleError(res, err);
  }
});

// ---------------------------------------------------------------------------
// workflowRunsRouter — /api/workflow-runs  (Demo 9)
// ---------------------------------------------------------------------------

export const workflowRunsRouter = Router();

/**
 * GET /api/workflow-runs/:id/reviews
 *
 * List all review events (audit trail) for a workflow run.
 * Returns every verb action (approve, request_changes, comment, dismiss)
 * recorded in insertion order with reviewer identity and timestamp.
 */
workflowRunsRouter.get('/:id/reviews', async (req: Request, res: Response) => {
  try {
    const { id } = req.params as Record<string, string>;
    const db = getDb();

    const events = await db
      .select()
      .from(schema.reviewEvents)
      .where(eq(schema.reviewEvents.workflowRunId, id));

    res.json(events);
  } catch (err) {
    handleError(res, err);
  }
});

// ---------------------------------------------------------------------------
// stepRunsRouter — /api/step-runs  (Demo 9)
// ---------------------------------------------------------------------------

export const stepRunsRouter = Router();

/**
 * POST /api/step-runs/:id/review
 *
 * Manual human override for a peer review gate.
 *
 * Body: { verb: 'approve' | 'request_changes' | 'comment' | 'dismiss', body?: string, suggestions?: string[] }
 *
 * Rules:
 *  - `verb` is required.
 *  - Any authenticated user may submit a review (reviewer lockout is enforced
 *    at the engine level for agent-driven reviews only).
 *  - If `verb === 'approve'`: marks the approve step_run as completed and advances.
 *  - If `verb === 'request_changes'`: stores feedback, re-queues prior agent_run step.
 *  - If `verb === 'comment'` or 'dismiss': records the event only (no state change).
 */
stepRunsRouter.post('/:id/review', async (req: Request, res: Response) => {
  try {
    const { id } = req.params as Record<string, string>;
    const { verb, body: reviewBody, suggestions } = req.body as {
      verb?: string;
      body?: string;
      suggestions?: string[];
    };

    const VALID_VERBS = ['approve', 'request_changes', 'comment', 'dismiss'];
    if (!verb || !VALID_VERBS.includes(verb)) {
      res.status(400).json({ error: `'verb' must be one of: ${VALID_VERBS.join(', ')}` });
      return;
    }

    const db = getDb();

    // Load the step_run.
    const [stepRun] = await db
      .select()
      .from(schema.stepRuns)
      .where(eq(schema.stepRuns.id, id))
      .limit(1);

    if (!stepRun) {
      res.status(404).json({ error: 'step_run not found' });
      return;
    }

    if (stepRun.stepType !== 'approve') {
      res.status(422).json({ error: 'Reviews can only be submitted on approve step_runs' });
      return;
    }

    const [wfRun] = await db
      .select()
      .from(schema.workflowRuns)
      .where(eq(schema.workflowRuns.id, stepRun.workflowRunId))
      .limit(1);

    if (!wfRun) {
      res.status(404).json({ error: 'workflow_run not found' });
      return;
    }

    // Record the review event (audit trail — all verbs).
    await db.insert(schema.reviewEvents).values({
      workflowRunId: wfRun.id,
      stepRunId: id,
      issueRunId: null,
      reviewerAgentId: null,
      reviewerName: 'human',
      verb,
      body: reviewBody ?? null,
      suggestions: suggestions ?? [],
    });

    // Act on the verb.
    if (verb === 'approve') {
      await db
        .update(schema.stepRuns)
        .set({ status: 'completed', reviewDecision: 'approve', reviewComment: reviewBody ?? null, updatedAt: new Date() })
        .where(eq(schema.stepRuns.id, id));

      // Advance the workflow.
      const nextIndex = (wfRun.currentStepIndex ?? 0) + 1;
      const [nextStep] = await db
        .select({ id: schema.stepRuns.id })
        .from(schema.stepRuns)
        .where(and(eq(schema.stepRuns.workflowRunId, wfRun.id), eq(schema.stepRuns.stepIndex, nextIndex)))
        .limit(1);

      if (nextStep) {
        await db
          .update(schema.workflowRuns)
          .set({ currentStepIndex: nextIndex, updatedAt: new Date() })
          .where(eq(schema.workflowRuns.id, wfRun.id));
      } else {
        await db
          .update(schema.workflowRuns)
          .set({ status: 'completed', updatedAt: new Date() })
          .where(eq(schema.workflowRuns.id, wfRun.id));
      }

      res.json({ message: 'Approved — workflow advanced', stepRunId: id });
    } else if (verb === 'request_changes') {
      const suggestionList: string[] = suggestions ?? [];

      await db
        .update(schema.stepRuns)
        .set({
          reviewDecision: 'request_changes',
          reviewComment: reviewBody ?? null,
          reviewSuggestions: suggestionList,
          updatedAt: new Date(),
        })
        .where(eq(schema.stepRuns.id, id));

      // Re-queue prior agent_run step (same logic as engine path).
      const priorIndex = stepRun.stepIndex - 1;
      if (priorIndex >= 0) {
        const [priorStep] = await db
          .select()
          .from(schema.stepRuns)
          .where(
            and(
              eq(schema.stepRuns.workflowRunId, wfRun.id),
              eq(schema.stepRuns.stepIndex, priorIndex),
            ),
          )
          .limit(1);

        if (priorStep) {
          // Create a new issueRun with feedback injected if we can derive the agent.
          if (priorStep.issueRunId) {
            const [oldRun] = await db
              .select({ agentId: schema.issueRuns.agentId })
              .from(schema.issueRuns)
              .where(eq(schema.issueRuns.id, priorStep.issueRunId))
              .limit(1);

            if (oldRun) {
              const feedbackLines = ['## Human Reviewer Feedback (requires revision)', ''];
              if (reviewBody) feedbackLines.push(reviewBody, '');
              if (suggestionList.length > 0) {
                feedbackLines.push('**Suggestions:**');
                for (const s of suggestionList) feedbackLines.push(`- ${s}`);
              }
              const feedbackContext = feedbackLines.join('\n');

              const [newRun] = await db
                .insert(schema.issueRuns)
                .values({
                  issueId: wfRun.issueId,
                  agentId: oldRun.agentId,
                  kind: 'agent_run',
                  status: 'pending',
                  inputContext: feedbackContext,
                })
                .returning({ id: schema.issueRuns.id });

              await db
                .update(schema.stepRuns)
                .set({ status: 'pending', issueRunId: newRun.id, updatedAt: new Date() })
                .where(eq(schema.stepRuns.id, priorStep.id));
            }
          } else {
            await db
              .update(schema.stepRuns)
              .set({ status: 'pending', updatedAt: new Date() })
              .where(eq(schema.stepRuns.id, priorStep.id));
          }

          // Reset approve step to pending for re-review after revision.
          await db
            .update(schema.stepRuns)
            .set({ status: 'pending', reviewDecision: null, reviewComment: null, reviewSuggestions: null, updatedAt: new Date() })
            .where(eq(schema.stepRuns.id, id));

          await db
            .update(schema.workflowRuns)
            .set({ currentStepIndex: priorIndex, updatedAt: new Date() })
            .where(eq(schema.workflowRuns.id, wfRun.id));
        }
      }

      res.json({ message: 'Changes requested — prior step re-queued', stepRunId: id });
    } else {
      // comment or dismiss — record only, no state change.
      res.json({ message: `Review verb '${verb}' recorded`, stepRunId: id });
    }
  } catch (err) {
    handleError(res, err);
  }
});
