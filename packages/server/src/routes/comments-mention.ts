/**
 * routes/comments-mention.ts — Phase 9.
 *
 * `@mention` is the steering primitive for issue threads. When a comment
 * mentions one or more agents, the client posts to this endpoint AFTER the
 * comment is created; we decide per-mentioned-agent whether to:
 *
 *   inject — there's an active live session in this project bound to
 *            that agent. Send the comment body as a user-turn into it.
 *
 *   spawn  — no active session for that agent. Start a fresh live session
 *            with the agent's charter and seed the first prompt with the
 *            comment body plus a small "context: issue {title}" preamble.
 *
 * Decision is per-agent, so a comment mentioning two agents may inject
 * one and spawn the other. The route returns an array describing what
 * happened for each mention, plus the resulting sessionId.
 *
 * Lookup: we match by **agent** within the project + status='active'. v1
 * does NOT bind sessions to issues, so two issues both mentioning the
 * same agent will share the running session — the comment body itself
 * carries the issue context (via the spawn-prompt preamble or, for
 * inject, the user can include `[issue: ...]` style hints).
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { and, eq, inArray } from 'drizzle-orm';

import { getDb, schema } from '../db/index.js';
import {
  startLiveSession,
  sendPromptToSession,
} from '../sdk/squad-stream.js';
import { eventBus } from '../realtime/event-bus.js';

export const commentsMentionRouter = Router({ mergeParams: true });

interface MentionResult {
  /** Resolved agent (id + name) or just the raw mention if unresolved. */
  mention: string;
  agentId: string | null;
  agentName: string | null;
  /** What we did: 'inject' (existing session) | 'spawn' (new session) | 'skipped' (agent missing) | 'error'. */
  action: 'inject' | 'spawn' | 'skipped' | 'error';
  sessionId: string | null;
  reason?: string;
}

// POST /api/projects/:projectId/issues/:id/mention
// Body: { commentId, body, mentions: string[] }
//
// `mentions` is the list of mention tokens from the comment composer
// (typically agent names — the route resolves them). `body` is the
// comment body to inject/seed.
commentsMentionRouter.post(
  '/:id/mention',
  async (req: Request, res: Response) => {
    const { projectId, id: issueId } = req.params as Record<string, string>;
    const body = (req.body ?? {}) as {
      commentId?: string;
      body?: string;
      mentions?: string[];
    };

    const text = (body.body ?? '').toString().trim();
    if (!text) return res.status(400).json({ error: '`body` is required' });
    const mentions = Array.isArray(body.mentions)
      ? body.mentions.map((m) => String(m).trim()).filter(Boolean)
      : [];
    if (mentions.length === 0) {
      return res.status(400).json({ error: '`mentions` must be non-empty' });
    }

    const db = getDb();

    // Pull issue + project context (for spawn-prompt preamble + workspace path).
    const [issue] = await db
      .select({
        id: schema.issues.id,
        title: schema.issues.title,
        bodyText: schema.issues.body,
      })
      .from(schema.issues)
      .where(eq(schema.issues.id, issueId))
      .limit(1);
    if (!issue) return res.status(404).json({ error: 'Issue not found' });

    const [project] = await db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, projectId))
      .limit(1);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    // Resolve each mention to an agent row in this project.
    const agentRows = await db
      .select()
      .from(schema.agents)
      .where(
        and(
          eq(schema.agents.projectId, projectId),
          inArray(schema.agents.name, mentions),
        ),
      );
    const agentByName = new Map(agentRows.map((a) => [a.name, a]));

    // Pull active live sessions in this project once; per-agent lookup below.
    const activeSessions = await db
      .select()
      .from(schema.liveSessions)
      .where(
        and(
          eq(schema.liveSessions.projectId, projectId),
          eq(schema.liveSessions.status, 'active'),
        ),
      );
    const sessionsByAgentId = new Map<string, (typeof activeSessions)[number]>();
    for (const s of activeSessions) {
      if (s.agentId) sessionsByAgentId.set(s.agentId, s);
    }

    const results: MentionResult[] = [];

    for (const mention of mentions) {
      const agent = agentByName.get(mention);
      if (!agent) {
        results.push({
          mention,
          agentId: null,
          agentName: null,
          action: 'skipped',
          sessionId: null,
          reason: `No agent named '${mention}' in this project`,
        });
        continue;
      }

      const live = sessionsByAgentId.get(agent.id);
      if (live) {
        try {
          await sendPromptToSession(live.id, text);
          eventBus.emitSessionEvent('session.steered', projectId, {
            sessionId: live.id,
            action: 'inject',
            actor: { kind: 'mention', issueId, commentId: body.commentId ?? null },
            mention,
            agentId: agent.id,
          });
          results.push({
            mention,
            agentId: agent.id,
            agentName: agent.name,
            action: 'inject',
            sessionId: live.id,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Inject failed';
          results.push({
            mention,
            agentId: agent.id,
            agentName: agent.name,
            action: 'error',
            sessionId: live.id,
            reason: msg,
          });
        }
        continue;
      }

      // Spawn a fresh session for this agent.
      const issueTitle = issue.title ?? '(untitled issue)';
      const preamble =
        `You were mentioned on Squadboard issue "${issueTitle}". ` +
        `Use the message below as your input. If you need more context, ask.\n\n` +
        `--- mention ---\n${text}`;
      try {
        const result = await startLiveSession({
          projectId,
          agentId: agent.id,
          agentName: agent.name,
          model: agent.model ?? null,
          prompt: preamble,
          title: `@${agent.name}: ${issueTitle.slice(0, 60)}`,
          workspacePath: project.path,
        });
        eventBus.emitSessionEvent('session.steered', projectId, {
          sessionId: result.sessionId,
          action: 'spawn',
          actor: { kind: 'mention', issueId, commentId: body.commentId ?? null },
          mention,
          agentId: agent.id,
        });
        results.push({
          mention,
          agentId: agent.id,
          agentName: agent.name,
          action: 'spawn',
          sessionId: result.sessionId,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Spawn failed';
        results.push({
          mention,
          agentId: agent.id,
          agentName: agent.name,
          action: 'error',
          sessionId: null,
          reason: msg,
        });
      }
    }

    return res.status(202).json({ results });
  },
);

export default commentsMentionRouter;
