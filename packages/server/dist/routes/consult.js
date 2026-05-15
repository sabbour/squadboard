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
import * as consultService from '../services/consult.js';
import { startConsultSession, sendConsultMessage, endRunningConsult, acceptProposal, discardProposal, promoteConsult, } from '../sdk/consult-stream.js';
// /api/consult
export const consultRouter = Router();
// /api/projects/:projectId/consult
export const projectConsultRouter = Router({ mergeParams: true });
const VALID_MODES = new Set(['agent', 'model']);
const VALID_PROPOSAL_KINDS = new Set([
    'issue',
    'ceremony',
    'inbox_item',
    'capture_to_decision',
    'assign_agent_to_issue',
]);
const VALID_PROMOTE_KINDS = new Set(['inbox', 'issue', 'ceremony']);
// Wave 10 B8: hard cap on a single consult message (user content) so the
// Consult page cannot crash mid-send when something upstream injects a
// massive prefill — e.g. an issue body concatenated with runs tail.
// 64 KiB matches the largest legitimate paste a human would make and keeps
// well under the Postgres `text` row-overflow boundary.
export const MAX_CONSULT_CONTENT_BYTES = 64 * 1024;
function handleError(res, err) {
    const status = err?.status;
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
consultRouter.get('/', async (req, res) => {
    try {
        const { projectId, status, mode, global, limit, offset } = req.query;
        const rows = await consultService.listConsultSessions({
            projectId: projectId || undefined,
            status: status,
            mode: mode,
            globalOnly: global === '1' || global === 'true',
            limit: limit ? parseInt(limit, 10) : undefined,
            offset: offset ? parseInt(offset, 10) : undefined,
        });
        res.json(rows);
    }
    catch (err) {
        handleError(res, err);
    }
});
consultRouter.post('/', async (req, res) => {
    try {
        const body = (req.body ?? {});
        const mode = (body.mode ?? 'agent');
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
    }
    catch (err) {
        handleError(res, err);
    }
});
// ---------------------------------------------------------------------------
// PROJECT-SCOPED LIST + CREATE (alias)
// ---------------------------------------------------------------------------
projectConsultRouter.get('/', async (req, res) => {
    try {
        const { projectId } = req.params;
        const { status, mode, limit, offset } = req.query;
        const rows = await consultService.listConsultSessions({
            projectId,
            status: status,
            mode: mode,
            limit: limit ? parseInt(limit, 10) : undefined,
            offset: offset ? parseInt(offset, 10) : undefined,
        });
        res.json(rows);
    }
    catch (err) {
        handleError(res, err);
    }
});
projectConsultRouter.post('/', async (req, res) => {
    try {
        const { projectId } = req.params;
        const body = (req.body ?? {});
        const mode = (body.mode ?? 'agent');
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
    }
    catch (err) {
        handleError(res, err);
    }
});
// ---------------------------------------------------------------------------
// PER-SESSION
// ---------------------------------------------------------------------------
consultRouter.get('/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const detail = await consultService.getConsultSessionDetail(sessionId);
        if (!detail) {
            res.status(404).json({ error: 'Consult session not found' });
            return;
        }
        res.json(detail);
    }
    catch (err) {
        handleError(res, err);
    }
});
consultRouter.patch('/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const { name } = (req.body ?? {});
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
    }
    catch (err) {
        handleError(res, err);
    }
});
consultRouter.delete('/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;
        await endRunningConsult(sessionId, 'cancelled');
        await consultService.deleteConsultSession(sessionId);
        res.json({ ok: true });
    }
    catch (err) {
        handleError(res, err);
    }
});
consultRouter.post('/:sessionId/end', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const { reason } = (req.body ?? {});
        const final = reason === 'completed' ? 'completed' : 'cancelled';
        await endRunningConsult(sessionId, final);
        const row = await consultService.endConsultSession(sessionId, final);
        res.json(row ?? { ok: true });
    }
    catch (err) {
        handleError(res, err);
    }
});
// ---------------------------------------------------------------------------
// MESSAGES — POST sends a user turn and streams the assistant response.
// ---------------------------------------------------------------------------
consultRouter.post('/:sessionId/messages', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const body = (req.body ?? {});
        const raw = (body.content ?? body.prompt) ?? '';
        if (typeof raw !== 'string') {
            res.status(400).json({ error: '`content` must be a string' });
            return;
        }
        // Wave 10 B8: cap message size so a runaway prefill (e.g. issue body +
        // recent runs tail) can never wedge the assistant turn or blow up the
        // Postgres `text` column at insert time.  64 KiB is well above any
        // legitimate single user message but small enough that a 400 is obvious.
        if (raw.length > MAX_CONSULT_CONTENT_BYTES) {
            res.status(400).json({
                error: `message content exceeds ${MAX_CONSULT_CONTENT_BYTES} characters (got ${raw.length})`,
            });
            return;
        }
        const content = raw.trim();
        if (!content) {
            res.status(400).json({ error: '`content` is required' });
            return;
        }
        await sendConsultMessage(sessionId, content);
        res.status(202).json({ ok: true });
    }
    catch (err) {
        handleError(res, err);
    }
});
// ---------------------------------------------------------------------------
// PROPOSALS
// ---------------------------------------------------------------------------
consultRouter.get('/:sessionId/proposals', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const rows = await consultService.listProposals(sessionId);
        res.json(rows);
    }
    catch (err) {
        handleError(res, err);
    }
});
consultRouter.post('/:sessionId/proposals/:proposalId/accept', async (req, res) => {
    try {
        const { sessionId, proposalId } = req.params;
        const body = (req.body ?? {});
        const result = await acceptProposal({
            sessionId,
            proposalId,
            editedPayload: body.editedPayload ?? null,
        });
        res.json(result);
    }
    catch (err) {
        handleError(res, err);
    }
});
consultRouter.post('/:sessionId/proposals/:proposalId/discard', async (req, res) => {
    try {
        const { proposalId } = req.params;
        const row = await discardProposal(proposalId);
        if (!row) {
            res.status(404).json({ error: 'Proposal not found' });
            return;
        }
        res.json(row);
    }
    catch (err) {
        handleError(res, err);
    }
});
// ---------------------------------------------------------------------------
// PROMOTE — turn the whole conversation into an inbox item / issue / ceremony.
// ---------------------------------------------------------------------------
consultRouter.post('/:sessionId/promote', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const body = (req.body ?? {});
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
            kind: kind,
            projectId: body.projectId ?? null,
            columnSlug: body.columnSlug ?? null,
            rawTranscript: body.rawTranscript === true,
        });
        res.status(201).json(result);
    }
    catch (err) {
        handleError(res, err);
    }
});
// Re-export helper so the runtime import wiring is testable from outside.
export { VALID_MODES, VALID_PROPOSAL_KINDS, VALID_PROMOTE_KINDS };
//# sourceMappingURL=consult.js.map