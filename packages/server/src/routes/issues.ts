import { Router } from 'express';
import type { Request, Response } from 'express';
import * as issuesService from '../services/issues.js';
import type { ColumnStatus } from '../services/issues.js';
import { and, eq, sql } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { resolveRoute, createRoutedRun } from '../engine/router.js';
import { eventBus } from '../realtime/event-bus.js';

const router = Router({ mergeParams: true });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function handleError(res: Response, err: unknown) {
  if (err instanceof Error && (err as NodeJS.ErrnoException & { status?: number }).status) {
    const status = (err as unknown as { status: number }).status;
    res.status(status).json({ error: err.message });
    return;
  }
  console.error('[issues] unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
}

/** Adds `column` as an alias for `status` so the client can use `issue.column`. */
function serialize<T extends { status?: string }>(issue: T): T & { column: string | undefined } {
  return { ...issue, column: issue.status };
}

// ---------------------------------------------------------------------------
// Issues
// ---------------------------------------------------------------------------

// GET /api/projects/:projectId/issues
router.get('/', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params as Record<string, string>;
    const { status, label, search } = req.query as Record<string, string>;
    const rows = await issuesService.listIssues(projectId, {
      status: status as ColumnStatus | undefined,
      labelId: label,
      search,
    });
    res.json(rows.map(serialize));
  } catch (err) {
    handleError(res, err);
  }
});

// POST /api/projects/:projectId/issues
router.post('/', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params as Record<string, string>;
    const { title, body, status, column, assigneeId, labels } = req.body as {
      title: string;
      body?: string;
      status?: ColumnStatus;
      column?: ColumnStatus; // client alias for status
      assigneeId?: string;
      labels?: string[];
    };
    const created = await issuesService.createIssue(projectId, { title, body, status: status ?? column, assigneeId });

    // Tier 1 auto-routing: resolve a rule and create an issue_run (Invariant 1)
    let autoRoutedTo: string | null = null;
    try {
      const issueLabels = labels ?? [];
      const match = await resolveRoute(projectId, {
        title: created.title,
        labels: issueLabels,
        body: created.body ?? '',
      });

      if (match) {
        // Look up the agent by name within this project
        const [agent] = await getDb()
          .select()
          .from(schema.agents)
          .where(
            and(
              eq(schema.agents.projectId, projectId),
              eq(schema.agents.name, match.agentName),
            ),
          );

        if (agent) {
          await createRoutedRun(created.id, agent.id, match.rule.rawRule);
          autoRoutedTo = match.agentName;
          console.log(`[issues] auto-routed issue ${created.id} to agent '${match.agentName}'`);
        } else {
          console.warn(`[issues] routing matched agent '${match.agentName}' but no such agent found in project ${projectId}`);
        }
      }
    } catch (routingErr) {
      // Routing failure must not fail issue creation
      console.error('[issues] auto-routing error (non-fatal):', routingErr);
    }

    res.status(201).json(serialize({ ...created, autoRoutedTo }));
    eventBus.emitIssueEvent('issue.created', projectId, { issue: serialize(created) });
  } catch (err) {
    handleError(res, err);
  }
});

// POST /api/projects/:projectId/issues/bulk
router.post('/bulk', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params as Record<string, string>;
    const { action, issueIds, status, labelIds } = req.body as {
      action: 'move' | 'label' | 'archive';
      issueIds: string[];
      status?: ColumnStatus;
      labelIds?: string[];
    };

    if (!action || !Array.isArray(issueIds)) {
      res.status(400).json({ error: '`action` and `issueIds` are required' });
      return;
    }

    const result = await issuesService.bulkAction(projectId, action, issueIds, { status, labelIds });
    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
});

// GET /api/projects/:projectId/issues/:id
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { projectId, id } = req.params as Record<string, string>;
    const issue = await issuesService.getIssue(projectId, id);
    if (!issue) {
      res.status(404).json({ error: 'Issue not found' });
      return;
    }
    res.json(serialize(issue));
  } catch (err) {
    handleError(res, err);
  }
});

// PATCH /api/projects/:projectId/issues/:id
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const { projectId, id } = req.params as Record<string, string>;
    const { title, body, status, column, assigneeId, version } = req.body as {
      title?: string;
      body?: string;
      status?: ColumnStatus;
      column?: ColumnStatus; // client alias for status
      assigneeId?: string | null;
      version?: number;
    };
    const resolvedStatus = status ?? column;

    // Optimistic concurrency check (OQ #6): if client sends `version`, enforce it.
    if (version !== undefined) {
      const db = getDb();
      const { issues } = schema;

      const patch: Record<string, unknown> = { updatedAt: new Date(), version: sql`${issues.version} + 1` };
      if (title !== undefined) patch.title = title.trim();
      if (body !== undefined) patch.body = body;
      if (resolvedStatus !== undefined) patch.status = resolvedStatus;
      if ('assigneeId' in req.body) patch.assigneeId = assigneeId ?? null;

      const [updated] = await db
        .update(issues)
        .set(patch)
        .where(and(
          eq(issues.id, id),
          eq(issues.projectId, projectId),
          eq(issues.version, version),
          eq(issues.archived, 0),
        ))
        .returning();

      if (!updated) {
        // Either not found or version mismatch — distinguish for client
        const [current] = await db
          .select({ version: issues.version })
          .from(issues)
          .where(and(eq(issues.id, id), eq(issues.projectId, projectId)))
          .limit(1);

        if (!current) {
          res.status(404).json({ error: 'Issue not found' });
          return;
        }
        res.status(409).json({ error: 'conflict', currentVersion: current.version });
        return;
      }

      eventBus.emitIssueEvent('issue.updated', projectId, { issue: serialize(updated) });
      res.json(serialize(updated));
      return;
    }

    // No version provided — legacy path, no concurrency check
    const updated = await issuesService.updateIssue(projectId, id, { title, body, status: resolvedStatus, assigneeId });
    if (!updated) {
      res.status(404).json({ error: 'Issue not found' });
      return;
    }
    eventBus.emitIssueEvent('issue.updated', projectId, { issue: serialize(updated) });
    res.json(serialize(updated));
  } catch (err) {
    handleError(res, err);
  }
});

// DELETE /api/projects/:projectId/issues/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { projectId, id } = req.params as Record<string, string>;
    const archived = await issuesService.archiveIssue(projectId, id);
    if (!archived) {
      res.status(404).json({ error: 'Issue not found' });
      return;
    }
    eventBus.emitIssueEvent('issue.deleted', projectId, { issueId: id });
    res.json(archived);
  } catch (err) {
    handleError(res, err);
  }
});

// PATCH /api/projects/:projectId/issues/:id/move
router.patch('/:id/move', async (req: Request, res: Response) => {
  try {
    const { projectId, id } = req.params as Record<string, string>;
    const { status, column, position } = req.body as { status?: ColumnStatus; column?: ColumnStatus; position?: number };
    const newStatus = (status ?? column) as ColumnStatus | undefined;
    if (!newStatus) {
      res.status(400).json({ error: '`status` is required' });
      return;
    }
    const moved = await issuesService.moveIssue(projectId, id, newStatus, position);
    if (!moved) {
      res.status(404).json({ error: 'Issue not found' });
      return;
    }
    eventBus.emitIssueEvent('issue.moved', projectId, {
      issueId: id,
      column: newStatus,  // client expects `column`
      position: moved.position,
    });
    res.json(serialize(moved));
  } catch (err) {
    handleError(res, err);
  }
});

// PATCH /api/projects/:projectId/issues/:id/labels
router.patch('/:id/labels', async (req: Request, res: Response) => {
  try {
    const { projectId, id } = req.params as Record<string, string>;
    const { labelIds } = req.body as { labelIds: string[] };
    if (!Array.isArray(labelIds)) {
      res.status(400).json({ error: '`labelIds` must be an array' });
      return;
    }
    const result = await issuesService.setIssueLabels(projectId, id, labelIds);
    if (!result) {
      res.status(404).json({ error: 'Issue not found' });
      return;
    }
    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
});

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

// GET /api/projects/:projectId/issues/:id/comments
router.get('/:id/comments', async (req: Request, res: Response) => {
  try {
    const { id } = req.params as Record<string, string>;
    const rows = await issuesService.listComments(id);
    res.json(rows);
  } catch (err) {
    handleError(res, err);
  }
});

// POST /api/projects/:projectId/issues/:id/comments
router.post('/:id/comments', async (req: Request, res: Response) => {
  try {
    const { projectId, id } = req.params as Record<string, string>;
    const { body, authorId, authorKind, authorRef, mentions } = req.body as {
      body: string;
      authorId?: string;
      authorKind?: 'human' | 'agent' | 'system';
      authorRef?: string | null;
      mentions?: string[];
    };
    const created = await issuesService.addComment(id, {
      body,
      authorId: authorId ?? null,
      authorKind: authorKind ?? 'human',
      authorRef: authorRef ?? null,
      mentions: Array.isArray(mentions) ? mentions : [],
    });
    eventBus.emitCommentEvent('comment.created', projectId, {
      issueId: id,
      comment: created,
    });
    res.status(201).json(created);
  } catch (err) {
    handleError(res, err);
  }
});

// DELETE /api/projects/:projectId/issues/:id/comments/:commentId
router.delete('/:id/comments/:commentId', async (req: Request, res: Response) => {
  try {
    const { projectId, id, commentId } = req.params as Record<string, string>;
    const deleted = await issuesService.deleteComment(id, commentId);
    if (!deleted) {
      res.status(404).json({ error: 'Comment not found' });
      return;
    }
    eventBus.emitCommentEvent('comment.deleted', projectId, {
      issueId: id,
      commentId,
    });
    res.json(deleted);
  } catch (err) {
    handleError(res, err);
  }
});

export default router;
