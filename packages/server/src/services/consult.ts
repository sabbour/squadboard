/**
 * services/consult.ts — Phase 17 Ask / Consult mode CRUD layer.
 *
 * Bottom half of the consult stack. Pure DB helpers; the streaming runner
 * (sdk/consult-stream.ts) handles SDK lifecycle, the routes layer
 * (routes/consult.ts) wraps these in HTTP, and the propose-tool handlers
 * persist proposals through `createProposal()` below.
 *
 * No SDK dependencies in this file — it must stay safe to import from
 * the routes layer without dragging in `@bradygaster/squad-sdk`.
 */

import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import type {
  ConsultMessage,
  ConsultProposal,
  ConsultSession,
} from '../db/schema.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ConsultMode = 'agent' | 'model';
export type ConsultStatus = 'active' | 'idle' | 'completed' | 'failed' | 'cancelled';
export type ConsultMessageRole = 'user' | 'assistant' | 'system' | 'tool';
export type ConsultProposalKind =
  | 'issue'
  | 'ceremony'
  | 'inbox_item'
  | 'capture_to_decision'
  | 'assign_agent_to_issue';
export type ConsultProposalStatus = 'pending' | 'accepted' | 'edited' | 'discarded';

export interface CreateConsultSessionInput {
  projectId?: string | null;
  mode: ConsultMode;
  agentId?: string | null;
  agentName?: string | null;
  model?: string | null;
  name?: string | null;
  forkedFromSessionId?: string | null;
}

export interface ListConsultSessionsFilters {
  projectId?: string;
  status?: ConsultStatus;
  mode?: ConsultMode;
  /** When true, only sessions with NULL projectId (cross-project consults). */
  globalOnly?: boolean;
  limit?: number;
  offset?: number;
}

export interface AddMessageInput {
  sessionId: string;
  role: ConsultMessageRole;
  content?: string;
  reasoningContent?: string | null;
  toolName?: string | null;
  toolArgs?: Record<string, unknown> | null;
  toolResult?: Record<string, unknown> | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  costUsd?: string | null;
}

export interface CreateProposalInput {
  sessionId: string;
  messageId?: string | null;
  kind: ConsultProposalKind;
  payload: Record<string, unknown>;
}

export interface UpdateProposalInput {
  status?: ConsultProposalStatus;
  editedPayload?: Record<string, unknown> | null;
  result?: Record<string, unknown> | null;
  errorMessage?: string | null;
}

export interface ConsultSessionDetail extends ConsultSession {
  messages: ConsultMessage[];
  proposals: ConsultProposal[];
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

const NAME_DEFAULT = 'New consult';

export function deriveConsultName(firstUserMessage: string | null | undefined): string {
  const trimmed = (firstUserMessage ?? '').trim().replace(/\s+/g, ' ');
  if (!trimmed) return NAME_DEFAULT;
  return trimmed.length <= 80 ? trimmed : `${trimmed.slice(0, 77)}…`;
}

export async function createConsultSession(input: CreateConsultSessionInput): Promise<ConsultSession> {
  const db = getDb();
  const [row] = await db
    .insert(schema.consultSessions)
    .values({
      projectId: input.projectId ?? null,
      mode: input.mode,
      agentId: input.mode === 'agent' ? (input.agentId ?? null) : null,
      agentName: input.mode === 'agent' ? (input.agentName ?? null) : null,
      model: input.model ?? null,
      name: input.name ?? null,
      forkedFromSessionId: input.forkedFromSessionId ?? null,
      status: 'active',
    })
    .returning();
  if (!row) throw new Error('Failed to create consult session');
  return row;
}

export async function listConsultSessions(filters: ListConsultSessionsFilters = {}): Promise<ConsultSession[]> {
  const db = getDb();
  const where = [] as ReturnType<typeof eq>[];
  if (filters.projectId) {
    where.push(eq(schema.consultSessions.projectId, filters.projectId));
  } else if (filters.globalOnly) {
    where.push(sql`${schema.consultSessions.projectId} IS NULL` as unknown as ReturnType<typeof eq>);
  }
  if (filters.status) where.push(eq(schema.consultSessions.status, filters.status));
  if (filters.mode) where.push(eq(schema.consultSessions.mode, filters.mode));

  const baseQuery = db.select().from(schema.consultSessions);
  const filtered = where.length > 0 ? baseQuery.where(and(...where)) : baseQuery;

  return filtered
    .orderBy(desc(schema.consultSessions.createdAt))
    .limit(filters.limit ?? 200)
    .offset(filters.offset ?? 0);
}

export async function getConsultSession(sessionId: string): Promise<ConsultSession | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.consultSessions)
    .where(eq(schema.consultSessions.id, sessionId))
    .limit(1);
  return row ?? null;
}

export async function getConsultSessionDetail(sessionId: string): Promise<ConsultSessionDetail | null> {
  const session = await getConsultSession(sessionId);
  if (!session) return null;
  const db = getDb();
  const [messages, proposals] = await Promise.all([
    db
      .select()
      .from(schema.consultMessages)
      .where(eq(schema.consultMessages.sessionId, sessionId))
      .orderBy(asc(schema.consultMessages.ts)),
    db
      .select()
      .from(schema.consultProposals)
      .where(eq(schema.consultProposals.sessionId, sessionId))
      .orderBy(asc(schema.consultProposals.createdAt)),
  ]);
  return { ...session, messages, proposals };
}

export async function renameConsultSession(sessionId: string, name: string): Promise<ConsultSession | null> {
  const db = getDb();
  const [row] = await db
    .update(schema.consultSessions)
    .set({ name: name.trim() || NAME_DEFAULT, updatedAt: new Date() })
    .where(eq(schema.consultSessions.id, sessionId))
    .returning();
  return row ?? null;
}

export async function endConsultSession(
  sessionId: string,
  reason: 'completed' | 'cancelled' | 'failed' = 'cancelled',
  errorMessage?: string | null,
): Promise<ConsultSession | null> {
  const db = getDb();
  const [row] = await db
    .update(schema.consultSessions)
    .set({
      status: reason,
      endedAt: new Date(),
      updatedAt: new Date(),
      ...(errorMessage ? { errorMessage } : {}),
    })
    .where(eq(schema.consultSessions.id, sessionId))
    .returning();
  return row ?? null;
}

export async function deleteConsultSession(sessionId: string): Promise<void> {
  const db = getDb();
  await db.delete(schema.consultSessions).where(eq(schema.consultSessions.id, sessionId));
}

export async function recordSessionUsage(
  sessionId: string,
  inputTokens: number,
  outputTokens: number,
  costUsdDelta: string,
  premiumRequestsDelta?: number,
): Promise<void> {
  const db = getDb();
  const updates: Record<string, any> = {
    inputTokens: sql`${schema.consultSessions.inputTokens} + ${inputTokens}`,
    outputTokens: sql`${schema.consultSessions.outputTokens} + ${outputTokens}`,
    costUsd: sql`${schema.consultSessions.costUsd} + ${costUsdDelta}`,
    updatedAt: new Date(),
  };
  
  if (premiumRequestsDelta != null) {
    updates.premiumRequests = sql`${schema.consultSessions.premiumRequests} + ${premiumRequestsDelta}`;
  }

  await db
    .update(schema.consultSessions)
    .set(updates)
    .where(eq(schema.consultSessions.id, sessionId));
}

export async function bumpMessageCount(sessionId: string): Promise<void> {
  const db = getDb();
  await db
    .update(schema.consultSessions)
    .set({
      messageCount: sql`${schema.consultSessions.messageCount} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(schema.consultSessions.id, sessionId));
}

export async function setSessionSdkId(sessionId: string, sdkSessionId: string): Promise<void> {
  const db = getDb();
  await db
    .update(schema.consultSessions)
    .set({ sdkSessionId, updatedAt: new Date() })
    .where(eq(schema.consultSessions.id, sessionId));
}

export async function setSessionModel(sessionId: string, model: string): Promise<void> {
  const db = getDb();
  await db
    .update(schema.consultSessions)
    .set({ model, updatedAt: new Date() })
    .where(eq(schema.consultSessions.id, sessionId));
}

export async function setSessionStatus(
  sessionId: string,
  status: ConsultStatus,
  errorMessage?: string | null,
): Promise<void> {
  const db = getDb();
  await db
    .update(schema.consultSessions)
    .set({
      status,
      updatedAt: new Date(),
      ...(errorMessage !== undefined ? { errorMessage } : {}),
    })
    .where(eq(schema.consultSessions.id, sessionId));
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export async function addConsultMessage(input: AddMessageInput): Promise<ConsultMessage> {
  const db = getDb();
  const [row] = await db
    .insert(schema.consultMessages)
    .values({
      sessionId: input.sessionId,
      role: input.role,
      content: input.content ?? '',
      reasoningContent: input.reasoningContent ?? null,
      toolName: input.toolName ?? null,
      toolArgs: input.toolArgs ?? null,
      toolResult: input.toolResult ?? null,
      inputTokens: input.inputTokens ?? null,
      outputTokens: input.outputTokens ?? null,
      costUsd: input.costUsd ?? null,
    })
    .returning();
  if (!row) throw new Error('Failed to insert consult message');
  await bumpMessageCount(input.sessionId);
  return row;
}

export async function listConsultMessages(sessionId: string): Promise<ConsultMessage[]> {
  const db = getDb();
  return db
    .select()
    .from(schema.consultMessages)
    .where(eq(schema.consultMessages.sessionId, sessionId))
    .orderBy(asc(schema.consultMessages.ts));
}

// ---------------------------------------------------------------------------
// Proposals
// ---------------------------------------------------------------------------

export async function createProposal(input: CreateProposalInput): Promise<ConsultProposal> {
  const db = getDb();
  const [row] = await db
    .insert(schema.consultProposals)
    .values({
      sessionId: input.sessionId,
      messageId: input.messageId ?? null,
      kind: input.kind,
      payload: input.payload,
      status: 'pending',
    })
    .returning();
  if (!row) throw new Error('Failed to insert consult proposal');
  return row;
}

export async function listProposals(sessionId: string): Promise<ConsultProposal[]> {
  const db = getDb();
  return db
    .select()
    .from(schema.consultProposals)
    .where(eq(schema.consultProposals.sessionId, sessionId))
    .orderBy(asc(schema.consultProposals.createdAt));
}

export async function getProposal(proposalId: string): Promise<ConsultProposal | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.consultProposals)
    .where(eq(schema.consultProposals.id, proposalId))
    .limit(1);
  return row ?? null;
}

export async function updateProposal(
  proposalId: string,
  patch: UpdateProposalInput,
): Promise<ConsultProposal | null> {
  const db = getDb();
  const set: Record<string, unknown> = {};
  if (patch.status !== undefined) {
    set.status = patch.status;
    if (patch.status !== 'pending') set.decidedAt = new Date();
  }
  if (patch.editedPayload !== undefined) set.editedPayload = patch.editedPayload;
  if (patch.result !== undefined) set.result = patch.result;
  if (patch.errorMessage !== undefined) set.errorMessage = patch.errorMessage;
  if (Object.keys(set).length === 0) return getProposal(proposalId);
  const [row] = await db
    .update(schema.consultProposals)
    .set(set)
    .where(eq(schema.consultProposals.id, proposalId))
    .returning();
  return row ?? null;
}
