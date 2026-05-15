/**
 * services/inbox.ts — Phase 14 quick-capture (AI-formulated inbox).
 *
 * Flow:
 *   1. User pastes a raw draft → createInboxItem (status='captured').
 *   2. UI immediately calls formulateInboxItem → invoke SquadClient with a
 *      strict JSON prompt → fill formulatedTitle/Body/Labels/etc., bump
 *      status to 'formulated'.
 *   3. User edits any field → updateInboxItem (PATCH), or:
 *        - publishInboxItem → creates a real `issues` row in the chosen
 *          project + column, sets status='published', returns {item, issue}.
 *        - discardInboxItem → soft delete, status='discarded'.
 *
 * Throttle: each inbox item can be (re-)formulated at most once per
 * FORMULATE_THROTTLE_MS window. State is kept in-process; restart clears it.
 */

import { and, desc, eq, sql } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import type { InboxItem } from '../db/schema.js';
import * as issuesService from './issues.js';
import type { ColumnStatus } from './issues.js';
import { resolveModel, type ResolveModelResult } from '../sdk/model-defaults.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type InboxStatus = 'captured' | 'formulated' | 'published' | 'discarded';

export interface ListInboxFilters {
  userId?: string;
  status?: InboxStatus;
  projectId?: string;
  limit?: number;
  offset?: number;
}

export interface CreateInboxInput {
  userId?: string | null;
  originalDraft: string;
  suggestedProjectId?: string | null;
}

export interface UpdateInboxInput {
  formulatedTitle?: string;
  formulatedBody?: string;
  suggestedLabels?: string[];
  suggestedProjectId?: string | null;
  suggestedColumn?: string | null;
  confidence?: string | null;
  rationale?: string | null;
}

export interface PublishInboxInput {
  projectId: string;
  columnSlug: ColumnStatus;
}

// ---------------------------------------------------------------------------
// Throttle (in-memory; cleared on server restart)
// ---------------------------------------------------------------------------

/** 1-minute window — enough to keep accidental click-spam off the LLM. */
const FORMULATE_THROTTLE_MS = 60 * 1000;
const lastFormulateAt = new Map<string, number>();

export class ThrottledError extends Error {
  status = 429;
  constructor(message = 'throttled') {
    super(message);
    this.name = 'ThrottledError';
  }
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function listInboxItems(filters: ListInboxFilters = {}): Promise<InboxItem[]> {
  const db = getDb();
  const conds = [];
  if (filters.userId) conds.push(eq(schema.inboxItems.userId, filters.userId));
  if (filters.status) conds.push(eq(schema.inboxItems.status, filters.status));
  if (filters.projectId) conds.push(eq(schema.inboxItems.suggestedProjectId, filters.projectId));

  let q = db
    .select()
    .from(schema.inboxItems)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(schema.inboxItems.createdAt))
    .$dynamic();

  if (filters.limit !== undefined) q = q.limit(filters.limit);
  if (filters.offset !== undefined) q = q.offset(filters.offset);

  return q;
}

export async function getInboxItem(id: string): Promise<InboxItem | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.inboxItems)
    .where(eq(schema.inboxItems.id, id))
    .limit(1);
  return row ?? null;
}

export async function createInboxItem(input: CreateInboxInput): Promise<InboxItem> {
  const db = getDb();
  const draft = input.originalDraft?.trim();
  if (!draft) {
    throw Object.assign(new Error('`originalDraft` is required'), { status: 400 });
  }

  const [created] = await db
    .insert(schema.inboxItems)
    .values({
      userId: input.userId ?? null,
      originalDraft: draft,
      suggestedProjectId: input.suggestedProjectId ?? null,
      status: 'captured',
    })
    .returning();
  return created;
}

export async function updateInboxItem(id: string, patch: UpdateInboxInput): Promise<InboxItem> {
  const db = getDb();
  const existing = await getInboxItem(id);
  if (!existing) {
    throw Object.assign(new Error('inbox item not found'), { status: 404 });
  }

  const update: Partial<typeof schema.inboxItems.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (patch.formulatedTitle !== undefined) update.formulatedTitle = patch.formulatedTitle;
  if (patch.formulatedBody !== undefined) update.formulatedBody = patch.formulatedBody;
  if (patch.suggestedLabels !== undefined) update.suggestedLabels = patch.suggestedLabels;
  if ('suggestedProjectId' in patch) update.suggestedProjectId = patch.suggestedProjectId ?? null;
  if ('suggestedColumn' in patch) update.suggestedColumn = patch.suggestedColumn ?? null;
  if ('confidence' in patch) update.confidence = patch.confidence ?? null;
  if ('rationale' in patch) update.rationale = patch.rationale ?? null;

  const [updated] = await db
    .update(schema.inboxItems)
    .set(update)
    .where(eq(schema.inboxItems.id, id))
    .returning();
  return updated;
}

export async function discardInboxItem(id: string): Promise<InboxItem> {
  const db = getDb();
  const existing = await getInboxItem(id);
  if (!existing) {
    throw Object.assign(new Error('inbox item not found'), { status: 404 });
  }
  const [updated] = await db
    .update(schema.inboxItems)
    .set({ status: 'discarded', updatedAt: new Date() })
    .where(eq(schema.inboxItems.id, id))
    .returning();
  return updated;
}

// ---------------------------------------------------------------------------
// publishInboxItem — creates a real issue and links back to this inbox row
// ---------------------------------------------------------------------------

export async function publishInboxItem(
  id: string,
  input: PublishInboxInput,
): Promise<{ item: InboxItem; issue: typeof schema.issues.$inferSelect }> {
  const item = await getInboxItem(id);
  if (!item) {
    throw Object.assign(new Error('inbox item not found'), { status: 404 });
  }
  if (item.status === 'published') {
    throw Object.assign(new Error('inbox item already published'), { status: 409 });
  }
  if (item.status === 'discarded') {
    throw Object.assign(new Error('inbox item discarded; cannot publish'), { status: 409 });
  }
  if (!input.projectId) {
    throw Object.assign(new Error('`projectId` is required'), { status: 400 });
  }
  const column: ColumnStatus = input.columnSlug ?? 'backlog';
  const validCols: ColumnStatus[] = ['backlog', 'todo', 'in_progress', 'in_review', 'done'];
  if (!validCols.includes(column)) {
    throw Object.assign(new Error(`invalid columnSlug: ${input.columnSlug}`), { status: 400 });
  }

  const title = (item.formulatedTitle ?? item.originalDraft).trim().slice(0, 200);
  const body = item.formulatedBody ?? '';

  const issue = await issuesService.createIssue(input.projectId, {
    title,
    body,
    status: column,
  });

  // Best-effort: attach suggested labels by name (only if a matching label
  // exists in the target project — silent skip on miss).
  const suggested = Array.isArray(item.suggestedLabels) ? (item.suggestedLabels as string[]) : [];
  if (suggested.length > 0) {
    try {
      const db = getDb();
      const projectLabels = await db
        .select()
        .from(schema.labels)
        .where(eq(schema.labels.projectId, input.projectId));
      const lookup = new Map(projectLabels.map((l) => [l.name.toLowerCase(), l.id]));
      const matched = suggested
        .map((name) => lookup.get(String(name).toLowerCase()))
        .filter((v): v is string => Boolean(v));
      if (matched.length > 0) {
        await db
          .insert(schema.issueLabels)
          .values(matched.map((labelId) => ({ issueId: issue.id, labelId })))
          .onConflictDoNothing();
      }
    } catch (err) {
      console.warn('[inbox] label attach (non-fatal):', err);
    }
  }

  const db = getDb();
  const [updated] = await db
    .update(schema.inboxItems)
    .set({
      status: 'published',
      publishedIssueId: issue.id,
      updatedAt: new Date(),
    })
    .where(eq(schema.inboxItems.id, id))
    .returning();

  return { item: updated, issue };
}

// ---------------------------------------------------------------------------
// LLM formulator
// ---------------------------------------------------------------------------

export interface FormulatorPayload {
  title: string;
  body: string;
  suggestedLabels: string[];
  suggestedProjectId: string | null;
  suggestedColumn: ColumnStatus;
  confidence: 'high' | 'medium' | 'low';
  rationale: string;
}

const VALID_COLUMNS: ColumnStatus[] = ['backlog', 'todo', 'in_progress', 'in_review', 'done'];
const VALID_CONFIDENCE = new Set(['high', 'medium', 'low']);

/**
 * Build the LLM prompt. Lists every project (so the model can pick one) plus
 * the labels for a single "most likely" project. Heuristic for the most
 * likely project: the inbox item's existing suggestedProjectId, else the
 * first project in the list, else "(none)".
 */
async function buildPrompt(item: InboxItem): Promise<{ prompt: string; projectIds: Set<string> }> {
  const db = getDb();
  const projects = await db.select().from(schema.projects);
  const projectsList = projects.length
    ? projects
        .map((p) => `- ${p.id} | ${p.name} | path=${p.path}`)
        .join('\n')
    : '(no projects yet)';

  let labelProjectId: string | null = item.suggestedProjectId ?? null;
  if (!labelProjectId && projects.length > 0) {
    labelProjectId = projects[0].id;
  }
  let labelsList = '(no labels yet)';
  if (labelProjectId) {
    const labels = await db
      .select()
      .from(schema.labels)
      .where(eq(schema.labels.projectId, labelProjectId));
    if (labels.length > 0) {
      labelsList = labels.map((l) => `- ${l.name}`).join('\n');
    }
  }

  const prompt = [
    "You are an issue formulator for an agent-driven kanban board. Given a brief, raw idea from a user, return a clean issue title, a tightened body, suggested labels, a guess at which project (from the list provided), a guess at which column to land in, and a confidence rating.",
    '',
    'Available projects (id | name | path):',
    projectsList,
    '',
    'Available labels for the most likely project:',
    labelsList,
    '',
    "User's draft:",
    '"""',
    item.originalDraft,
    '"""',
    '',
    'Respond ONLY with a JSON object (no prose, no markdown fence) matching:',
    '{',
    '  "title": string,                            // ≤80 chars, imperative mood',
    '  "body": string,                             // markdown, 1-4 short paragraphs',
    '  "suggestedLabels": string[],                // label names (not IDs)',
    '  "suggestedProjectId": string | null,        // UUID from the projects list, or null',
    '  "suggestedColumn": "backlog"|"todo"|"in_progress"|"in_review"|"done",',
    '  "confidence": "high"|"medium"|"low",',
    '  "rationale": string                         // ≤2 sentences explaining your choices',
    '}',
  ].join('\n');

  return { prompt, projectIds: new Set(projects.map((p) => p.id)) };
}

/**
 * Strip optional ```json fences and trim leading prose so JSON.parse can
 * cope with chatty LLM output.
 */
function extractJsonObject(raw: string): unknown {
  const trimmed = raw.trim();
  // Try direct parse first.
  try {
    return JSON.parse(trimmed);
  } catch {
    // Strip ```json … ``` fences.
    const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenceMatch && fenceMatch[1]) {
      try {
        return JSON.parse(fenceMatch[1].trim());
      } catch {
        /* fall through */
      }
    }
    // Locate first { … last } and try that slice.
    const first = trimmed.indexOf('{');
    const last = trimmed.lastIndexOf('}');
    if (first !== -1 && last > first) {
      try {
        return JSON.parse(trimmed.slice(first, last + 1));
      } catch {
        /* fall through */
      }
    }
    throw new Error(`LLM output was not valid JSON: ${trimmed.slice(0, 200)}`);
  }
}

function normalizePayload(parsed: unknown, validProjectIds: Set<string>): FormulatorPayload {
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('LLM payload was not a JSON object');
  }
  const p = parsed as Record<string, unknown>;

  const title = typeof p.title === 'string' ? p.title.trim() : '';
  if (!title) throw new Error('LLM payload missing `title`');

  const body = typeof p.body === 'string' ? p.body.trim() : '';

  const labelsRaw = Array.isArray(p.suggestedLabels) ? p.suggestedLabels : [];
  const suggestedLabels = labelsRaw
    .filter((x): x is string => typeof x === 'string')
    .map((s) => s.trim())
    .filter(Boolean);

  let suggestedProjectId: string | null = null;
  if (typeof p.suggestedProjectId === 'string' && validProjectIds.has(p.suggestedProjectId)) {
    suggestedProjectId = p.suggestedProjectId;
  }

  const colRaw = typeof p.suggestedColumn === 'string' ? p.suggestedColumn : 'backlog';
  const suggestedColumn: ColumnStatus = VALID_COLUMNS.includes(colRaw as ColumnStatus)
    ? (colRaw as ColumnStatus)
    : 'backlog';

  const confRaw = typeof p.confidence === 'string' ? p.confidence : 'medium';
  const confidence = (VALID_CONFIDENCE.has(confRaw) ? confRaw : 'medium') as 'high' | 'medium' | 'low';

  const rationale = typeof p.rationale === 'string' ? p.rationale.trim() : '';

  return { title: title.slice(0, 200), body, suggestedLabels, suggestedProjectId, suggestedColumn, confidence, rationale };
}

/**
 * Invoke the SquadClient (one-shot ACP session, same surface as
 * sdk/squad-client.ts) to formulate the inbox item. Throws on parse / SDK
 * failure with a useful message so the route can surface it verbatim.
 */
async function callFormulator(prompt: string, model: string): Promise<string> {
  const token = process.env.GITHUB_TOKEN ?? process.env.SQUADBOARD_GITHUB_TOKEN;
  const { SquadClient } = await import('@bradygaster/squad-sdk/client');
  const client = new SquadClient({
    ...(token ? { githubToken: token } : { useLoggedInUser: true }),
    cwd: process.cwd(),
  });
  await client.connect();
  try {
    const session = await client.createSession({
      model,
      systemMessage: {
        mode: 'replace',
        content:
          'You are a precise JSON-only assistant. Return only the requested JSON object — no markdown fences, no prose.',
      },
      workingDirectory: process.cwd(),
      onPermissionRequest: () => ({ kind: 'approved' }),
    });
    const result = await client.sendAndWait(session, { prompt });
    return extractText(result);
  } finally {
    await client.disconnect().catch(() => {});
  }
}

function extractText(result: unknown): string {
  if (typeof result === 'string') return result;
  if (result && typeof result === 'object') {
    const r = result as Record<string, unknown>;
    if (r['data'] && typeof r['data'] === 'object') {
      const data = r['data'] as Record<string, unknown>;
      if (typeof data['content'] === 'string') return data['content'];
    }
    if (typeof r['content'] === 'string') return r['content'];
    if (typeof r['text'] === 'string') return r['text'];
    if (typeof r['message'] === 'string') return r['message'];
    if (r['message'] && typeof (r['message'] as Record<string, unknown>)['content'] === 'string') {
      return (r['message'] as Record<string, unknown>)['content'] as string;
    }
  }
  return JSON.stringify(result ?? '');
}

export interface FormulateResult {
  item: InboxItem;
  modelUsed: ResolveModelResult;
}

export async function formulateInboxItem(id: string): Promise<FormulateResult> {
  const item = await getInboxItem(id);
  if (!item) {
    throw Object.assign(new Error('inbox item not found'), { status: 404 });
  }

  const now = Date.now();
  const last = lastFormulateAt.get(id) ?? 0;
  if (now - last < FORMULATE_THROTTLE_MS) {
    throw new ThrottledError(
      `formulate throttled — try again in ${Math.ceil((FORMULATE_THROTTLE_MS - (now - last)) / 1000)}s`,
    );
  }
  lastFormulateAt.set(id, now);

  const { prompt, projectIds } = await buildPrompt(item);

  // Resolve model via the standard chain: agent (n/a here) → project default →
  // built-in fallback. The inbox formulator has no agent, so we pass null for
  // agentModel and look up the project default if we know one.
  let projectDefaultModel: string | null = null;
  if (item.suggestedProjectId) {
    try {
      const db = getDb();
      const [proj] = await db
        .select({ defaultModel: schema.projects.defaultModel })
        .from(schema.projects)
        .where(eq(schema.projects.id, item.suggestedProjectId))
        .limit(1);
      projectDefaultModel = proj?.defaultModel ?? null;
    } catch {
      // Best-effort: fall through to fallback.
    }
  }
  const modelUsed = resolveModel({
    sessionModel: null,
    agentModel: null,
    projectDefaultModel,
  });
  console.log(`[inbox] formulating ${id} with model=${modelUsed.model} (via ${modelUsed.via})`);

  let raw: string;
  try {
    raw = await callFormulator(prompt, modelUsed.model);
  } catch (err) {
    // Reset the throttle so the user can retry immediately on outright failure.
    lastFormulateAt.delete(id);
    const msg = err instanceof Error ? err.message : String(err);
    throw Object.assign(new Error(`formulator failed: ${msg}`), { status: 502 });
  }

  let payload: FormulatorPayload;
  try {
    payload = normalizePayload(extractJsonObject(raw), projectIds);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw Object.assign(new Error(`formulator returned unusable output: ${msg}`), {
      status: 502,
      llmRaw: raw,
    });
  }

  const db = getDb();
  // Don't overwrite an explicit user-locked suggestedProjectId.
  const finalProjectId = item.suggestedProjectId ?? payload.suggestedProjectId;

  const [updated] = await db
    .update(schema.inboxItems)
    .set({
      formulatedTitle: payload.title,
      formulatedBody: payload.body,
      suggestedLabels: payload.suggestedLabels,
      suggestedProjectId: finalProjectId,
      suggestedColumn: payload.suggestedColumn,
      confidence: payload.confidence,
      rationale: payload.rationale,
      status: 'formulated',
      updatedAt: new Date(),
    })
    .where(eq(schema.inboxItems.id, id))
    .returning();
  return { item: updated, modelUsed };
}

// `sql` import kept for future status-counting endpoints.
void sql;
