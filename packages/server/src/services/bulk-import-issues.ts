/**
 * Bulk-import service — Wave 13 / N8.
 *
 * Calls createIssue() per row with per-row try/catch so a single bad row never
 * aborts the batch. The inertness invariant is enforced here: only 'backlog' and
 * 'done' are permitted status values. Any active status ('ready', 'in_progress',
 * 'in_review') is a hard error encoded in both the TypeScript type AND a runtime
 * check — BulkImportInvariantError.
 *
 * MCP wrapper (squadboard_bulk_import_cards) is Wave-13 N9 — not activated here.
 * This service is importable from that adapter when N9 lands.
 */

import { createIssue } from './issues.js';
import { getDb } from '../db/index.js';
import { schema } from '../db/index.js';
import { and, eq } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Invariant error
// ---------------------------------------------------------------------------

export class BulkImportInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BulkImportInvariantError';
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Only inert statuses are permitted in bulk import. */
export type InertStatus = 'backlog' | 'done';

export interface BulkImportItem {
  idempotencyKey: string;   // REQUIRED — replay-safe key
  title: string;
  body?: string;
  status?: InertStatus;
  completedAt?: Date | null;
}

export interface BulkImportResult {
  total: number;
  created: number;
  skipped: number;
  errors: Array<{ idempotencyKey: string; error: string }>;
  items: Array<{
    idempotencyKey: string;
    action: 'created' | 'skipped' | 'error';
    issueId?: string;
    error?: string;
  }>;
}

// ---------------------------------------------------------------------------
// bulkImportIssues
// ---------------------------------------------------------------------------

export async function bulkImportIssues(input: {
  projectId: string;
  items: BulkImportItem[];
  dryRun?: boolean;
  createdBy?: string;
}): Promise<BulkImportResult> {
  const { projectId, items, dryRun = false, createdBy = 'bulk-import' } = input;

  const result: BulkImportResult = {
    total: items.length,
    created: 0,
    skipped: 0,
    errors: [],
    items: [],
  };

  for (const item of items) {
    // Runtime inertness invariant — must not be bypassed.
    const status = item.status ?? 'backlog';
    if (status !== 'backlog' && status !== 'done') {
      const err = `BulkImportInvariantError: status: only backlog|done allowed in bulk (got '${status}')`;
      result.errors.push({ idempotencyKey: item.idempotencyKey, error: err });
      result.items.push({ idempotencyKey: item.idempotencyKey, action: 'error', error: err });
      continue;
    }

    if (dryRun) {
      // Dry-run: check existing idempotency hit via SELECT only; no INSERT.
      try {
        const db = getDb();
        const { issues } = schema;
        const expectedTitle = `[${item.idempotencyKey}] ${item.title}`;
        const [existing] = await db
          .select({ id: issues.id })
          .from(issues)
          .where(
            and(
              eq(issues.projectId, projectId),
              eq(issues.title, expectedTitle),
            ),
          )
          .limit(1);

        if (existing) {
          result.skipped++;
          result.items.push({ idempotencyKey: item.idempotencyKey, action: 'skipped', issueId: existing.id });
        } else {
          result.created++;
          result.items.push({ idempotencyKey: item.idempotencyKey, action: 'created' });
        }
      } catch (e) {
        const err = e instanceof Error ? e.message : String(e);
        result.errors.push({ idempotencyKey: item.idempotencyKey, error: err });
        result.items.push({ idempotencyKey: item.idempotencyKey, action: 'error', error: err });
      }
      continue;
    }

    // Real insert.
    try {
      const r = await createIssue({
        projectId,
        title: item.title,
        body: item.body,
        status,
        position: 0,
        archived: false,
        completedAt: item.completedAt,
        assigneeId: null,
        labels: [],
        idempotencyKey: item.idempotencyKey,
        createdBy,
      });

      if (r.created) {
        result.created++;
        result.items.push({ idempotencyKey: item.idempotencyKey, action: 'created', issueId: r.id });
      } else {
        result.skipped++;
        result.items.push({ idempotencyKey: item.idempotencyKey, action: 'skipped', issueId: r.id });
      }
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      result.errors.push({ idempotencyKey: item.idempotencyKey, error: err });
      result.items.push({ idempotencyKey: item.idempotencyKey, action: 'error', error: err });
    }
  }

  return result;
}
