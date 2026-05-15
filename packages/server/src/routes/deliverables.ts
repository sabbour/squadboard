/**
 * routes/deliverables.ts — Phase 9.
 *
 * REST surface for first-class deliverables. Mounted as
 *   /api/projects/:projectId/deliverables
 * and (issue-scoped helpers) as
 *   /api/projects/:projectId/issues/:id/deliverables
 *
 * Endpoints:
 *   GET    /                          — list deliverables for a project
 *                                       (filter ?issueId=… common path).
 *   GET    /:id                       — single deliverable + reviews.
 *   POST   /                          — create a deliverable manually.
 *   POST   /:id/review                — record approve|request_changes|
 *                                       comment|dismiss for a deliverable.
 *                                       request_changes optionally spawns
 *                                       a follow-up agent_run (revision)
 *                                       and marks this deliverable
 *                                       superseded once the run completes.
 *   POST   /:id/peer-review           — kick off a peer_review issue_run
 *                                       on this deliverable's payload.
 *
 * (Issue-scoped, mounted on the issues router):
 *   GET    /issues/:id/deliverables   — list deliverables for one issue.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { and, eq, desc } from 'drizzle-orm';

import { getDb, schema } from '../db/index.js';
import * as deliverablesService from '../services/deliverables.js';
import {
  appendSystemComment,
} from '../services/issues.js';
import { eventBus } from '../realtime/event-bus.js';
import { resolveRouteFull } from '../engine/router.js';

export const projectDeliverablesRouter = Router({ mergeParams: true });
export const issueDeliverablesRouter = Router({ mergeParams: true });

function handleError(res: Response, err: unknown) {
  const status = (err as { status?: unknown })?.status;
  if (err instanceof Error && typeof status === 'number') {
    res.status(status).json({ error: err.message });
    return;
  }
  console.error('[deliverables] unhandled error:', err);
  res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' });
}

// ---------------------------------------------------------------------------
// GET /api/projects/:projectId/issues/:id/deliverables
// ---------------------------------------------------------------------------
issueDeliverablesRouter.get('/:id/deliverables', async (req, res) => {
  try {
    const { id } = req.params as Record<string, string>;
    const rows = await deliverablesService.listDeliverablesForIssue(id);
    res.json(rows);
  } catch (err) {
    handleError(res, err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/projects/:projectId/deliverables?issueId=…
// ---------------------------------------------------------------------------
projectDeliverablesRouter.get('/', async (req, res) => {
  try {
    const { projectId } = req.params as Record<string, string>;
    const issueId = (req.query.issueId as string | undefined)?.trim();
    const db = getDb();
    if (issueId) {
      // Validate ownership.
      const [issue] = await db
        .select({ projectId: schema.issues.projectId })
        .from(schema.issues)
        .where(eq(schema.issues.id, issueId))
        .limit(1);
      if (!issue || issue.projectId !== projectId) {
        return res.status(404).json({ error: 'Issue not found in this project' });
      }
      const rows = await deliverablesService.listDeliverablesForIssue(issueId);
      return res.json(rows);
    }
    const rows = await db
      .select({
        deliverable: schema.deliverables,
      })
      .from(schema.deliverables)
      .innerJoin(schema.issues, eq(schema.issues.id, schema.deliverables.issueId))
      .where(eq(schema.issues.projectId, projectId))
      .orderBy(desc(schema.deliverables.producedAt))
      .limit(200);
    return res.json(rows.map((r) => r.deliverable));
  } catch (err) {
    handleError(res, err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/projects/:projectId/deliverables/:id
// ---------------------------------------------------------------------------
projectDeliverablesRouter.get('/:id', async (req, res) => {
  try {
    const { id } = req.params as Record<string, string>;
    const deliverable = await deliverablesService.getDeliverable(id);
    if (!deliverable) return res.status(404).json({ error: 'Deliverable not found' });
    const reviews = await deliverablesService.listDeliverableReviews(id);
    return res.json({ ...deliverable, reviews });
  } catch (err) {
    handleError(res, err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/projects/:projectId/deliverables
// Body: { issueId, kind, title, summary?, payload, runId?, stepRunId? }
// ---------------------------------------------------------------------------
projectDeliverablesRouter.post('/', async (req, res) => {
  try {
    const { projectId } = req.params as Record<string, string>;
    const body = (req.body ?? {}) as {
      issueId?: string;
      kind?: deliverablesService.DeliverableKind;
      title?: string;
      summary?: string;
      payload?: deliverablesService.DeliverablePayload;
      runId?: string;
      stepRunId?: string;
    };

    if (!body.issueId) return res.status(400).json({ error: 'issueId is required' });
    if (!body.kind) return res.status(400).json({ error: 'kind is required' });
    if (!body.title) return res.status(400).json({ error: 'title is required' });
    if (!body.payload) return res.status(400).json({ error: 'payload is required' });

    const db = getDb();
    const [issue] = await db
      .select({ projectId: schema.issues.projectId })
      .from(schema.issues)
      .where(eq(schema.issues.id, body.issueId))
      .limit(1);
    if (!issue || issue.projectId !== projectId) {
      return res.status(404).json({ error: 'Issue not found in this project' });
    }

    const created = await deliverablesService.createDeliverable({
      issueId: body.issueId,
      kind: body.kind,
      title: body.title,
      summary: body.summary ?? null,
      payload: body.payload,
      runId: body.runId ?? null,
      stepRunId: body.stepRunId ?? null,
    });
    eventBus.emitDeliverableEvent('deliverable.created', projectId, {
      issueId: body.issueId,
      deliverable: created,
    });
    await appendSystemComment({
      issueId: body.issueId,
      eventKind: 'deliverable.submitted',
      summary: `Deliverable submitted: ${created.title}`,
      eventPayload: {
        deliverableId: created.id,
        kind: created.kind,
        runId: created.runId,
        stepRunId: created.stepRunId,
      },
    }).catch((e) => console.warn('[deliverables] system-comment failed:', e));
    return res.status(201).json(created);
  } catch (err) {
    handleError(res, err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/projects/:projectId/deliverables/:id/review
// Body: { verb, body?, reviewerName?, reviewerAgentId?, suggestions?,
//         spawnRevision?: { agentId? } }
// On request_changes the caller may opt to spawn a revision agent_run.
// ---------------------------------------------------------------------------
projectDeliverablesRouter.post('/:id/review', async (req, res) => {
  try {
    const { projectId, id } = req.params as Record<string, string>;
    const body = (req.body ?? {}) as {
      verb?: deliverablesService.ReviewVerb;
      body?: string;
      reviewerName?: string;
      reviewerAgentId?: string;
      suggestions?: unknown;
      spawnRevision?: { agentId?: string };
    };
    if (!body.verb) return res.status(400).json({ error: 'verb is required' });

    const deliverable = await deliverablesService.getDeliverable(id);
    if (!deliverable) return res.status(404).json({ error: 'Deliverable not found' });

    const event = await deliverablesService.recordDeliverableReview({
      deliverableId: id,
      verb: body.verb,
      body: body.body ?? null,
      reviewerName: body.reviewerName ?? null,
      reviewerAgentId: body.reviewerAgentId ?? null,
      suggestions: body.suggestions,
    });

    // Update deliverable status.
    let newStatus: deliverablesService.DeliverableStatus | null = null;
    if (body.verb === 'approve') newStatus = 'approved';
    if (body.verb === 'request_changes') newStatus = 'changes_requested';
    if (newStatus) await deliverablesService.setDeliverableStatus(id, newStatus);

    // Emit + system comment.
    eventBus.emitDeliverableEvent('deliverable.reviewed', projectId, {
      issueId: deliverable.issueId,
      deliverableId: id,
      verb: body.verb,
      reviewerName: body.reviewerName ?? null,
      newStatus,
    });
    await appendSystemComment({
      issueId: deliverable.issueId,
      eventKind:
        body.verb === 'approve'
          ? 'deliverable.approved'
          : body.verb === 'request_changes'
            ? 'deliverable.changes_requested'
            : `deliverable.${body.verb}`,
      summary:
        body.verb === 'approve'
          ? `Deliverable approved: ${deliverable.title}`
          : body.verb === 'request_changes'
            ? `Changes requested on deliverable: ${deliverable.title}`
            : `Comment on deliverable: ${deliverable.title}`,
      eventPayload: {
        deliverableId: id,
        verb: body.verb,
        reviewerName: body.reviewerName ?? null,
        body: body.body ?? null,
      },
    }).catch((e) => console.warn('[deliverables] system-comment failed:', e));

    // Optional revision spawn on request_changes.
    let spawnedRunId: string | null = null;
    if (body.verb === 'request_changes' && body.spawnRevision) {
      try {
        spawnedRunId = await spawnRevisionRun(
          projectId,
          deliverable,
          body.spawnRevision.agentId ?? null,
          body.body ?? null,
        );
      } catch (err) {
        console.warn('[deliverables] revision spawn failed:', err);
      }
    }

    return res.status(201).json({ event, newStatus, spawnedRunId });
  } catch (err) {
    handleError(res, err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/projects/:projectId/deliverables/:id/peer-review
// Body: { agentId? } — omit to let the router pick an agent.
// Spawns a peer_review issue_run with the deliverable payload as input.
// ---------------------------------------------------------------------------
projectDeliverablesRouter.post('/:id/peer-review', async (req, res) => {
  try {
    const { projectId, id } = req.params as Record<string, string>;
    const body = (req.body ?? {}) as { agentId?: string };

    const deliverable = await deliverablesService.getDeliverable(id);
    if (!deliverable) return res.status(404).json({ error: 'Deliverable not found' });

    const db = getDb();
    let agentId = body.agentId?.trim();

    if (!agentId) {
      // Let the router pick an eligible agent (Tier-1/2/3).
      const [issue] = await db
        .select()
        .from(schema.issues)
        .where(eq(schema.issues.id, deliverable.issueId))
        .limit(1);
      if (!issue) return res.status(404).json({ error: 'Issue not found' });
      const decision = await resolveRouteFull(
        projectId,
        { title: issue.title, labels: [], body: issue.body ?? '' },
        issue.id,
      );
      if (!decision || (!decision.agentName && !decision.agentId)) {
        return res
          .status(409)
          .json({ error: 'No agent available — provide an explicit agentId' });
      }
      if (decision.agentId) {
        agentId = decision.agentId;
      } else {
        const agentName = decision.agentName ?? '';
        if (!agentName) {
          return res
            .status(409)
            .json({ error: 'Router returned no agent — provide an explicit agentId' });
        }
        const [resolved] = await db
          .select()
          .from(schema.agents)
          .where(and(eq(schema.agents.projectId, projectId), eq(schema.agents.name, agentName)))
          .limit(1);
        if (!resolved) {
          return res
            .status(409)
            .json({ error: `Router suggested agent '${agentName}' but it doesn't exist` });
        }
        agentId = resolved.id;
      }
    }

    // Verify agent belongs to this project.
    const [agent] = await db
      .select()
      .from(schema.agents)
      .where(and(eq(schema.agents.id, agentId), eq(schema.agents.projectId, projectId)))
      .limit(1);
    if (!agent) return res.status(404).json({ error: 'Agent not found in this project' });

    // Build the input context: a structured slice of the deliverable payload.
    const inputContext =
      `Peer review request for deliverable: ${deliverable.title}\n\n` +
      `Kind: ${deliverable.kind}\n` +
      (deliverable.summary ? `Summary: ${deliverable.summary}\n\n` : '\n') +
      `Payload:\n` +
      '```json\n' +
      JSON.stringify(deliverable.payload, null, 2).slice(0, 6000) +
      '\n```\n\n' +
      `Please respond with one of the verbs (APPROVE / REQUEST_CHANGES / COMMENT) ` +
      `followed by your reasoning. Suggestions are welcome.`;

    const [created] = await db
      .insert(schema.issueRuns)
      .values({
        issueId: deliverable.issueId,
        agentId,
        kind: 'peer_review',
        status: 'pending',
        inputContext,
      })
      .returning();

    eventBus.emitDeliverableEvent('deliverable.reviewed', projectId, {
      issueId: deliverable.issueId,
      deliverableId: id,
      kind: 'peer-review-requested',
      runId: created?.id ?? null,
      agentId,
    });
    await appendSystemComment({
      issueId: deliverable.issueId,
      eventKind: 'deliverable.peer_review_requested',
      summary: `Peer review requested for deliverable '${deliverable.title}' from ${agent.name}`,
      eventPayload: {
        deliverableId: id,
        runId: created?.id ?? null,
        agentId,
      },
    }).catch((e) => console.warn('[deliverables] system-comment failed:', e));

    return res.status(202).json({ runId: created?.id ?? null, agentId });
  } catch (err) {
    handleError(res, err);
  }
});

// ---------------------------------------------------------------------------
// Internal: spawn a revision agent_run from request_changes.
// ---------------------------------------------------------------------------
async function spawnRevisionRun(
  projectId: string,
  deliverable: typeof schema.deliverables.$inferSelect,
  agentId: string | null,
  changeRequestBody: string | null,
): Promise<string> {
  const db = getDb();

  // Pick an agent: caller's choice, or fall back to the deliverable's
  // original producer when known, or route fresh.
  let chosenAgentId = agentId ?? null;
  if (!chosenAgentId && deliverable.runId) {
    const [originalRun] = await db
      .select({ agentId: schema.issueRuns.agentId })
      .from(schema.issueRuns)
      .where(eq(schema.issueRuns.id, deliverable.runId))
      .limit(1);
    chosenAgentId = originalRun?.agentId ?? null;
  }
  if (!chosenAgentId) {
    const [issue] = await db
      .select()
      .from(schema.issues)
      .where(eq(schema.issues.id, deliverable.issueId))
      .limit(1);
    if (!issue) throw new Error('Issue gone');
    const decision = await resolveRouteFull(
      projectId,
      { title: issue.title, labels: [], body: issue.body ?? '' },
      issue.id,
    );
    if (!decision || (!decision.agentId && !decision.agentName)) {
      throw new Error('No agent available for revision');
    }
    if (decision.agentId) {
      chosenAgentId = decision.agentId;
    } else {
      const agentName = decision.agentName ?? '';
      if (!agentName) throw new Error('Router returned no agent for revision');
      const [resolved] = await db
        .select()
        .from(schema.agents)
        .where(and(eq(schema.agents.projectId, projectId), eq(schema.agents.name, agentName)))
        .limit(1);
      if (!resolved) throw new Error(`Router agent '${agentName}' not found`);
      chosenAgentId = resolved.id;
    }
  }

  // Validate agent project scope.
  const [agent] = await db
    .select()
    .from(schema.agents)
    .where(and(eq(schema.agents.id, chosenAgentId), eq(schema.agents.projectId, projectId)))
    .limit(1);
  if (!agent) throw new Error('Agent does not belong to this project');

  const inputContext =
    `Revision requested on deliverable: ${deliverable.title}\n\n` +
    (changeRequestBody ? `Change request:\n${changeRequestBody}\n\n` : '\n') +
    `Previous deliverable payload:\n` +
    '```json\n' +
    JSON.stringify(deliverable.payload, null, 2).slice(0, 6000) +
    '\n```\n\n' +
    `Produce a revised version that addresses the change request.`;

  const [created] = await db
    .insert(schema.issueRuns)
    .values({
      issueId: deliverable.issueId,
      agentId: chosenAgentId,
      kind: 'agent_run',
      status: 'pending',
      inputContext,
    })
    .returning();

  if (!created) throw new Error('Failed to insert revision run');
  return created.id;
}

export default projectDeliverablesRouter;
