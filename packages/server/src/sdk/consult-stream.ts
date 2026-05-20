/**
 * sdk/consult-stream.ts — Phase 17 Ask / Consult mode runtime.
 *
 * Sits between `routes/consult.ts` (HTTP) and `services/consult.ts` (DB).
 * Owns:
 *   - In-process registry of running SquadClient sessions per consult.
 *   - The `runConsultTurn(sessionId, userMessage)` streaming loop that fans
 *     `assistant.message_delta` + `reasoning_delta` events to WS via the
 *     event bus (`emitConsultEvent`).
 *   - The propose-only tool surface in agent mode (registered via the
 *     SDK's permission/tool hooks). Each propose_* call persists to
 *     consult_proposals + emits `consult.proposal_created`.
 *   - Accept / Discard for proposals; Accept dispatches to the
 *     downstream API for the relevant kind.
 *   - "Promote whole conversation" — turn the chat into an inbox item,
 *     a new issue, or a ceremony narrative.
 *
 * Phase 17 build order:
 *   - p17-consult-schema (todo 1): scaffolding + accept/discard for
 *     proposals (proposals can be created manually for testing); send /
 *     promote stubbed.
 *   - p17-consult-streaming (todo 2): real SDK session + streaming.
 *   - p17-propose-tools (todo 3): wire propose_* tools.
 *   - p17-promote-conversation (todo 7): LLM-backed promote.
 */

import { readFile } from 'node:fs/promises';
import { eq } from 'drizzle-orm';

import { getDb, schema } from '../db/index.js';
import { eventBus } from '../realtime/event-bus.js';
import { resolveModel } from './model-defaults.js';
import { estimateAiCreditsFromUsd, estimateCost } from './pricing.js';
import * as consultService from '../services/consult.js';
import { buildCoordinatorContext } from '../services/coordinator-context.js';
import { tryDirectResponse } from './direct-response.js';
import type {
  ConsultMode,
  ConsultProposalKind,
} from '../services/consult.js';
import type { ConsultProposal, ConsultSession } from '../db/schema.js';

// ---------------------------------------------------------------------------
// SDK adapter shapes (kept loose so we don't have to depend on SDK types).
// ---------------------------------------------------------------------------

interface SquadSessionLike {
  readonly sessionId: string;
  sendMessage(opts: { prompt: string }): Promise<void>;
  on(event: string, handler: (event: unknown) => void): void;
  off?(event: string, handler: (event: unknown) => void): void;
  close(): Promise<void>;
  abort?(): Promise<void>;
}

interface SquadClientLike {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  createSession(config: Record<string, unknown>): Promise<SquadSessionLike>;
}

// ---------------------------------------------------------------------------
// Helpers (mirrors squad-stream.ts shape — kept private to avoid coupling)
// ---------------------------------------------------------------------------

function pickString(obj: unknown, ...keys: string[]): string | undefined {
  if (!obj || typeof obj !== 'object') return undefined;
  const o = obj as Record<string, unknown>;
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string') return v;
    if (v && typeof v === 'object') {
      const nested = pickString(v, ...keys);
      if (nested !== undefined) return nested;
    }
  }
  return undefined;
}

function pickNumber(obj: unknown, ...keys: string[]): number | undefined {
  if (!obj || typeof obj !== 'object') return undefined;
  const o = obj as Record<string, unknown>;
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'number') return v;
    if (v && typeof v === 'object') {
      const nested = pickNumber(v, ...keys);
      if (nested !== undefined) return nested;
    }
  }
  return undefined;
}

const MODEL_THINKING_PARTNER_PROMPT = `\
You are a thinking partner. The user wants to brainstorm ideas, work through \
problems, or explore options out loud. Be curious, ask clarifying questions, \
and offer multiple perspectives. Do not produce code, formal documents, or \
take any actions in their system — this is a conversation surface, nothing \
gets created or changed unless they explicitly say so.`;

const AGENT_CONSULT_PROMPT_SUFFIX = `\
\n\n---\nYou are operating in CONSULT MODE inside Squadboard. The user wants \
to brainstorm, ask questions, and explore options. You are NOT working an \
issue, NOT producing deliverables, and NOT advancing any workflow. \
Be conversational and helpful. \
\n\nYou have a small set of *propose-only* tools: propose_issue, \
propose_ceremony, propose_inbox_item, propose_capture_to_decision, \
propose_assign_agent_to_issue. Use these only when the user clearly wants \
to capture an action item — proposals render as inline cards that the \
user can Accept, Edit, or Discard. Never call these tools in the middle \
of a thought; finish your reasoning first.`;

type AgentOrigin = 'project' | 'virtual-copilot' | 'human' | 'model';

function normalizeAgentOrigin(origin: string | null | undefined): AgentOrigin {
  return origin === 'virtual-copilot' || origin === 'human' || origin === 'model'
    ? origin
    : 'project';
}

// ---------------------------------------------------------------------------
// Session registry (for streaming runs in todo 2)
// ---------------------------------------------------------------------------

interface RunningConsult {
  id: string;
  sessionId: string; // SDK session id
  client: SquadClientLike;
  session: SquadSessionLike;
  mode: ConsultMode;
  projectId: string | null;
  model: string | null;
  /** The message currently being streamed (if any), for delta accumulation. */
  pendingAssistant?: { content: string; reasoning: string };
}

const runningConsults = new Map<string, RunningConsult>();

// ---------------------------------------------------------------------------
// LIFECYCLE — start / send / end
// ---------------------------------------------------------------------------

export interface StartConsultInput {
  projectId?: string | null;
  mode: ConsultMode;
  agentId?: string | null;
  agentName?: string | null;
  agentOrigin?: AgentOrigin | string | null;
  model?: string | null;
  name?: string | null;
  forkedFromSessionId?: string | null;
}

/**
 * Persist a new consult session row. The SDK SquadClient is *not* opened
 * here — it's lazily opened on the first `sendConsultMessage` so the page
 * can render an empty conversation immediately.
 */
export async function startConsultSession(input: StartConsultInput): Promise<ConsultSession> {
  // Resolve agent metadata when in agent mode, so we capture the snapshot
  // (agentName, model) even if the agent is later renamed/deleted.
  let agentName = input.agentName ?? null;
  let model = input.model ?? null;
  let resolvedAgentId = input.agentId ?? null;
  let agentOrigin: AgentOrigin = input.mode === 'agent'
    ? normalizeAgentOrigin(input.agentOrigin)
    : 'model';

  if (input.mode === 'agent' && input.agentOrigin === 'personal') {
    throw Object.assign(new Error('Consult supports only project agents and models.'), { status: 400 });
  }
  if (input.mode === 'agent' && resolvedAgentId?.startsWith('personal:')) {
    throw Object.assign(new Error('Consult supports only project agents and models.'), { status: 400 });
  }

  if (input.mode === 'agent' && resolvedAgentId) {
    const db = getDb();
    const [row] = await db
      .select({
        id: schema.agents.id,
        name: schema.agents.name,
        model: schema.agents.model,
        status: schema.agents.status,
        agentKind: schema.agents.agentKind,
      })
      .from(schema.agents)
      .where(eq(schema.agents.id, resolvedAgentId))
      .limit(1);
    if (row) {
      // Wave 10 B9: refuse to create an agent-mode consult against a
      // non-active agent. The picker filters at the UI layer; this is the
      // defense-in-depth check for direct API callers (curl, MCP, tests).
      if (row.status !== 'active') {
        throw Object.assign(
          new Error(`Agent "${row.name}" is ${row.status} — re-enable it before starting a consult.`),
          { status: 422 },
        );
      }
      agentName = agentName ?? row.name;
      model = model ?? row.model;
      agentOrigin = row.agentKind === 'copilot' ? 'virtual-copilot' : 'project';
    } else {
      throw Object.assign(new Error('Agent not found'), { status: 404 });
    }
  }

  const session = await consultService.createConsultSession({
    projectId: input.projectId ?? null,
    mode: input.mode,
    agentId: resolvedAgentId,
    agentName,
    agentOrigin,
    model,
    name: input.name ?? null,
    forkedFromSessionId: input.forkedFromSessionId ?? null,
  });

  // Lifecycle event — clients subscribed to the consult sessionId will pick
  // it up and update their session list.
  eventBus.emitConsultEvent('consult.started', session.id, {
    sessionId: session.id,
    projectId: session.projectId,
    mode: session.mode,
    agentName: session.agentName,
    agentOrigin: session.agentOrigin,
    model: session.model,
  });

  // ── Flow event: consult_session instance started ────────────────────────────
  if (session.projectId && session.agentId) {
    eventBus.emitFlowEvent('flow.instance.started', session.projectId, {
      instanceId: session.id,
      agentId: session.agentId,
      kind: 'consult_session',
    });
  }

  return session;
}

/**
 * Send a user message to a consult session. In todo 2 this opens an SDK
 * session lazily and streams the assistant turn. For todo 1 it just
 * persists the user message and records a system stub so the chat is
 * visible end-to-end without LLM dependency.
 */
export async function sendConsultMessage(sessionId: string, userMessage: string): Promise<void> {
  const session = await consultService.getConsultSession(sessionId);
  if (!session) {
    throw Object.assign(new Error('Consult session not found'), { status: 404 });
  }
  if (session.status === 'completed' || session.status === 'cancelled' || session.status === 'failed') {
    throw Object.assign(new Error(`Session is ${session.status}`), { status: 409 });
  }

  // Persist + broadcast the user turn.
  const userMsg = await consultService.addConsultMessage({
    sessionId,
    role: 'user',
    content: userMessage,
  });
  eventBus.emitConsultEvent('consult.user_message', sessionId, {
    sessionId,
    messageId: userMsg.id,
    content: userMessage,
  });

  // Auto-name the session from the first user message if it's still default.
  if (!session.name) {
    const derived = consultService.deriveConsultName(userMessage);
    await consultService.renameConsultSession(sessionId, derived);
  }

  // ── W28 J5: DirectResponseHandler short-circuit (BEFORE LLM) ─────────────
  // Build coordinator context per-turn (refresh each turn per spec).
  let workspacePath = process.cwd();
  if (session.projectId) {
    try {
      const db = getDb();
      const [proj] = await db
        .select({ path: schema.projects.path })
        .from(schema.projects)
        .where(eq(schema.projects.id, session.projectId))
        .limit(1);
      if (proj?.path) workspacePath = proj.path;
    } catch { /* use cwd */ }
  }

  const coordinatorCtx = await buildCoordinatorContext(sessionId, session.projectId, workspacePath);

  // Emit context summary so the UI panel can render it.
  eventBus.emitConsultEvent('consult.context', sessionId, {
    sessionId,
    sections: coordinatorCtx.sections.map((s) => ({
      name: s.name,
      tokens: s.tokens,
      truncated: s.truncated,
    })),
    totalTokens: coordinatorCtx.totalTokens,
    variableTokens: coordinatorCtx.variableTokens,
    truncationLog: coordinatorCtx.truncationLog,
    redactionCount: coordinatorCtx.redactionCount,
  });

  // Try DirectResponseHandler — short-circuit status/help/config/roster/greeting.
  const directResult = await tryDirectResponse(userMessage, coordinatorCtx.sdkContext);
  if (directResult) {
    const msg = await consultService.addConsultMessage({
      sessionId,
      role: 'assistant',
      content: directResult.response,
    });
    // Stream the direct response in word-sized chunks so the UI renders
    // progressively instead of popping the full message in all at once.
    const words = directResult.response.split(/(?<=\s)|(?=\s)/);
    for (const chunk of words) {
      if (!chunk) continue;
      eventBus.emitConsultEvent('consult.message_delta', sessionId, { sessionId, delta: chunk });
      await new Promise<void>((r) => setTimeout(r, 12));
    }
    eventBus.emitConsultEvent('consult.message_complete', sessionId, {
      sessionId,
      messageId: msg.id,
      content: directResult.response,
      role: 'assistant',
      // Caption surfaced in the UI to distinguish coordinator quick replies.
      coordinatorQuickReply: true,
      category: directResult.category,
      confidence: directResult.confidence,
    });
    return;
  }

  await runConsultTurn(sessionId, userMessage);
}

/**
 * Execute the assistant turn. The default implementation drives a real
 * SquadClient session through `streamAgentTurn()`; if the SDK is
 * unavailable (test / offline mode), it falls back to a stubbed reply
 * so the surface stays usable.
 *
 * Replaceable via {@link setConsultRunner} — the propose-tools layer
 * (todo 3) decorates this with a tool registry.
 */
export async function runConsultTurn(sessionId: string, userMessage: string): Promise<void> {
  await runner(sessionId, userMessage);
}

type ConsultTurnRunner = (sessionId: string, userMessage: string) => Promise<void>;
let runner: ConsultTurnRunner = defaultRunner;

export function setConsultTurnRunner(fn: ConsultTurnRunner): void {
  runner = fn;
}

async function defaultRunner(sessionId: string, userMessage: string): Promise<void> {
  await streamAgentTurn(sessionId, userMessage);
}

/**
 * The actual SDK-backed streaming runner. Lazily opens a SquadClient,
 * keeps it in `runningConsults`, fans deltas to WS, and persists the
 * final assistant message.
 */
async function streamAgentTurn(sessionId: string, userMessage: string): Promise<void> {
  const session = await consultService.getConsultSession(sessionId);
  if (!session) return;

  let running = runningConsults.get(sessionId);
  if (!running) {
    try {
      running = await openSdkConsult(session);
      runningConsults.set(sessionId, running);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to open SDK session';
      console.warn('[consult-stream] openSdkConsult failed:', msg);
      await fallbackStubReply(sessionId, msg);
      return;
    }
  }

  running.pendingAssistant = { content: '', reasoning: '' };

  try {
    await running.session.sendMessage({ prompt: userMessage });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    eventBus.emitConsultEvent('consult.error', sessionId, { sessionId, message: msg });
    await consultService.setSessionStatus(sessionId, 'failed', msg);
  }
}

async function fallbackStubReply(sessionId: string, errorMsg: string): Promise<void> {
  const stubText = `(Consult agent unavailable — ${errorMsg}. The conversation is recorded; restart the server with SDK access to resume streaming replies.)`;
  const msg = await consultService.addConsultMessage({
    sessionId,
    role: 'assistant',
    content: stubText,
  });
  eventBus.emitConsultEvent('consult.message_complete', sessionId, {
    sessionId,
    messageId: msg.id,
    content: stubText,
    role: 'assistant',
  });
}

async function openSdkConsult(session: ConsultSession): Promise<RunningConsult> {
  const db = getDb();

  // Resolve the model.
  let agentModel: string | null = null;
  let charterPath: string | null = null;
  if (session.mode === 'agent' && session.agentId) {
    const [row] = await db
      .select({ model: schema.agents.model, charterPath: schema.agents.charterPath })
      .from(schema.agents)
      .where(eq(schema.agents.id, session.agentId))
      .limit(1);
    agentModel = row?.model ?? null;
    charterPath = row?.charterPath ?? null;
  }
  let projectDefaultModel: string | null = null;
  let workspacePath = process.cwd();
  if (session.projectId) {
    const [proj] = await db
      .select({ defaultModel: schema.projects.defaultModel, path: schema.projects.path })
      .from(schema.projects)
      .where(eq(schema.projects.id, session.projectId))
      .limit(1);
    projectDefaultModel = proj?.defaultModel ?? null;
    workspacePath = proj?.path ?? workspacePath;
  }

  const resolved = resolveModel({
    sessionModel: session.model,
    agentModel,
    projectDefaultModel,
  });

  // Build system prompt.
  let systemPrompt = MODEL_THINKING_PARTNER_PROMPT;
  if (session.mode === 'agent') {
    const charter = charterPath
      ? await readFile(charterPath, 'utf8').catch(() => null)
      : null;
    systemPrompt = (charter ?? `You are ${session.agentName ?? 'an agent'} helping the user.`)
      + AGENT_CONSULT_PROMPT_SUFFIX;
  }

  // ── W28 J5: Prepend coordinator context to system prompt ─────────────────
  // Model mode gets full coordinator context (skip charter per spec).
  // Agent mode prepends the coordinator supplementary block below the charter.
  try {
    const coordinatorCtx = await buildCoordinatorContext(
      session.id,
      session.projectId,
      workspacePath,
    );
    if (session.mode === 'model') {
      // Full coordinator context (squad.agent.md identity + supplementary),
      // replacing the generic thinking-partner prompt.
      systemPrompt = coordinatorCtx.systemPrompt + '\n\n' + MODEL_THINKING_PARTNER_PROMPT;
    } else {
      // Agent mode: prepend meta preamble + supplementary block to existing charter/prompt.
      const metaSection = coordinatorCtx.sections.find((s) => s.name === 'Squadboard Meta Preamble');
      const metaPreamble = metaSection?.content ?? '';
      systemPrompt = metaPreamble + '\n\n---\n\n' + systemPrompt + coordinatorCtx.supplementaryBlock;
    }
  } catch (err) {
    console.warn('[consult-stream] coordinator context build failed:', err instanceof Error ? err.message : String(err));
    // Continue with existing systemPrompt on error.
  }

  const token = process.env.GITHUB_TOKEN ?? process.env.SQUADBOARD_GITHUB_TOKEN;
  const { SquadClient } = await import('@bradygaster/squad-sdk/client');
  const client = new SquadClient({
    ...(token ? { githubToken: token } : { useLoggedInUser: true }),
    cwd: workspacePath,
  }) as unknown as SquadClientLike;

  await client.connect();

  // Phase 17: in agent mode, expose ONLY the propose_* tools — no shell,
  // file edits, or read access. The whole point of consult mode is that
  // the agent recommends actions, not takes them. In model mode, expose
  // no tools at all (raw thinking partner).
  const sessionConfig: Record<string, unknown> = {
    model: resolved.model,
    streaming: true,
    systemMessage: { mode: 'replace', content: systemPrompt },
    workingDirectory: workspacePath,
    onPermissionRequest: () => ({ kind: 'approved' }),
  };
  if (session.mode === 'agent') {
    const proposeTools = buildProposeTools(session.id);
    sessionConfig.tools = proposeTools;
    sessionConfig.availableTools = proposeTools.map((t) => t.name);
  } else {
    sessionConfig.availableTools = [];
  }

  const sdkSession = await client.createSession(sessionConfig);

  await consultService.setSessionSdkId(session.id, sdkSession.sessionId);
  if (resolved.model && resolved.model !== session.model) {
    await consultService.setSessionModel(session.id, resolved.model);
  }

  const running: RunningConsult = {
    id: session.id,
    sessionId: sdkSession.sessionId,
    client,
    session: sdkSession,
    mode: session.mode,
    projectId: session.projectId,
    model: resolved.model,
  };

  attachListeners(running);
  return running;
}

function attachListeners(running: RunningConsult): void {
  const consultId = running.id;
  running.session.on('assistant.message_delta', (e) => {
    const delta = pickString(e, 'delta', 'content', 'text') ?? '';
    if (!delta) return;
    if (running.pendingAssistant) running.pendingAssistant.content += delta;
    eventBus.emitConsultEvent('consult.message_delta', consultId, { sessionId: consultId, delta });
  });
  running.session.on('assistant.reasoning_delta', (e) => {
    const delta = pickString(e, 'delta', 'content', 'text') ?? '';
    if (!delta) return;
    if (running.pendingAssistant) running.pendingAssistant.reasoning += delta;
    eventBus.emitConsultEvent('consult.reasoning_delta', consultId, { sessionId: consultId, delta });
  });
  running.session.on('assistant.message', async (e) => {
    const content = pickString(e, 'content', 'text', 'message')
      ?? running.pendingAssistant?.content
      ?? '';
    const reasoning = running.pendingAssistant?.reasoning ?? null;
    const messageId = pickString(e, 'messageId', 'id');
    const msg = await consultService.addConsultMessage({
      sessionId: consultId,
      role: 'assistant',
      content,
      reasoningContent: reasoning && reasoning.length > 0 ? reasoning : null,
    });
    running.pendingAssistant = undefined;
    eventBus.emitConsultEvent('consult.message_complete', consultId, {
      sessionId: consultId,
      messageId: msg.id,
      sdkMessageId: messageId,
      content,
      reasoningContent: reasoning,
      role: 'assistant',
    });
  });
  running.session.on('assistant.usage', async (e) => {
    const inputTokens = pickNumber(e, 'inputTokens', 'input_tokens', 'promptTokens', 'prompt_tokens') ?? 0;
    const outputTokens = pickNumber(e, 'outputTokens', 'output_tokens', 'completionTokens', 'completion_tokens') ?? 0;
    const model = pickString(e, 'model') ?? running.model ?? null;
    const turnCost = estimateCost(model, inputTokens, outputTokens);
    const aiCredits = estimateAiCreditsFromUsd(turnCost);
    await consultService.recordSessionUsage(consultId, inputTokens, outputTokens, turnCost.toFixed(6), aiCredits);
    eventBus.emitConsultEvent('consult.usage', consultId, {
      sessionId: consultId,
      inputTokens,
      outputTokens,
      model,
      cost: turnCost,
    });
  });
  running.session.on('session.error', (e) => {
    const message = pickString(e, 'message', 'error') ?? 'SDK error';
    eventBus.emitConsultEvent('consult.error', consultId, { sessionId: consultId, message });
  });
}

/**
 * End the running SDK session for a consult (best-effort). Safe to call
 * when no SDK session is open — it just resolves.
 */
export async function endRunningConsult(
  consultId: string,
  reason: 'completed' | 'cancelled' | 'failed' = 'cancelled',
): Promise<void> {
  const running = runningConsults.get(consultId);
  if (!running) return;
  runningConsults.delete(consultId);
  try {
    await running.session.close();
  } catch {
    // ignore
  }
  try {
    await running.client.disconnect();
  } catch {
    // ignore
  }
  eventBus.emitConsultEvent('consult.completed', consultId, { sessionId: consultId, reason });
  // ── Flow event: consult_session instance ended ────────────────────────────
  if (running.projectId) {
    eventBus.emitFlowEvent('flow.instance.ended', running.projectId, {
      instanceId: consultId,
      status: reason === 'completed' ? 'completed' : 'failed',
    });
  }
}

export async function shutdownAllConsults(): Promise<void> {
  const ids = [...runningConsults.keys()];
  await Promise.allSettled(ids.map((id) => endRunningConsult(id, 'cancelled')));
}

// ---------------------------------------------------------------------------
// PROPOSE-ONLY TOOL SURFACE (agent mode)
// ---------------------------------------------------------------------------

interface ConsultTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  handler: (args: unknown, invocation: { sessionId: string; toolCallId: string; toolName: string }) => Promise<string>;
}

/**
 * Build the propose-only tool registry for an agent-mode consult session.
 * Each tool persists a row in `consult_proposals` (status='pending'),
 * emits `consult.proposal_created`, and returns a string telling the
 * agent that the user will see a proposal card to Accept/Edit/Discard.
 *
 * The agent CANNOT take direct actions — only propose them. Acceptance
 * is the human user's privilege and is handled by acceptProposal() above.
 */
function buildProposeTools(consultId: string): ConsultTool[] {
  const handle = async (
    kind: ConsultProposalKind,
    payload: Record<string, unknown>,
    callId: string,
    description: string,
  ): Promise<string> => {
    const proposal = await consultService.createProposal({
      sessionId: consultId,
      messageId: null,
      kind,
      payload,
    });
    eventBus.emitConsultEvent('consult.proposal_created', consultId, {
      sessionId: consultId,
      proposal,
    });
    eventBus.emitConsultEvent('consult.tool_call', consultId, {
      sessionId: consultId,
      toolName: `propose_${kind}`,
      args: payload,
      result: { proposalId: proposal.id, kind },
    });
    void callId;
    return `Proposal created (${description}). The user will see a card with Accept / Edit / Discard buttons. Tell them what you proposed and why; do not assume it has been actioned.`;
  };

  return [
    {
      name: 'propose_issue',
      description:
        'Propose a new issue / card on the project board. Renders as a card the user can Accept, Edit, or Discard. Do not call unless the user clearly wants to capture a unit of work.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short, action-oriented title.' },
          body: { type: 'string', description: 'Markdown body — context, acceptance criteria.' },
          projectId: {
            type: 'string',
            description:
              'Project UUID. Optional in project-scoped consults (defaults to the consult\'s project). Required in cross-project consults.',
          },
          columnSlug: {
            type: 'string',
            enum: ['backlog', 'ready', 'in_progress', 'in_review', 'done'],
            description: 'Target board column. Defaults to backlog.',
          },
        },
        required: ['title'],
      },
      handler: async (args, inv) => {
        const a = (args ?? {}) as Record<string, unknown>;
        return handle('issue', a, inv.toolCallId, `issue: ${String(a.title ?? '')}`);
      },
    },
    {
      name: 'propose_ceremony',
      description:
        'Propose a new narrative ceremony (Markdown). The user will Accept, Edit, or Discard before it lands as a draft for the Ceremonies Review page.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Human-readable ceremony name.' },
          description: { type: 'string', description: 'One-sentence purpose of the ceremony.' },
          narrativeMarkdown: {
            type: 'string',
            description: 'Plain-prose ceremony narrative — agents, steps, gates.',
          },
          projectId: {
            type: 'string',
            description: 'Project UUID. Defaults to the consult\'s project; required in cross-project consults.',
          },
        },
        required: ['name', 'narrativeMarkdown'],
      },
      handler: async (args, inv) => {
        const a = (args ?? {}) as Record<string, unknown>;
        return handle('ceremony', a, inv.toolCallId, `ceremony: ${String(a.name ?? '')}`);
      },
    },
    {
      name: 'propose_inbox_item',
      description:
        'Propose a captured idea / draft for the Inbox — not yet a structured issue. The user will refine and decide what project to file it under.',
      parameters: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'Free-form draft text — the raw idea.' },
          suggestedProjectId: {
            type: 'string',
            description: 'Optional project hint. Leave empty for unrouted capture.',
          },
        },
        required: ['summary'],
      },
      handler: async (args, inv) => {
        const a = (args ?? {}) as Record<string, unknown>;
        const summary = String(a.summary ?? '');
        return handle('inbox_item', a, inv.toolCallId, `inbox: ${summary.slice(0, 60)}`);
      },
    },
    {
      name: 'propose_capture_to_decision',
      description:
        'Propose recording a decision in this project\'s .squad/decisions/inbox/ as a Markdown note (one decision per file). Use for choices the user explicitly wants captured for posterity.',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Short decision title (becomes the heading + filename).' },
          value: { type: 'string', description: 'Body of the decision — what was decided and why.' },
        },
        required: ['key', 'value'],
      },
      handler: async (args, inv) => {
        const a = (args ?? {}) as Record<string, unknown>;
        return handle('capture_to_decision', a, inv.toolCallId, `decision: ${String(a.key ?? '')}`);
      },
    },
    {
      name: 'propose_assign_agent_to_issue',
      description:
        'Propose assigning a specific agent to an existing issue, which on Accept creates a routed run.',
      parameters: {
        type: 'object',
        properties: {
          issueId: { type: 'string', description: 'UUID of the issue to assign.' },
          agentName: { type: 'string', description: 'Name of the agent in this project.' },
          rationale: { type: 'string', description: 'Why this agent? Shown on the proposal card.' },
        },
        required: ['issueId', 'agentName'],
      },
      handler: async (args, inv) => {
        const a = (args ?? {}) as Record<string, unknown>;
        return handle(
          'assign_agent_to_issue',
          a,
          inv.toolCallId,
          `assign ${String(a.agentName ?? '')} → ${String(a.issueId ?? '')}`,
        );
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// PROPOSAL ACCEPT / DISCARD
// ---------------------------------------------------------------------------

export interface AcceptProposalInput {
  sessionId: string;
  proposalId: string;
  editedPayload?: Record<string, unknown> | null;
}

export interface AcceptProposalResult {
  proposal: ConsultProposal;
  artifact?: Record<string, unknown> | null;
}

export async function acceptProposal(input: AcceptProposalInput): Promise<AcceptProposalResult> {
  const proposal = await consultService.getProposal(input.proposalId);
  if (!proposal || proposal.sessionId !== input.sessionId) {
    throw Object.assign(new Error('Proposal not found'), { status: 404 });
  }
  if (proposal.status !== 'pending') {
    throw Object.assign(new Error(`Proposal already ${proposal.status}`), { status: 409 });
  }
  const session = await consultService.getConsultSession(input.sessionId);
  if (!session) {
    throw Object.assign(new Error('Consult session not found'), { status: 404 });
  }
  const effectivePayload =
    input.editedPayload && Object.keys(input.editedPayload).length > 0
      ? { ...(proposal.payload as Record<string, unknown>), ...input.editedPayload }
      : (proposal.payload as Record<string, unknown>);

  const isEdited = Boolean(input.editedPayload && Object.keys(input.editedPayload).length > 0);

  let artifact: Record<string, unknown> | null = null;
  try {
    artifact = await dispatchProposal(proposal.kind as ConsultProposalKind, effectivePayload, session);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const updated = await consultService.updateProposal(input.proposalId, {
      status: 'pending',
      errorMessage: msg,
      ...(isEdited ? { editedPayload: input.editedPayload as Record<string, unknown> } : {}),
    });
    throw Object.assign(new Error(`Failed to accept proposal: ${msg}`), {
      status: 502,
      proposal: updated,
    });
  }

  const updated = await consultService.updateProposal(input.proposalId, {
    status: isEdited ? 'edited' : 'accepted',
    result: artifact ?? undefined,
    errorMessage: null,
    ...(isEdited ? { editedPayload: input.editedPayload as Record<string, unknown> } : {}),
  });

  eventBus.emitConsultEvent('consult.proposal_decided', input.sessionId, {
    sessionId: input.sessionId,
    proposalId: input.proposalId,
    status: updated?.status ?? 'accepted',
    artifact,
  });

  return { proposal: updated ?? proposal, artifact };
}

export async function discardProposal(proposalId: string): Promise<ConsultProposal | null> {
  const proposal = await consultService.getProposal(proposalId);
  if (!proposal) return null;
  const updated = await consultService.updateProposal(proposalId, { status: 'discarded' });
  if (updated) {
    eventBus.emitConsultEvent('consult.proposal_decided', proposal.sessionId, {
      sessionId: proposal.sessionId,
      proposalId,
      status: 'discarded',
      artifact: null,
    });
  }
  return updated;
}

async function dispatchProposal(
  kind: ConsultProposalKind,
  payload: Record<string, unknown>,
  session: ConsultSession,
): Promise<Record<string, unknown> | null> {
  switch (kind) {
    case 'issue':
      return acceptProposeIssue(payload, session);
    case 'inbox_item':
      return acceptProposeInboxItem(payload, session);
    case 'ceremony':
      return acceptProposeCeremony(payload, session);
    case 'capture_to_decision':
      return acceptProposeCaptureDecision(payload, session);
    case 'assign_agent_to_issue':
      return acceptProposeAssignAgent(payload, session);
    default:
      throw new Error(`Unknown proposal kind: ${String(kind)}`);
  }
}

async function acceptProposeIssue(
  payload: Record<string, unknown>,
  session: ConsultSession,
): Promise<Record<string, unknown>> {
  const projectId =
    (typeof payload.projectId === 'string' && payload.projectId) ||
    session.projectId ||
    null;
  if (!projectId) {
    throw new Error('propose_issue requires a projectId (consult is cross-project — pass projectId in editedPayload)');
  }
  const title = typeof payload.title === 'string' ? payload.title.trim() : '';
  if (!title) throw new Error('propose_issue requires a title');
  const body = typeof payload.body === 'string' ? payload.body : '';
  const columnSlug = typeof payload.columnSlug === 'string' ? payload.columnSlug : 'backlog';
  const issuesService = await import('../services/issues.js');
  const createdResult = await issuesService.createIssue({
    projectId,
    title,
    body,
    status: columnSlug as 'backlog' | 'ready' | 'in_progress' | 'in_review' | 'done',
    createdBy: 'user',
  });
  const created = createdResult.issue!;
  return { kind: 'issue', issueId: created.id, projectId, url: `/projects/${projectId}/board` };
}

async function acceptProposeInboxItem(
  payload: Record<string, unknown>,
  session: ConsultSession,
): Promise<Record<string, unknown>> {
  const summary = typeof payload.summary === 'string' ? payload.summary.trim() : '';
  if (!summary) throw new Error('propose_inbox_item requires a summary');
  const suggestedProjectId =
    (typeof payload.suggestedProjectId === 'string' && payload.suggestedProjectId) ||
    session.projectId ||
    null;
  const inboxService = await import('../services/inbox.js');
  const { item } = await inboxService.createInboxItem({
    originalDraft: summary,
    suggestedProjectId,
    userId: null,
  });
  return { kind: 'inbox_item', inboxItemId: item.id, suggestedProjectId };
}

async function acceptProposeCeremony(
  payload: Record<string, unknown>,
  session: ConsultSession,
): Promise<Record<string, unknown>> {
  const projectId =
    (typeof payload.projectId === 'string' && payload.projectId) ||
    session.projectId ||
    null;
  if (!projectId) {
    throw new Error('propose_ceremony requires a projectId (consult is cross-project — pass projectId in editedPayload)');
  }
  const name = typeof payload.name === 'string' ? payload.name.trim() : '';
  const markdown = typeof payload.narrativeMarkdown === 'string'
    ? payload.narrativeMarkdown
    : typeof payload.markdown === 'string' ? payload.markdown : '';
  if (!name && !markdown) {
    throw new Error('propose_ceremony requires `name` and `narrativeMarkdown`');
  }
  // Insert a narrative ceremony directly through the DB (mirrors the
  // /api/ceremonies/import-narrative handler so we don't need an
  // out-of-process HTTP call).
  const db = getDb();
  const slug = slugify(name || 'imported-ceremony');
  const [narrative] = await db
    .insert(schema.workflows)
    .values({
      projectId,
      name: name || 'Imported ceremony',
      slug,
      description: typeof payload.description === 'string' ? payload.description : null,
      triggerKind: 'manual',
      triggerConfig: {},
      kind: 'narrative',
      status: 'draft',
    })
    .returning();
  if (!narrative) throw new Error('Failed to insert narrative ceremony');
  await db.insert(schema.workflowVersions).values({
    workflowId: narrative.id,
    version: 1,
    yamlContent: markdown,
    isActive: true,
  });
  return {
    kind: 'ceremony',
    ceremonyId: narrative.id,
    projectId,
    url: `/projects/${projectId}/ceremonies/review`,
  };
}

async function acceptProposeCaptureDecision(
  payload: Record<string, unknown>,
  session: ConsultSession,
): Promise<Record<string, unknown>> {
  const key = typeof payload.key === 'string' ? payload.key.trim() : '';
  const value = typeof payload.value === 'string' ? payload.value.trim() : '';
  if (!key || !value) throw new Error('propose_capture_to_decision requires `key` and `value`');
  if (!session.projectId) {
    throw new Error('propose_capture_to_decision requires a project-scoped consult');
  }
  const db = getDb();
  const [proj] = await db
    .select({ path: schema.projects.path })
    .from(schema.projects)
    .where(eq(schema.projects.id, session.projectId))
    .limit(1);
  if (!proj?.path) throw new Error('Project squad path not found');
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const inboxDir = path.join(proj.path, 'decisions', 'inbox');
  await fs.mkdir(inboxDir, { recursive: true });
  const slug = slugify(key);
  const file = path.join(inboxDir, `${Date.now()}-${slug}.md`);
  const content = `# ${key}\n\n${value}\n\n---\nCaptured from consult ${session.id} on ${new Date().toISOString()}\n`;
  await fs.writeFile(file, content, 'utf8');
  return { kind: 'capture_to_decision', filePath: file, key };
}

async function acceptProposeAssignAgent(
  payload: Record<string, unknown>,
  session: ConsultSession,
): Promise<Record<string, unknown>> {
  const issueId = typeof payload.issueId === 'string' ? payload.issueId.trim() : '';
  const agentName = typeof payload.agentName === 'string' ? payload.agentName.trim() : '';
  if (!issueId) throw new Error('propose_assign_agent_to_issue requires `issueId`');
  if (!agentName) throw new Error('propose_assign_agent_to_issue requires `agentName`');
  if (!session.projectId) {
    throw new Error('propose_assign_agent_to_issue requires a project-scoped consult');
  }
  const db = getDb();
  const [agent] = await db
    .select({ id: schema.agents.id })
    .from(schema.agents)
    .where(eq(schema.agents.projectId, session.projectId))
    .limit(50)
    .then((rows) => rows.filter((_r) => true)); // placeholder narrowing — full match below

  // Above query returns up to 50 agents; we need the one matching the name.
  // Re-query with a name filter for correctness.
  const matched = await db
    .select({ id: schema.agents.id, name: schema.agents.name })
    .from(schema.agents)
    .where(eq(schema.agents.projectId, session.projectId));
  const found = matched.find((a) => a.name === agentName);
  if (!found) throw new Error(`Agent '${agentName}' not found in this project`);
  void agent;

  const { createRoutedRun } = await import('../engine/router.js');
  const runId = await createRoutedRun(issueId, found.id, `consult:propose_assign:${session.id}`);
  return { kind: 'assign_agent_to_issue', issueId, agentId: found.id, runId };
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'untitled';
}

// ---------------------------------------------------------------------------
// PROMOTE WHOLE CONVERSATION
// ---------------------------------------------------------------------------

export interface PromoteConsultInput {
  sessionId: string;
  kind: 'inbox' | 'issue' | 'ceremony';
  projectId?: string | null;
  columnSlug?: string | null;
  /**
   * Skip LLM extraction and just promote a deterministic transcript dump.
   * Defaults to false. Use as an escape hatch when models are unavailable
   * or when the caller only wants a paper trail.
   */
  rawTranscript?: boolean;
}

export interface PromoteConsultResult {
  kind: PromoteConsultInput['kind'];
  artifact: Record<string, unknown>;
  /** Whether LLM summarisation was applied (false = raw transcript fallback). */
  summarised: boolean;
  /** Model used for summarisation, if any. */
  modelUsed?: string;
}

interface ConsultSummary {
  title: string;
  body: string;
}

interface CeremonySummary extends ConsultSummary {
  description: string;
}

/**
 * Promote a consult conversation to an inbox item, new issue, or ceremony.
 *
 * Calls the formulator (LLM) to extract a clean title + summary from the
 * full transcript. If the LLM is unavailable (no token, no model, parse
 * error, etc.) we fall back to a deterministic transcript dump so the
 * surface degrades gracefully and never blocks the user.
 */
export async function promoteConsult(input: PromoteConsultInput): Promise<PromoteConsultResult> {
  const detail = await consultService.getConsultSessionDetail(input.sessionId);
  if (!detail) throw Object.assign(new Error('Consult session not found'), { status: 404 });

  const transcriptMd = renderTranscript(detail.messages, detail.name ?? 'Consult conversation');
  const projectId = input.projectId ?? detail.projectId ?? null;

  // Try LLM summarisation unless explicitly opted out
  let summary: ConsultSummary | CeremonySummary | null = null;
  let summarised = false;
  let modelUsed: string | undefined;

  if (!input.rawTranscript && detail.messages.length > 1) {
    try {
      const result = await summariseConsultForPromotion({
        kind: input.kind,
        projectId,
        sessionName: detail.name,
        transcriptMd,
      });
      summary = result.summary;
      summarised = true;
      modelUsed = result.modelUsed;
    } catch (err) {
      console.warn('[consult.promote] LLM summarisation failed, falling back to transcript:', err);
    }
  }

  const fallbackTitle = detail.name?.trim() || 'Promoted from consult';
  const finalTitle = (summary?.title ?? fallbackTitle).slice(0, 200);
  const finalBody = summary?.body ?? transcriptMd;

  if (input.kind === 'inbox') {
    const inboxService = await import('../services/inbox.js');
    const { item } = await inboxService.createInboxItem({
      originalDraft: summary
        ? `# ${finalTitle}\n\n${finalBody}\n\n---\n\n<details><summary>Original consult transcript</summary>\n\n${transcriptMd}\n\n</details>`
        : transcriptMd,
      suggestedProjectId: projectId,
      userId: null,
    });
    return {
      kind: 'inbox',
      summarised,
      modelUsed,
      artifact: { inboxItemId: item.id, suggestedProjectId: projectId },
    };
  }

  if (input.kind === 'issue') {
    if (!projectId) throw Object.assign(new Error('issue promotion requires a projectId'), { status: 400 });
    const issuesService = await import('../services/issues.js');
    const body = summary
      ? `${finalBody}\n\n---\n\n<details><summary>Original consult transcript</summary>\n\n${transcriptMd}\n\n</details>`
      : transcriptMd;
    const createdResult = await issuesService.createIssue({
      projectId,
      title: finalTitle,
      body,
      status: (input.columnSlug as 'backlog' | 'ready' | 'in_progress' | 'in_review' | 'done') ?? 'backlog',
      createdBy: 'user',
    });
    const created = createdResult.issue!;
    return {
      kind: 'issue',
      summarised,
      modelUsed,
      artifact: { issueId: created.id, projectId, url: `/projects/${projectId}/board` },
    };
  }

  // ceremony
  if (!projectId) throw Object.assign(new Error('ceremony promotion requires a projectId'), { status: 400 });
  const db = getDb();
  const slug = slugify(summary?.title ?? detail.name ?? 'consult-ceremony');
  const ceremonySummary = summary as CeremonySummary | null;
  const description = ceremonySummary?.description ?? 'Promoted from a consult session';
  const yamlContent = summary
    ? `# ${finalTitle}\n\n${finalBody}\n\n---\n\n<details><summary>Original consult transcript</summary>\n\n${transcriptMd}\n\n</details>`
    : transcriptMd;

  const [narrative] = await db
    .insert(schema.workflows)
    .values({
      projectId,
      name: finalTitle || (detail.name ?? 'Consult-promoted ceremony'),
      slug,
      description,
      triggerKind: 'manual',
      triggerConfig: {},
      kind: 'narrative',
      status: 'draft',
    })
    .returning();
  if (!narrative) throw new Error('Failed to insert narrative ceremony');
  await db.insert(schema.workflowVersions).values({
    workflowId: narrative.id,
    version: 1,
    yamlContent,
    isActive: true,
  });
  return {
    kind: 'ceremony',
    summarised,
    modelUsed,
    artifact: {
      ceremonyId: narrative.id,
      projectId,
      url: `/projects/${projectId}/ceremonies/review`,
    },
  };
}

/**
 * Build a kind-specific extraction prompt and call the formulator. Returns
 * the parsed/normalised summary or throws so the caller can fall back.
 */
async function summariseConsultForPromotion(args: {
  kind: 'inbox' | 'issue' | 'ceremony';
  projectId: string | null;
  sessionName: string | null;
  transcriptMd: string;
}): Promise<{ summary: ConsultSummary | CeremonySummary; modelUsed: string }> {
  const { runFormulator, extractJsonObject } = await import('../services/formulator.js');

  const transcriptForPrompt = args.transcriptMd.length > 12_000
    ? args.transcriptMd.slice(0, 12_000) + '\n\n[…transcript truncated…]'
    : args.transcriptMd;

  let systemMessage: string;
  let userPrompt: string;

  if (args.kind === 'inbox') {
    systemMessage =
      'You are a precise JSON-only assistant. Read a brainstorm transcript between a user and an AI thinking partner, then extract a concise capture suitable for the user\'s inbox. Return only the requested JSON object — no markdown fences, no prose.';
    userPrompt = [
      'Extract a concise inbox capture from this brainstorm transcript.',
      '',
      'Return JSON with this exact shape:',
      '{',
      '  "title": "string, 60 chars or less, imperative voice",',
      '  "body": "string, plain markdown, 4–10 sentences capturing the core idea, key decisions, and any open questions"',
      '}',
      '',
      'Transcript:',
      transcriptForPrompt,
    ].join('\n');
  } else if (args.kind === 'issue') {
    systemMessage =
      'You are a precise JSON-only assistant. Read a brainstorm transcript between a user and an AI thinking partner, then extract a clean GitHub-style issue. Return only the requested JSON object — no markdown fences, no prose.';
    userPrompt = [
      'Extract a clean issue from this brainstorm transcript.',
      '',
      'Return JSON with this exact shape:',
      '{',
      '  "title": "string, 80 chars or less, imperative voice (e.g. \\"Add foo\\" not \\"Adding foo\\")",',
      '  "body": "string, plain markdown with sections: ## Summary, ## Acceptance Criteria, ## Notes (only if relevant). Distill what the work actually is — do not include the conversation."',
      '}',
      '',
      'Transcript:',
      transcriptForPrompt,
    ].join('\n');
  } else {
    systemMessage =
      'You are a precise JSON-only assistant. Read a brainstorm transcript between a user and an AI thinking partner, then extract a draft narrative ceremony spec. Return only the requested JSON object — no markdown fences, no prose.';
    userPrompt = [
      'Extract a draft narrative ceremony from this brainstorm transcript.',
      '',
      'Return JSON with this exact shape:',
      '{',
      '  "title": "string, 80 chars or less, names the ceremony (e.g. \\"Daily Triage\\")",',
      '  "description": "string, one or two sentences summarising what the ceremony does",',
      '  "body": "string, plain markdown with sections: ## Purpose, ## Steps (numbered list of agent actions), ## Inputs, ## Outputs"',
      '}',
      '',
      'Transcript:',
      transcriptForPrompt,
    ].join('\n');
  }

  const { raw, modelUsed } = await runFormulator({
    prompt: userPrompt,
    projectId: args.projectId ?? undefined,
    systemMessage,
  });

  const parsed = extractJsonObject(raw) as Record<string, unknown>;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('formulator did not return a JSON object');
  }
  const title = typeof parsed.title === 'string' ? parsed.title.trim() : '';
  const body = typeof parsed.body === 'string' ? parsed.body.trim() : '';
  if (!title || !body) {
    throw new Error('formulator JSON missing title or body');
  }

  if (args.kind === 'ceremony') {
    const description =
      typeof parsed.description === 'string' && parsed.description.trim()
        ? parsed.description.trim()
        : 'Promoted from a consult session';
    return {
      summary: { title, body, description },
      modelUsed: modelUsed.model,
    };
  }
  return {
    summary: { title, body },
    modelUsed: modelUsed.model,
  };
}

function renderTranscript(messages: Array<{ role: string; content: string }>, title: string): string {
  const lines: string[] = [`# ${title}`, ''];
  for (const m of messages) {
    if (m.role === 'system' || m.role === 'tool') continue;
    const speaker = m.role === 'user' ? 'You' : 'Agent';
    lines.push(`**${speaker}:**`, '', m.content.trim(), '');
  }
  return lines.join('\n');
}
