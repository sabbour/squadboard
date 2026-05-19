/**
 * routes/inbox.ts — Phase 14 quick-capture REST surface.
 *
 *   GET    /api/inbox                 list (filters: ?status, ?projectId, ?userId, ?limit, ?offset)
 *   GET    /api/inbox/:id             single
 *   POST   /api/inbox                 create draft
 *   POST   /api/inbox/:id/formulate   call LLM to fill formulated*
 *   PATCH  /api/inbox/:id             user edits to formulated fields
 *   POST   /api/inbox/:id/publish     create issue, status=published
 *   POST   /api/inbox/:id/claim       Wave 12 N2 — acquire/extend a 5-min claim lease
 *   DELETE /api/inbox/:id             status=discarded (soft delete)
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import * as inboxService from '../services/inbox.js';
import type { InboxStatus } from '../services/inbox.js';
import * as directiveCaptureService from '../services/directive-capture.js';
import type { DirectiveCapturePhase } from '../services/directive-capture.js';
import type { ColumnStatus } from '../services/issues.js';
import { getDb } from '../db/index.js';
import { inboxItems } from '../db/schema.js';
import { eq, and, or, isNull, lt } from 'drizzle-orm';

const router = Router();

function handleError(res: Response, err: unknown) {
  const status = (err as { status?: unknown })?.status;
  const llmRaw = (err as { llmRaw?: unknown })?.llmRaw;
  if (err instanceof Error && typeof status === 'number') {
    const body: Record<string, unknown> = { error: err.message };
    if (typeof llmRaw === 'string') body.llmRaw = llmRaw;
    res.status(status).json(body);
    return;
  }
  console.error('[inbox] unhandled error:', err);
  res.status(500).json({
    error: err instanceof Error ? err.message : 'Internal server error',
  });
}

// GET /api/inbox
router.get('/', async (req: Request, res: Response) => {
  try {
    const { status, projectId, userId, limit, offset } = req.query as Record<string, string | undefined>;
    const rows = await inboxService.listInboxItems({
      status: status as InboxStatus | undefined,
      projectId: projectId || undefined,
      userId: userId || undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
    res.json(rows);
  } catch (err) {
    handleError(res, err);
  }
});

// GET /api/inbox/:id
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const row = await inboxService.getInboxItem(id);
    if (!row) {
      res.status(404).json({ error: 'inbox item not found' });
      return;
    }
    res.json(row);
  } catch (err) {
    handleError(res, err);
  }
});

// POST /api/inbox
router.post('/', async (req: Request, res: Response) => {
  try {
    const { originalDraft, suggestedProjectId, userId, idempotencyKey: bodyKey } = req.body as {
      originalDraft?: string;
      suggestedProjectId?: string | null;
      userId?: string | null;
      idempotencyKey?: string;
    };
    // Accept key from header (canonical) or body field (convenience).
    const idempotencyKey =
      (req.headers['idempotency-key'] as string | undefined) ?? bodyKey ?? undefined;

    if (!originalDraft || typeof originalDraft !== 'string') {
      res.status(400).json({ error: '`originalDraft` is required' });
      return;
    }
    const { item, created } = await inboxService.createInboxItem({
      originalDraft,
      suggestedProjectId: suggestedProjectId ?? null,
      userId: userId ?? null,
      idempotencyKey: idempotencyKey ?? null,
    });
    res.status(created ? 201 : 200).json(item);
  } catch (err) {
    handleError(res, err);
  }
});

// POST /api/inbox/directive-captures
// Capture a Copilot directive to .squad/decisions/inbox, ensure a DB inbox row,
// and best-effort call MCP capture (fail-open with audit in the response).
router.post('/directive-captures', async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as {
      projectId?: string;
      directive?: string;
      sourceType?: string | null;
      sourceId?: string | null;
      phase?: DirectiveCapturePhase | null;
      title?: string | null;
      createdBy?: string | null;
      userName?: string | null;
      callMcp?: boolean;
    };
    if (!body.projectId || typeof body.projectId !== 'string') {
      res.status(400).json({ error: '`projectId` is required' });
      return;
    }
    if (!body.directive || typeof body.directive !== 'string') {
      res.status(400).json({ error: '`directive` is required' });
      return;
    }
    if (body.phase && body.phase !== 'intake' && body.phase !== 'closeout') {
      res.status(400).json({ error: '`phase` must be intake or closeout' });
      return;
    }

    const result = await directiveCaptureService.captureDirective({
      projectId: body.projectId,
      directive: body.directive,
      sourceType: body.sourceType,
      sourceId: body.sourceId,
      phase: body.phase,
      title: body.title,
      createdBy: body.createdBy,
      userName: body.userName,
      callMcp: body.callMcp,
    });
    res.status(result.markdown.status === 'created' || result.inbox.created ? 201 : 200).json(result);
  } catch (err) {
    handleError(res, err);
  }
});

// POST /api/inbox/:id/formulate
router.post('/:id/formulate', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const updated = await inboxService.formulateInboxItem(id);
    res.json(updated);
  } catch (err) {
    handleError(res, err);
  }
});

// PATCH /api/inbox/:id
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const updated = await inboxService.updateInboxItem(id, req.body as inboxService.UpdateInboxInput);
    res.json(updated);
  } catch (err) {
    handleError(res, err);
  }
});

// POST /api/inbox/:id/publish
router.post('/:id/publish', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { projectId, columnSlug } = req.body as { projectId?: string; columnSlug?: ColumnStatus };
    if (!projectId) {
      res.status(400).json({ error: '`projectId` is required' });
      return;
    }
    const result = await inboxService.publishInboxItem(id, {
      projectId,
      columnSlug: (columnSlug ?? 'backlog') as ColumnStatus,
    });
    res.status(201).json(result);
  } catch (err) {
    handleError(res, err);
  }
});

// DELETE /api/inbox/:id  (soft delete → status='discarded')
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const updated = await inboxService.discardInboxItem(id);
    res.json(updated);
  } catch (err) {
    handleError(res, err);
  }
});

// POST /api/inbox/:id/claim
// Wave 12 N2 — Claim/lease a 5-minute TTL on an inbox item.
// Body: { claimedBy: string } — opaque worker/session ID.
// Idempotent for the same claimedBy; extends the lease if already held.
// Returns 409 if claimed by a different worker and lease is still active.
router.post('/:id/claim', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { claimedBy } = req.body as { claimedBy?: string };
    if (!claimedBy || typeof claimedBy !== 'string') {
      res.status(400).json({ error: '`claimedBy` (string) is required' });
      return;
    }

    const db = getDb();
    const LEASE_MS = 5 * 60 * 1000; // 5 minutes
    const claimExpiresAt = new Date(Date.now() + LEASE_MS);
    const now = new Date();

    // Atomic conditional update: win the claim only when:
    //   claimed_by IS NULL                  — unclaimed
    //   OR claim_expires_at < now()         — lease expired
    //   OR claimed_by = :claimedBy          — same worker extending its lease
    const result = await db
      .update(inboxItems)
      .set({ claimedBy, claimExpiresAt, updatedAt: now })
      .where(
        and(
          eq(inboxItems.id, id),
          or(
            isNull(inboxItems.claimedBy),
            lt(inboxItems.claimExpiresAt, now),
            eq(inboxItems.claimedBy, claimedBy),
          ),
        ),
      )
      .returning({ id: inboxItems.id, claimedBy: inboxItems.claimedBy, claimExpiresAt: inboxItems.claimExpiresAt });

    if (result.length === 0) {
      // Either the item doesn't exist or another worker holds a valid lease.
      const current = await db
        .select({ id: inboxItems.id, claimedBy: inboxItems.claimedBy, claimExpiresAt: inboxItems.claimExpiresAt })
        .from(inboxItems)
        .where(eq(inboxItems.id, id))
        .limit(1);
      if (current.length === 0) {
        res.status(404).json({ error: 'inbox item not found' });
        return;
      }
      res.status(409).json({
        error: 'already_claimed',
        claimedBy: current[0].claimedBy,
        claimExpiresAt: current[0].claimExpiresAt,
      });
      return;
    }

    res.json({ ok: true, ...result[0] });
  } catch (err) {
    handleError(res, err);
  }
});

export default router;
