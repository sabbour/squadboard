/**
 * ceremony-dispatcher.ts — Phase 10
 *
 * Subscribes to the in-process event bus and fans out matching ceremonies
 * for `triggerKind = 'on_event'` rows.
 *
 *   triggerConfig shape: { eventType: 'review.requested' | 'deliverable.created' | … }
 *
 * Idempotency: a ceremony is not spawned twice for the same (eventId,
 * ceremonyId) pair within `DEDUPE_WINDOW_MS`. The dedupe map is bounded
 * by `MAX_DEDUPE_ENTRIES` (LRU-eviction by insertion order).
 *
 * Importing this module registers the listener as a side-effect.
 */

import { eq, and, sql } from 'drizzle-orm';
import { eventBus, type BusEvent, type BusEventType } from '../realtime/event-bus.js';
import { getDb, schema } from '../db/index.js';
import { spawnCeremonyRun } from './ceremony-scheduler.js';

// ---------------------------------------------------------------------------
// Idempotency LRU
// ---------------------------------------------------------------------------

const DEDUPE_WINDOW_MS = 60_000;
const MAX_DEDUPE_ENTRIES = 4096;

const dedupe = new Map<string, number>();

function rememberFire(key: string): void {
  if (dedupe.size >= MAX_DEDUPE_ENTRIES) {
    // Evict oldest — Maps preserve insertion order.
    const oldest = dedupe.keys().next().value;
    if (oldest !== undefined) dedupe.delete(oldest);
  }
  dedupe.set(key, Date.now());
}

function alreadyFired(key: string): boolean {
  const ts = dedupe.get(key);
  if (ts === undefined) return false;
  if (Date.now() - ts > DEDUPE_WINDOW_MS) {
    dedupe.delete(key);
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Event-id derivation
// ---------------------------------------------------------------------------
// Most BusEvent payloads carry their own row id. We try common shapes:
// `{id}`, `{runId}`, `{deliverableId}`, `{commentId}`, `{sessionId}`.
// Falls back to a synthetic `${type}:${ts}` if nothing usable is present —
// good enough to dedupe within a 60-second window for low-volume events.

function deriveEventId(event: BusEvent): string {
  const p = event.payload as Record<string, unknown> | null;
  if (p && typeof p === 'object') {
    for (const key of [
      'id',
      'eventId',
      'runId',
      'workflowRunId',
      'deliverableId',
      'commentId',
      'sessionId',
      'reviewId',
    ]) {
      const v = p[key];
      if (typeof v === 'string' && v.length > 0) return `${event.type}:${v}`;
    }
  }
  return `${event.type}:${Date.now()}`;
}

function deriveAnchorIssueId(event: BusEvent): string | undefined {
  const p = event.payload as Record<string, unknown> | null;
  if (p && typeof p === 'object') {
    const v = p['issueId'];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Lookup matching ceremonies
// ---------------------------------------------------------------------------

async function findMatchingCeremonies(
  projectId: string,
  eventType: BusEventType,
): Promise<{ id: string; slug: string }[]> {
  const db = getDb();
  // We compare triggerConfig->>'eventType' directly. Drizzle doesn't have a
  // first-class JSONB ->> helper for this scalar comparison so we use sql``.
  const rows = await db
    .select({ id: schema.workflows.id, slug: schema.workflows.slug })
    .from(schema.workflows)
    .where(
      and(
        eq(schema.workflows.projectId, projectId),
        eq(schema.workflows.triggerKind, 'on_event'),
        eq(schema.workflows.status, 'active'),
        sql`${schema.workflows.triggerConfig}->>'eventType' = ${eventType}`,
      ),
    );
  return rows;
}

// ---------------------------------------------------------------------------
// Bus listener
// ---------------------------------------------------------------------------

async function handleEvent(event: BusEvent): Promise<void> {
  // Skip our own re-entrant events to avoid infinite loops if a ceremony
  // emits another bus event during execution.
  if (event.type === 'workflow.advanced') return;

  let matches: { id: string; slug: string }[];
  try {
    matches = await findMatchingCeremonies(event.projectId, event.type);
  } catch (err) {
    console.error(
      `[ceremony] dispatcher lookup failed for ${event.type}:`,
      err,
    );
    return;
  }
  if (matches.length === 0) return;

  const eventId = deriveEventId(event);
  const anchorIssueId = deriveAnchorIssueId(event);

  for (const m of matches) {
    const dedupeKey = `${eventId}:${m.id}`;
    if (alreadyFired(dedupeKey)) continue;
    rememberFire(dedupeKey);

    try {
      await spawnCeremonyRun(m.id, {
        trigger: `on_event:${event.type}`,
        anchorIssueId,
      });
    } catch (err) {
      console.error(
        `[ceremony] dispatcher spawn failed (workflow ${m.slug}):`,
        err,
      );
    }
  }
}

// Register listener once on import. The event bus is a singleton, so a
// re-import is a no-op (listener identity check via flag).
let registered = false;
export function registerCeremonyDispatcher(): void {
  if (registered) return;
  registered = true;
  eventBus.on('event', (event: BusEvent) => {
    void handleEvent(event);
  });
  console.log('[ceremony] event dispatcher registered');
}

// Side-effect registration on import.
registerCeremonyDispatcher();
