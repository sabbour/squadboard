/**
 * idempotency-cross-project.test.ts — I7 (W23)
 *
 * Same idempotency key in two different projects → 2 separate rows.
 * The unique index is scoped to (project_id, idempotency_key); cross-project
 * reuse of a key is legitimate.
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

describe('idempotency-cross-project: same key in different projects → 2 rows', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('creates two rows when the same key is used across different projects', async () => {
    const sharedKey = 'global-key-xyz';

    const item1 = { id: 'item-p1', originalDraft: 'A task', idempotencyKey: sharedKey, suggestedProjectId: 'proj-1', status: 'captured' };
    const item2 = { id: 'item-p2', originalDraft: 'A task', idempotencyKey: sharedKey, suggestedProjectId: 'proj-2', status: 'captured' };

    // proj-1: no existing row with that key in proj-1 → insert
    mockSelect.mockReturnValueOnce(makeSelectChain([]));
    mockInsert.mockReturnValueOnce(makeInsertChain([item1]));

    const r1 = await createInboxItem({
      originalDraft: 'A task',
      suggestedProjectId: 'proj-1',
      idempotencyKey: sharedKey,
    });

    // proj-2: no existing row with that key in proj-2 → insert (different project scope)
    mockSelect.mockReturnValueOnce(makeSelectChain([]));
    mockInsert.mockReturnValueOnce(makeInsertChain([item2]));

    const r2 = await createInboxItem({
      originalDraft: 'A task',
      suggestedProjectId: 'proj-2',
      idempotencyKey: sharedKey,
    });

    expect(r1.created).toBe(true);
    expect(r2.created).toBe(true);
    expect(r1.item.id).toBe('item-p1');
    expect(r2.item.id).toBe('item-p2');
    expect(mockInsert).toHaveBeenCalledTimes(2);
  });

  it('deduplicates within the same project even if other projects use the same key', async () => {
    const sharedKey = 'global-key-abc';
    const existingInProj1 = { id: 'item-p1', idempotencyKey: sharedKey, suggestedProjectId: 'proj-1', status: 'captured' };

    // Retry in proj-1: hit → dedup
    mockSelect.mockReturnValueOnce(makeSelectChain([existingInProj1]));

    const r = await createInboxItem({
      originalDraft: 'A task',
      suggestedProjectId: 'proj-1',
      idempotencyKey: sharedKey,
    });

    expect(r.created).toBe(false);
    expect(r.item.id).toBe('item-p1');
    expect(mockInsert).not.toHaveBeenCalled();
  });
});
