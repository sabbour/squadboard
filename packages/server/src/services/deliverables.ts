/**
 * services/deliverables.ts — Phase 9 deliverables.
 *
 * A `deliverable` is the reviewable form of what a run produced.
 * Auto-extracted from issueRuns.output / stepRuns.output via simple
 * heuristics; humans/agents can also create them directly.
 *
 * Lifecycle:
 *   draft → submitted → approved
 *                     ↘ changes_requested → (revision spawned) → superseded
 *
 * `superseded_by_deliverable_id` chains forward from an old deliverable to
 * its replacement. Forward-only in v1; no "restore superseded" endpoint.
 */

import { eq, desc, and } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import type { Deliverable, NewDeliverable } from '../db/schema.js';

export type DeliverableKind = 'text' | 'files' | 'links' | 'structured';
export type DeliverableStatus =
  | 'draft'
  | 'submitted'
  | 'approved'
  | 'changes_requested'
  | 'superseded';

export interface FilesPayload {
  files: Array<{ path: string; content: string; language?: string }>;
}
export interface LinksPayload {
  links: Array<{ url: string; title?: string; description?: string }>;
}
export interface TextPayload {
  text: string;
  format?: 'markdown' | 'plain';
}
export interface StructuredPayload {
  schema?: string;          // optional schema id for the UI to pick a viewer
  data: Record<string, unknown>;
}

export type DeliverablePayload =
  | TextPayload
  | FilesPayload
  | LinksPayload
  | StructuredPayload;

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function listDeliverablesForIssue(issueId: string): Promise<Deliverable[]> {
  const db = getDb();
  return db
    .select()
    .from(schema.deliverables)
    .where(eq(schema.deliverables.issueId, issueId))
    .orderBy(desc(schema.deliverables.producedAt));
}

export async function getDeliverable(deliverableId: string): Promise<Deliverable | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.deliverables)
    .where(eq(schema.deliverables.id, deliverableId))
    .limit(1);
  return row ?? null;
}

export async function createDeliverable(input: {
  issueId: string;
  runId?: string | null;
  stepRunId?: string | null;
  kind: DeliverableKind;
  title: string;
  summary?: string | null;
  payload: DeliverablePayload;
  status?: DeliverableStatus;
}): Promise<Deliverable> {
  if (!['text', 'files', 'links', 'structured'].includes(input.kind)) {
    throw Object.assign(new Error('invalid kind'), { status: 400 });
  }
  if (!input.title?.trim()) {
    throw Object.assign(new Error('title is required'), { status: 400 });
  }
  const db = getDb();
  const values: NewDeliverable = {
    issueId: input.issueId,
    runId: input.runId ?? null,
    stepRunId: input.stepRunId ?? null,
    kind: input.kind,
    title: input.title.trim(),
    summary: input.summary ?? null,
    payload: input.payload as unknown as NewDeliverable['payload'],
    status: input.status ?? 'submitted',
  };
  const [created] = await db.insert(schema.deliverables).values(values).returning();
  if (!created) throw new Error('Failed to insert deliverable');
  return created;
}

export async function setDeliverableStatus(
  deliverableId: string,
  status: DeliverableStatus,
): Promise<Deliverable | null> {
  const db = getDb();
  const [updated] = await db
    .update(schema.deliverables)
    .set({ status, updatedAt: new Date() })
    .where(eq(schema.deliverables.id, deliverableId))
    .returning();
  return updated ?? null;
}

export async function markSuperseded(
  deliverableId: string,
  supersededById: string,
): Promise<void> {
  const db = getDb();
  await db
    .update(schema.deliverables)
    .set({
      status: 'superseded',
      supersededByDeliverableId: supersededById,
      updatedAt: new Date(),
    })
    .where(eq(schema.deliverables.id, deliverableId));
}

// ---------------------------------------------------------------------------
// Auto-extraction from completed runs
// ---------------------------------------------------------------------------

const MARKDOWN_FENCE = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
const URL_REGEX = /https?:\/\/[^\s<>'"]+/g;

/** Heuristic: classify output into a DeliverableKind. */
export function classifyOutput(output: string): DeliverableKind {
  const trimmed = output.trim();
  if (!trimmed) return 'text';

  // structured: a single JSON object/array
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    try {
      JSON.parse(trimmed);
      return 'structured';
    } catch {
      // fall through
    }
  }

  // files: at least one fenced code block
  const fencedBlocks = trimmed.match(MARKDOWN_FENCE);
  if (fencedBlocks && fencedBlocks.length > 0) return 'files';

  // links: URL-only output (one or more URLs, very little prose around them)
  const urls = trimmed.match(URL_REGEX) ?? [];
  if (urls.length > 0) {
    const nonUrlLength = urls.reduce((acc, u) => acc.replace(u, ''), trimmed).trim().length;
    if (nonUrlLength < urls.length * 5) return 'links';
  }

  return 'text';
}

/** Build a DeliverablePayload from raw output, given a classification. */
export function extractPayload(output: string, kind: DeliverableKind): DeliverablePayload {
  const trimmed = output.trim();

  if (kind === 'structured') {
    try {
      const parsed = JSON.parse(trimmed);
      const data: Record<string, unknown> = Array.isArray(parsed) ? { items: parsed } : parsed;
      return { data };
    } catch {
      return { data: { raw: trimmed } };
    }
  }

  if (kind === 'files') {
    const files: FilesPayload['files'] = [];
    let m: RegExpExecArray | null;
    MARKDOWN_FENCE.lastIndex = 0;
    let idx = 0;
    while ((m = MARKDOWN_FENCE.exec(trimmed)) !== null) {
      const language = m[1] || undefined;
      const content = m[2];
      // Heuristic: if first line of content looks like a path (e.g. `// src/foo.ts`
      // or `path: src/foo.ts`), use it as the filename; else synthesise.
      const firstLine = content.split('\n', 1)[0] ?? '';
      const pathMatch =
        firstLine.match(/(?:\/\/|#|--)\s*(?:path:\s*)?([\w./-]+\.[a-zA-Z0-9]+)/) ??
        firstLine.match(/^path:\s*([\w./-]+\.[a-zA-Z0-9]+)/i);
      const path = pathMatch?.[1] ?? `output-${idx + 1}${language ? `.${language}` : ''}`;
      files.push({ path, content: content.trimEnd(), language });
      idx += 1;
    }
    return { files };
  }

  if (kind === 'links') {
    const urls = trimmed.match(URL_REGEX) ?? [];
    return {
      links: urls.map((url) => ({ url })),
    };
  }

  return { text: trimmed, format: 'markdown' };
}

/** First sentence (or first 140 chars) of the output, for the summary. */
function summariseOutput(output: string): string {
  const trimmed = output.trim();
  if (!trimmed) return '';
  const sentenceEnd = trimmed.search(/[.!?](?:\s|$)/);
  if (sentenceEnd > 0 && sentenceEnd < 200) return trimmed.slice(0, sentenceEnd + 1);
  return trimmed.slice(0, 140) + (trimmed.length > 140 ? '…' : '');
}

/**
 * Extract a deliverable from a completed issue_run's output.
 *
 * Returns null when the output is empty or extraction failed. Idempotent:
 * if a deliverable already exists for this run we return it instead of
 * creating another.
 */
export async function extractFromIssueRun(runId: string): Promise<Deliverable | null> {
  const db = getDb();
  const [run] = await db
    .select()
    .from(schema.issueRuns)
    .where(eq(schema.issueRuns.id, runId))
    .limit(1);
  if (!run || run.status !== 'completed') return null;
  if (!run.output || !run.output.trim()) return null;

  const [existing] = await db
    .select()
    .from(schema.deliverables)
    .where(eq(schema.deliverables.runId, runId))
    .limit(1);
  if (existing) return existing;

  const kind = classifyOutput(run.output);
  const payload = extractPayload(run.output, kind);
  const [issue] = await db
    .select({ title: schema.issues.title })
    .from(schema.issues)
    .where(eq(schema.issues.id, run.issueId))
    .limit(1);

  return createDeliverable({
    issueId: run.issueId,
    runId,
    kind,
    title: issue?.title ? `${issue.title} (run output)` : 'Run output',
    summary: summariseOutput(run.output),
    payload,
    status: 'submitted',
  });
}

/** Same as extractFromIssueRun but for a workflow step_run. */
export async function extractFromStepRun(stepRunId: string): Promise<Deliverable | null> {
  const db = getDb();
  const [stepRun] = await db
    .select()
    .from(schema.stepRuns)
    .where(eq(schema.stepRuns.id, stepRunId))
    .limit(1);
  if (!stepRun || stepRun.status !== 'completed') return null;
  if (!stepRun.output || !stepRun.output.trim()) return null;

  const [existing] = await db
    .select()
    .from(schema.deliverables)
    .where(eq(schema.deliverables.stepRunId, stepRunId))
    .limit(1);
  if (existing) return existing;

  const [wfRun] = await db
    .select({ issueId: schema.workflowRuns.issueId })
    .from(schema.workflowRuns)
    .where(eq(schema.workflowRuns.id, stepRun.workflowRunId))
    .limit(1);
  if (!wfRun) return null;

  const kind = classifyOutput(stepRun.output);
  const payload = extractPayload(stepRun.output, kind);

  return createDeliverable({
    issueId: wfRun.issueId,
    runId: stepRun.issueRunId ?? null,
    stepRunId,
    kind,
    title: `Step ${stepRun.stepIndex + 1} output (${stepRun.stepType})`,
    summary: summariseOutput(stepRun.output),
    payload,
    status: 'submitted',
  });
}

// ---------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------

export type ReviewVerb = 'approve' | 'request_changes' | 'comment' | 'dismiss';

export async function listDeliverableReviews(deliverableId: string) {
  const db = getDb();
  return db
    .select()
    .from(schema.reviewEvents)
    .where(eq(schema.reviewEvents.deliverableId, deliverableId))
    .orderBy(schema.reviewEvents.createdAt);
}

export async function recordDeliverableReview(input: {
  deliverableId: string;
  verb: ReviewVerb;
  body?: string | null;
  reviewerName?: string | null;
  reviewerAgentId?: string | null;
  suggestions?: unknown;
}) {
  if (!['approve', 'request_changes', 'comment', 'dismiss'].includes(input.verb)) {
    throw Object.assign(new Error('invalid verb'), { status: 400 });
  }
  const db = getDb();
  const [event] = await db
    .insert(schema.reviewEvents)
    .values({
      deliverableId: input.deliverableId,
      verb: input.verb,
      body: input.body ?? null,
      reviewerName: input.reviewerName ?? null,
      reviewerAgentId: input.reviewerAgentId ?? null,
      suggestions: (input.suggestions ?? null) as never,
      // workflowRunId + stepRunId are explicitly null for deliverable reviews;
      // schema check constraint enforces this.
    })
    .returning();
  return event;
}
