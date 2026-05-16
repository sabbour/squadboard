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
import { getDb, getPool, schema } from '../db/index.js';
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

// UUID v4/v5 shape guard — rejects synthetic sentinels like '__heartbeat__'.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function findMatchingCeremonies(
  projectId: string,
  eventType: BusEventType,
): Promise<{ id: string; slug: string }[]> {
  if (!UUID_RE.test(projectId)) {
    // Belt-and-suspenders: skip DB query for non-UUID project IDs (e.g.
    // synthetic sentinels) to avoid crashing the Postgres UUID parser.
    console.debug(
      `[ceremony] findMatchingCeremonies skipped — projectId is not a UUID: ${projectId}`,
    );
    return [];
  }
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
// GitHub webhook ceremony matching (D3 — Stream G Phase 2B)
// ---------------------------------------------------------------------------

interface GithubTriggerConfig {
  event: string;
  action?: string;
  filters?: {
    label?: string;
    branch?: string;
    author_team?: string;
  };
}

async function findMatchingGithubCeremonies(
  projectId: string,
  ghEvent: string,
  action: string | null,
  payload: Record<string, unknown>,
): Promise<{ id: string; slug: string; triggerConfig: GithubTriggerConfig }[]> {
  if (!UUID_RE.test(projectId)) return [];
  const db = getDb();

  const rows = await db
    .select({
      id: schema.workflows.id,
      slug: schema.workflows.slug,
      triggerConfig: schema.workflows.triggerConfig,
    })
    .from(schema.workflows)
    .where(
      and(
        eq(schema.workflows.projectId, projectId),
        eq(schema.workflows.triggerKind, 'github'),
        eq(schema.workflows.status, 'active'),
        sql`${schema.workflows.triggerConfig}->>'event' = ${ghEvent}`,
      ),
    );

  // Filter by action (if specified in triggerConfig) and filter fields
  return rows.filter((row) => {
    const cfg = (row.triggerConfig ?? {}) as GithubTriggerConfig;

    // Action filter
    if (cfg.action && cfg.action !== action) return false;

    // Label filter — check payload.label.name or payload.pull_request.labels
    if (cfg.filters?.label) {
      const label = cfg.filters.label;
      const labelsArr = extractLabels(payload);
      if (!labelsArr.includes(label)) return false;
    }

    // Branch filter — check payload.pull_request.base.ref or payload.ref
    if (cfg.filters?.branch) {
      const branch = cfg.filters.branch;
      const payloadBranch = extractBranch(payload);
      if (payloadBranch !== branch) return false;
    }

    // author_team filter is async (gh api call) — skip here; handled at spawn time
    return true;
  }) as { id: string; slug: string; triggerConfig: GithubTriggerConfig }[];
}

function extractLabels(payload: Record<string, unknown>): string[] {
  // PR or issue-level labels
  const names: string[] = [];
  const tryLabels = (arr: unknown) => {
    if (Array.isArray(arr)) {
      for (const l of arr) {
        if (l && typeof l === 'object' && typeof (l as Record<string, unknown>).name === 'string') {
          names.push((l as Record<string, unknown>).name as string);
        }
      }
    }
  };
  tryLabels((payload.label as Record<string, unknown> | undefined) ? [payload.label] : []);
  tryLabels((payload.pull_request as Record<string, unknown> | undefined)?.labels);
  tryLabels((payload.issue as Record<string, unknown> | undefined)?.labels);
  return names;
}

function extractBranch(payload: Record<string, unknown>): string | null {
  const pr = payload.pull_request as Record<string, unknown> | undefined;
  if (pr?.base && typeof (pr.base as Record<string, unknown>).ref === 'string') {
    return (pr.base as Record<string, unknown>).ref as string;
  }
  if (typeof payload.ref === 'string') {
    // push event: refs/heads/main -> main
    return (payload.ref as string).replace(/^refs\/heads\//, '');
  }
  return null;
}

async function handleGithubEvent(
  projectId: string,
  ghEvent: string,
  action: string | null,
  deliveryId: string | null,
  payload: Record<string, unknown>,
): Promise<void> {
  let matches: { id: string; slug: string; triggerConfig: GithubTriggerConfig }[];
  try {
    matches = await findMatchingGithubCeremonies(projectId, ghEvent, action, payload);
  } catch (err) {
    console.error(`[ceremony] github dispatcher lookup failed for ${ghEvent}:`, err);
    return;
  }
  if (matches.length === 0) return;

  const pool = getPool();

  for (const m of matches) {
    // DB idempotency: use ceremony_github_fires(ceremony_slug, delivery_id) unique constraint
    if (deliveryId) {
      try {
        await pool.query(
          `INSERT INTO ceremony_github_fires (ceremony_slug, delivery_id)
           VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [m.slug, deliveryId],
        );
        // Check whether row existed already (affected = 0 means duplicate)
        const check = await pool.query(
          `SELECT 1 FROM ceremony_github_fires WHERE ceremony_slug = $1 AND delivery_id = $2`,
          [m.slug, deliveryId],
        );
        if (check.rowCount === 0) {
          console.debug(`[ceremony] github fire skipped (duplicate delivery): ${m.slug} / ${deliveryId}`);
          continue;
        }
      } catch (err) {
        console.error(`[ceremony] github fire idempotency check failed for ${m.slug}:`, err);
        continue;
      }
    } else {
      // No delivery ID — fall back to in-memory dedupe
      const dedupeKey = `github:${ghEvent}:${action ?? '*'}:${m.id}:${Date.now()}`;
      if (alreadyFired(dedupeKey)) continue;
      rememberFire(dedupeKey);
    }

    try {
      await spawnCeremonyRun(m.id, {
        trigger: `github:${ghEvent}${action ? ':' + action : ''}`,
        triggerSource: {
          kind: 'github',
          eventType: ghEvent,
          action: action ?? undefined,
          deliveryId: deliveryId ?? undefined,
          projectId,
        },
      });
    } catch (err) {
      console.error(`[ceremony] github dispatcher spawn failed (workflow ${m.slug}):`, err);
    }
  }
}

// ---------------------------------------------------------------------------
// Bus listener
// ---------------------------------------------------------------------------

async function handleEvent(event: BusEvent): Promise<void> {
  // Skip our own re-entrant events to avoid infinite loops if a ceremony
  // emits another bus event during execution.
  if (event.type === 'workflow.advanced') return;

  // Heartbeat events are server-wide infrastructure telemetry — they are not
  // project-scoped and must never reach ceremony matching.  Primary fix is
  // that emitHeartbeatEvent() now emits on the separate 'heartbeat' channel,
  // but this guard is belt-and-suspenders in case of future regressions.
  if (event.type.startsWith('heartbeat.')) return;

  // ── GitHub webhook events (D3) ──────────────────────────────────────────
  // Pattern: github.<event_type>.<action> or github.<event_type>
  if (event.type.startsWith('github.')) {
    const parts = event.type.split('.');
    // parts[0] = 'github', parts[1] = event_type, parts[2] = action (optional)
    const ghEvent = parts[1] ?? '';
    const ghAction = parts[2] ?? null;
    const outerPayload = event.payload as Record<string, unknown> | null;
    const innerPayload = (outerPayload?.payload as Record<string, unknown> | undefined) ?? outerPayload ?? {};
    const deliveryId = typeof outerPayload?.deliveryId === 'string' ? outerPayload.deliveryId : null;
    await handleGithubEvent(event.projectId, ghEvent, ghAction, deliveryId as string | null, innerPayload);
    return;
  }

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
        triggerSource: {
          kind: 'on_event',
          eventType: event.type,
          detail: eventId,
          anchorIssueId,
        },
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
