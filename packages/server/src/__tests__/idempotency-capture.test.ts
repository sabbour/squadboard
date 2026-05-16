/**
 * idempotency-capture.test.ts — I7 (W23)
 *
 * POST same originalDraft + same idempotencyKey twice → 1 row, second
 * response is the existing item (HTTP 200).
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

function makeSelectChain(result: unknown[]) {
  const resolved = Promise.resolve(result);
  const terminal = {
    limit: vi.fn().mockResolvedValue(result),
    then: resolved.then.bind(resolved),
    catch: resolved.catch.bind(resolved),
    finally: resolved.finally.bind(resolved),
  };
  return {
    from: vi.fn(() => ({ where: vi.fn(() => terminal) })),
  };
}

function makeInsertChain(returning: unknown[]) {
  return {
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(returning),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('idempotency-capture: POST inbox with same key twice', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns existing item (created=false) on second call with same key', async () => {
    const existingItem = {
      id: 'item-abc',
      originalDraft: 'Fix the login bug',
      idempotencyKey: 'key-001',
      suggestedProjectId: 'proj-1',
      status: 'captured',
    };

    // First call: no existing row → insert
    mockSelect
      .mockReturnValueOnce(makeSelectChain([])); // idempotency lookup: miss
    mockInsert.mockReturnValue(makeInsertChain([existingItem]));

    const first = await createInboxItem({
      originalDraft: 'Fix the login bug',
      suggestedProjectId: 'proj-1',
      idempotencyKey: 'key-001',
    });
    expect(first.created).toBe(true);
    expect(first.item.id).toBe('item-abc');

    vi.clearAllMocks();

    // Second call: existing row found → return without insert
    mockSelect
      .mockReturnValueOnce(makeSelectChain([existingItem])); // idempotency lookup: hit

    const second = await createInboxItem({
      originalDraft: 'Fix the login bug',
      suggestedProjectId: 'proj-1',
      idempotencyKey: 'key-001',
    });
    expect(second.created).toBe(false);
    expect(second.item.id).toBe('item-abc');
    expect(mockInsert).not.toHaveBeenCalled();
  });
});
