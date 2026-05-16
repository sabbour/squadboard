/**
 * idempotency-distinct-keys.test.ts — I7 (W23)
 *
 * POST same payload with two distinct idempotencyKeys → 2 separate rows.
 * Caller's explicit intent to create two cards must be honoured.
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

describe('idempotency-distinct-keys: two different keys → two rows', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('creates two separate rows when distinct keys are given', async () => {
    const item1 = { id: 'item-001', originalDraft: 'Same text', idempotencyKey: 'key-aaa', status: 'captured' };
    const item2 = { id: 'item-002', originalDraft: 'Same text', idempotencyKey: 'key-bbb', status: 'captured' };

    // Call 1: key-aaa — miss, insert
    mockSelect.mockReturnValueOnce(makeSelectChain([]));
    mockInsert.mockReturnValueOnce(makeInsertChain([item1]));

    const r1 = await createInboxItem({
      originalDraft: 'Same text',
      suggestedProjectId: 'proj-1',
      idempotencyKey: 'key-aaa',
    });

    // Call 2: key-bbb — miss (different key), insert
    mockSelect.mockReturnValueOnce(makeSelectChain([]));
    mockInsert.mockReturnValueOnce(makeInsertChain([item2]));

    const r2 = await createInboxItem({
      originalDraft: 'Same text',
      suggestedProjectId: 'proj-1',
      idempotencyKey: 'key-bbb',
    });

    expect(r1.created).toBe(true);
    expect(r2.created).toBe(true);
    expect(r1.item.id).not.toBe(r2.item.id);
    expect(mockInsert).toHaveBeenCalledTimes(2);
  });
});
