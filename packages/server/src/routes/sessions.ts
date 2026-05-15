/**
 * routes/sessions.ts — Live multi-agent SquadClient sessions.
 *
 * Mounted at /api/projects/:projectId/sessions (project-scoped); a small
 * non-project-scoped helper for sending messages to an existing session is
 * also exported.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { eq, desc } from 'drizzle-orm';

import { getDb, schema } from '../db/index.js';
import {
  startLiveSession,
  sendPromptToSession,
  endLiveSession,
  isSessionRunning,
  interruptLiveSession,
} from '../sdk/squad-stream.js';
import { eventBus } from '../realtime/event-bus.js';

// /api/projects/:projectId/sessions
export const projectSessionsRouter = Router({ mergeParams: true });

// /api/sessions
export const sessionsRouter = Router();

// ---------------------------------------------------------------------------
// GET /api/projects/:projectId/sessions
// List live sessions for a project, newest first.
// ---------------------------------------------------------------------------
projectSessionsRouter.get('/', async (req: Request, res: Response) => {
  const { projectId } = req.params as Record<string, string>;
  const db = getDb();

  const rows = await db
    .select()
    .from(schema.liveSessions)
    .where(eq(schema.liveSessions.projectId, projectId))
    .orderBy(desc(schema.liveSessions.createdAt))
    .limit(50);

  return res.json(rows.map((r) => ({ ...r, isRunning: isSessionRunning(r.id) })));
});

// ---------------------------------------------------------------------------
// POST /api/projects/:projectId/sessions
// Start a new live session and send the first prompt.
// Body: { agentId?, agentName?, model?, prompt, title? }
// ---------------------------------------------------------------------------
projectSessionsRouter.post('/', async (req: Request, res: Response) => {
  const { projectId } = req.params as Record<string, string>;
  const body = (req.body ?? {}) as {
    agentId?: string;
    agentName?: string;
    model?: string;
    prompt?: string;
    title?: string;
  };

  const prompt = (body.prompt ?? '').trim();
  if (!prompt) {
    return res.status(400).json({ error: 'prompt is required' });
  }

  const db = getDb();
  const [project] = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .limit(1);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  try {
    const result = await startLiveSession({
      projectId,
      agentId: body.agentId ?? null,
      agentName: body.agentName ?? null,
      model: body.model ?? null,
      prompt,
      title: body.title ?? null,
      workspacePath: project.path,
    });
    return res.status(201).json({
      id: result.sessionId,
      sdkSessionId: result.sdkSessionId,
    });
  } catch (err) {
    console.error('[sessions] failed to start live session', err);
    const msg = err instanceof Error ? err.message : 'Failed to start session';
    return res.status(500).json({ error: msg });
  }
});

// ---------------------------------------------------------------------------
// GET /api/projects/:projectId/sessions/:sessionId
// Session row + all events.
// ---------------------------------------------------------------------------
projectSessionsRouter.get('/:sessionId', async (req: Request, res: Response) => {
  const { projectId, sessionId } = req.params as Record<string, string>;
  const db = getDb();

  const [session] = await db
    .select()
    .from(schema.liveSessions)
    .where(eq(schema.liveSessions.id, sessionId))
    .limit(1);

  if (!session || session.projectId !== projectId) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const events = await db
    .select()
    .from(schema.liveSessionEvents)
    .where(eq(schema.liveSessionEvents.sessionId, sessionId))
    .orderBy(schema.liveSessionEvents.createdAt);

  return res.json({
    ...session,
    isRunning: isSessionRunning(sessionId),
    events,
  });
});

// ---------------------------------------------------------------------------
// POST /api/projects/:projectId/sessions/:sessionId/messages
// Send another prompt to an in-flight session.
// Body: { prompt }
// ---------------------------------------------------------------------------
projectSessionsRouter.post('/:sessionId/messages', async (req: Request, res: Response) => {
  const { sessionId } = req.params as Record<string, string>;
  const prompt = ((req.body ?? {}).prompt ?? '').toString().trim();
  if (!prompt) return res.status(400).json({ error: 'prompt is required' });

  try {
    await sendPromptToSession(sessionId, prompt);
    return res.status(202).json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to send prompt';
    return res.status(409).json({ error: msg });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/projects/:projectId/sessions/:sessionId
// End/cancel a session and clean up the SDK client.
// ---------------------------------------------------------------------------
projectSessionsRouter.delete('/:sessionId', async (req: Request, res: Response) => {
  const { sessionId } = req.params as Record<string, string>;
  await endLiveSession(sessionId, 'cancelled');
  return res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// POST /api/projects/:projectId/sessions/:sessionId/inject — Phase 9
// Inject a user-turn message into a live session. Same semantics as
// /messages but emits a `session.steered` event so the UI can render
// the entry as a steering action (e.g. mid-turn injection from a
// @mention comment).
// Body: { prompt, actor?: { kind: 'human' | 'agent', ref?: string } }
// ---------------------------------------------------------------------------
projectSessionsRouter.post('/:sessionId/inject', async (req: Request, res: Response) => {
  const { projectId, sessionId } = req.params as Record<string, string>;
  const body = (req.body ?? {}) as {
    prompt?: string;
    actor?: { kind?: string; ref?: string };
  };
  const prompt = (body.prompt ?? '').toString().trim();
  if (!prompt) return res.status(400).json({ error: 'prompt is required' });

  try {
    await sendPromptToSession(sessionId, prompt);
    eventBus.emitSessionEvent('session.steered', projectId, {
      sessionId,
      action: 'inject',
      actor: body.actor ?? { kind: 'human' },
      prompt,
    });
    return res.status(202).json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to inject prompt';
    return res.status(409).json({ error: msg });
  }
});

// ---------------------------------------------------------------------------
// POST /api/projects/:projectId/sessions/:sessionId/interrupt — Phase 9
// Best-effort cancel of the in-flight turn; session stays alive.
// Returns { honoured } indicating whether the SDK actually accepted abort.
// ---------------------------------------------------------------------------
projectSessionsRouter.post('/:sessionId/interrupt', async (req: Request, res: Response) => {
  const { projectId, sessionId } = req.params as Record<string, string>;
  try {
    const honoured = await interruptLiveSession(sessionId);
    eventBus.emitSessionEvent('session.steered', projectId, {
      sessionId,
      action: 'interrupt',
      honoured,
    });
    return res.json({ ok: true, honoured });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to interrupt session';
    return res.status(409).json({ error: msg });
  }
});

// ---------------------------------------------------------------------------
// POST /api/projects/:projectId/sessions/:sessionId/handoff — Phase 9 (v1 stub)
// Records a handoff intent on the bus; v1 does not yet re-bind the SDK
// session to a new agent (would require closing + restarting with prior
// transcript replayed as context). UI can show "handoff scheduled, please
// end this session and start a fresh one with @{toAgentId}".
// Body: { toAgentId, reason? }
// ---------------------------------------------------------------------------
projectSessionsRouter.post('/:sessionId/handoff', async (req: Request, res: Response) => {
  const { projectId, sessionId } = req.params as Record<string, string>;
  const body = (req.body ?? {}) as { toAgentId?: string; reason?: string };
  const toAgentId = (body.toAgentId ?? '').toString().trim();
  if (!toAgentId) return res.status(400).json({ error: 'toAgentId is required' });

  if (!isSessionRunning(sessionId)) {
    return res.status(404).json({ error: 'Session not running' });
  }

  eventBus.emitSessionEvent('session.steered', projectId, {
    sessionId,
    action: 'handoff',
    toAgentId,
    reason: body.reason ?? null,
    note: 'v1: handoff intent recorded; SDK rebind pending',
  });
  return res.status(202).json({ ok: true, deferred: true });
});

// ---------------------------------------------------------------------------
// POST /api/projects/:projectId/sessions/:sessionId/invite — Phase 9 (v1 stub)
// Records an invite intent for a second participant; v1 does not yet
// instantiate a SquadCoordinator-backed multi-agent session. UI can show
// "invitation pending, multi-agent join is a future capability".
// Body: { agentId }
// ---------------------------------------------------------------------------
projectSessionsRouter.post('/:sessionId/invite', async (req: Request, res: Response) => {
  const { projectId, sessionId } = req.params as Record<string, string>;
  const body = (req.body ?? {}) as { agentId?: string };
  const agentId = (body.agentId ?? '').toString().trim();
  if (!agentId) return res.status(400).json({ error: 'agentId is required' });

  if (!isSessionRunning(sessionId)) {
    return res.status(404).json({ error: 'Session not running' });
  }

  eventBus.emitSessionEvent('session.steered', projectId, {
    sessionId,
    action: 'invite',
    agentId,
    note: 'v1: invite intent recorded; multi-agent join pending',
  });
  return res.status(202).json({ ok: true, deferred: true });
});
