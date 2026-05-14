/**
 * workflows.ts — Workflow API routes (Demo 6)
 *
 * Mounts:
 *   workflowsRouter  → /api/projects/:projectId/workflows
 *   issueWorkflowRouter → /api/projects/:projectId/issues/:issueId/workflow
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
    const { projectId } = req.params;
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
    const { projectId } = req.params;
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
    const { projectId, id } = req.params;
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
    const { projectId, id } = req.params;
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
    const { projectId, id } = req.params;
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
    const { issueId } = req.params;
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
    const { issueId } = req.params;
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
    const { issueId } = req.params;
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
