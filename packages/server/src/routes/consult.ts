/**
 * routes/consult.ts — Phase 17 Ask / Consult mode REST surface.
 *
 *   GET    /api/consult                                list (filters: ?projectId, ?status, ?mode, ?global, ?limit)
 *   POST   /api/consult                                create new session (body: { projectId?, mode, agentId?, model?, name? })
 *   GET    /api/consult/:sessionId                     full session detail (messages + proposals)
 *   PATCH  /api/consult/:sessionId                     rename
 *   DELETE /api/consult/:sessionId                     delete (hard delete — consults are scratch)
 *   POST   /api/consult/:sessionId/messages            send a user message — streams assistant turn over WS
 *   POST   /api/consult/:sessionId/end                 mark cancelled/completed without deleting
 *   GET    /api/consult/:sessionId/proposals           list proposals
 *   POST   /api/consult/:sessionId/proposals/:proposalId/accept
 *   POST   /api/consult/:sessionId/proposals/:proposalId/discard
 *   POST   /api/consult/:sessionId/promote             promote whole conversation (body: { kind: 'inbox'|'issue'|'ceremony', projectId?, columnSlug? })
 *
 * Project-scoped alias for convenience (so /projects/:p/consult works in the UI):
 *   GET    /api/projects/:projectId/consult            list filtered to projectId
 *   POST   /api/projects/:projectId/consult            create with projectId injected
 */

import { Router } from 'express';
import type { Request, Response } from 'express';

import * as consultService from '../services/consult.js';
import type {
  ConsultMode,
  ConsultProposalKind,
  ConsultStatus,
} from '../services/consult.js';
import {
  startConsultSession,
  sendConsultMessage,
  endRunningConsult,
  acceptProposal,
  discardProposal,
  promoteConsult,
} from '../sdk/consult-stream.js';

// /api/consult
export const consultRouter = Router();

// /api/projects/:projectId/consult
export const projectConsultRouter = Router({ mergeParams: true });

const VALID_MODES: ReadonlySet<ConsultMode> = new Set<ConsultMode>(['agent', 'model']);
const VALID_PROPOSAL_KINDS: ReadonlySet<ConsultProposalKind> = new Set<ConsultProposalKind>([
  'issue',
  'ceremony',
  'inbox_item',
  'capture_to_decision',
  'assign_agent_to_issue',
]);
const VALID_PROMOTE_KINDS: ReadonlySet<string> = new Set(['inbox', 'issue', 'ceremony']);

function handleError(res: Response, err: unknown) {
  const status = (err as { status?: unknown })?.status;
  if (err instanceof Error && typeof status === 'number') {
    res.status(status).json({ error: err.message });
    return;
  }
  console.error('[consult] unhandled error:', err);
  res.status(500).json({
    error: err instanceof Error ? err.message : 'Internal server error',
  });
}

// ---------------------------------------------------------------------------
// LIST + CREATE (top-level)
// ---------------------------------------------------------------------------

consultRouter.get('/', async (req: Request, res: Response) => {
  try {
    const { projectId, status, mode, global, limit, offset } = req.query as Record<string, string | undefined>;
    const rows = await consultService.listConsultSessions({
      projectId: projectId || undefined,
      status: status as ConsultStatus | undefined,
      mode: mode as ConsultMode | undefined,
      globalOnly: global === '1' || global === 'true',
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
    res.json(rows);
  } catch (err) {
    handleError(res, err);
  }
});

consultRouter.post('/', async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as {
      projectId?: string | null;
      mode?: string;
      agentId?: string | null;
      agentName?: string | null;
      model?: string | null;
      name?: string | null;
      forkedFromSessionId?: string | null;
    };
    const mode = (body.mode ?? 'agent') as ConsultMode;
    if (!VALID_MODES.has(mode)) {
      res.status(400).json({ error: '`mode` must be agent or model' });
      return;
    }
    if (mode === 'agent' && !body.agentId && !body.agentName) {
      res.status(400).json({ error: 'agent mode requires `agentId` or `agentName`' });
      return;
    }
    const session = await startConsultSession({
      projectId: body.projectId ?? null,
      mode,
      agentId: body.agentId ?? null,
      agentName: body.agentName ?? null,
      model: body.model ?? null,
      name: body.name ?? null,
      forkedFromSessionId: body.forkedFromSessionId ?? null,
    });
    res.status(201).json(session);
  } catch (err) {
    handleError(res, err);
  }
});

// ---------------------------------------------------------------------------
// PROJECT-SCOPED LIST + CREATE (alias)
// ---------------------------------------------------------------------------

projectConsultRouter.get('/', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params as Record<string, string>;
    const { status, mode, limit, offset } = req.query as Record<string, string | undefined>;
    const rows = await consultService.listConsultSessions({
      projectId,
      status: status as ConsultStatus | undefined,
      mode: mode as ConsultMode | undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
    res.json(rows);
  } catch (err) {
    handleError(res, err);
  }
});

projectConsultRouter.post('/', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params as Record<string, string>;
    const body = (req.body ?? {}) as {
      mode?: string;
      agentId?: string | null;
      agentName?: string | null;
      model?: string | null;
      name?: string | null;
      forkedFromSessionId?: string | null;
    };
    const mode = (body.mode ?? 'agent') as ConsultMode;
    if (!VALID_MODES.has(mode)) {
      res.status(400).json({ error: '`mode` must be agent or model' });
      return;
    }
    if (mode === 'agent' && !body.agentId && !body.agentName) {
      res.status(400).json({ error: 'agent mode requires `agentId` or `agentName`' });
      return;
    }
    const session = await startConsultSession({
      projectId,
      mode,
      agentId: body.agentId ?? null,
      agentName: body.agentName ?? null,
      model: body.model ?? null,
      name: body.name ?? null,
      forkedFromSessionId: body.forkedFromSessionId ?? null,
    });
    res.status(201).json(session);
  } catch (err) {
    handleError(res, err);
  }
});

// ---------------------------------------------------------------------------
// PER-SESSION
// ---------------------------------------------------------------------------

consultRouter.get('/:sessionId', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params as Record<string, string>;
    const detail = await consultService.getConsultSessionDetail(sessionId);
    if (!detail) {
      res.status(404).json({ error: 'Consult session not found' });
      return;
    }
    res.json(detail);
  } catch (err) {
    handleError(res, err);
  }
});

consultRouter.patch('/:sessionId', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params as Record<string, string>;
    const { name } = (req.body ?? {}) as { name?: string };
    if (typeof name !== 'string') {
      res.status(400).json({ error: '`name` is required' });
      return;
    }
    const row = await consultService.renameConsultSession(sessionId, name);
    if (!row) {
      res.status(404).json({ error: 'Consult session not found' });
      return;
    }
    res.json(row);
  } catch (err) {
    handleError(res, err);
  }
});

consultRouter.delete('/:sessionId', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params as Record<string, string>;
    await endRunningConsult(sessionId, 'cancelled');
    await consultService.deleteConsultSession(sessionId);
    res.json({ ok: true });
  } catch (err) {
    handleError(res, err);
  }
});

consultRouter.post('/:sessionId/end', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params as Record<string, string>;
    const { reason } = (req.body ?? {}) as { reason?: 'completed' | 'cancelled' };
    const final: 'completed' | 'cancelled' = reason === 'completed' ? 'completed' : 'cancelled';
    await endRunningConsult(sessionId, final);
    const row = await consultService.endConsultSession(sessionId, final);
    res.json(row ?? { ok: true });
  } catch (err) {
    handleError(res, err);
  }
});

// ---------------------------------------------------------------------------
// MESSAGES — POST sends a user turn and streams the assistant response.
// ---------------------------------------------------------------------------

consultRouter.post('/:sessionId/messages', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params as Record<string, string>;
    const body = (req.body ?? {}) as { content?: string; prompt?: string };
    const content = ((body.content ?? body.prompt) ?? '').trim();
    if (!content) {
      res.status(400).json({ error: '`content` is required' });
      return;
    }
    await sendConsultMessage(sessionId, content);
    res.status(202).json({ ok: true });
  } catch (err) {
    handleError(res, err);
  }
});

// ---------------------------------------------------------------------------
// PROPOSALS
// ---------------------------------------------------------------------------

consultRouter.get('/:sessionId/proposals', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params as Record<string, string>;
    const rows = await consultService.listProposals(sessionId);
    res.json(rows);
  } catch (err) {
    handleError(res, err);
  }
});

consultRouter.post('/:sessionId/proposals/:proposalId/accept', async (req: Request, res: Response) => {
  try {
    const { sessionId, proposalId } = req.params as Record<string, string>;
    const body = (req.body ?? {}) as { editedPayload?: Record<string, unknown> };
    const result = await acceptProposal({
      sessionId,
      proposalId,
      editedPayload: body.editedPayload ?? null,
    });
    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
});

consultRouter.post('/:sessionId/proposals/:proposalId/discard', async (req: Request, res: Response) => {
  try {
    const { proposalId } = req.params as Record<string, string>;
    const row = await discardProposal(proposalId);
    if (!row) {
      res.status(404).json({ error: 'Proposal not found' });
      return;
    }
    res.json(row);
  } catch (err) {
    handleError(res, err);
  }
});

// ---------------------------------------------------------------------------
// PROMOTE — turn the whole conversation into an inbox item / issue / ceremony.
// ---------------------------------------------------------------------------

consultRouter.post('/:sessionId/promote', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params as Record<string, string>;
    const body = (req.body ?? {}) as {
      kind?: string;
      projectId?: string;
      columnSlug?: string;
    };
    const kind = (body.kind ?? '').toLowerCase();
    if (!VALID_PROMOTE_KINDS.has(kind)) {
      res.status(400).json({ error: `\`kind\` must be one of: ${[...VALID_PROMOTE_KINDS].join(', ')}` });
      return;
    }
    if ((kind === 'issue' || kind === 'ceremony') && !body.projectId) {
      res.status(400).json({ error: '`projectId` is required for issue/ceremony promotion' });
      return;
    }
    const result = await promoteConsult({
      sessionId,
      kind: kind as 'inbox' | 'issue' | 'ceremony',
      projectId: body.projectId ?? null,
      columnSlug: body.columnSlug ?? null,
    });
    res.status(201).json(result);
  } catch (err) {
    handleError(res, err);
  }
});

// Re-export helper so the runtime import wiring is testable from outside.
export { VALID_MODES, VALID_PROPOSAL_KINDS, VALID_PROMOTE_KINDS };
