/**
 * idempotency-no-key.test.ts — I7 (W23)
 *
 * POST without an idempotency key → legacy path. No dedup, row is always
 * created (the 60-second soft guard in createIssue is separate and is not
 * triggered for inbox items without a key).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock DB
// ---------------------------------------------------------------------------

const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockDb = { select: mockSelect, insert: mockInsert };

vi.mock('../db/index.js', () => ({
  getDb: () => mockDb,
  schema: {
    inboxItems: {
      id: 'id',
      idempotencyKey: 'idempotency_key',
      suggestedProjectId: 'suggested_project_id',
      status: 'status',
    },
  },
}));

vi.mock('../services/issues.js', () => ({}));
vi.mock('../sdk/model-defaults.js', () => ({ resolveModel: vi.fn() }));

vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => ({ __and: args }),
  eq: (col: unknown, val: unknown) => ({ __eq: [col, val] }),
  desc: (col: unknown) => ({ __desc: col }),
  or: (...args: unknown[]) => ({ __or: args }),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...vals: unknown[]) => ({ __sql: { strings, vals } }),
    { __brand: 'sql' },
  ),
}));

import { createInboxItem } from '../services/inbox.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInsertChain(returning: unknown[]) {
  return {
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(returning),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('idempotency-no-key: legacy path (no idempotency key)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('inserts without consulting the idempotency index when no key is given', async () => {
    const item = { id: 'item-legacy', originalDraft: 'A plain capture', status: 'captured' };
    mockInsert.mockReturnValue(makeInsertChain([item]));

    const result = await createInboxItem({
      originalDraft: 'A plain capture',
      suggestedProjectId: 'proj-1',
      // no idempotencyKey
    });

    expect(result.created).toBe(true);
    expect(result.item.id).toBe('item-legacy');
    // No select call — skips idempotency check entirely
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it('created=true even if called twice with no key (no automatic dedup)', async () => {
    const item1 = { id: 'item-x1', originalDraft: 'Dup text', status: 'captured' };
    const item2 = { id: 'item-x2', originalDraft: 'Dup text', status: 'captured' };
    mockInsert
      .mockReturnValueOnce(makeInsertChain([item1]))
      .mockReturnValueOnce(makeInsertChain([item2]));

    const r1 = await createInboxItem({ originalDraft: 'Dup text', suggestedProjectId: 'proj-1' });
    const r2 = await createInboxItem({ originalDraft: 'Dup text', suggestedProjectId: 'proj-1' });

    expect(r1.created).toBe(true);
    expect(r2.created).toBe(true);
    expect(r1.item.id).not.toBe(r2.item.id);
  });
});
