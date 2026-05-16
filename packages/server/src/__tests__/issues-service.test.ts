/**
 * Smoke tests for createIssue() and bulkImportIssues().
 *
 * Uses vi.mock() to stub the DB layer so no live postgres is needed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock DB layer before importing service modules.
// ---------------------------------------------------------------------------

const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockDb = {
  select: mockSelect,
  insert: mockInsert,
};

vi.mock('../db/index.js', () => ({
  getDb: () => mockDb,
  schema: {
    issues: { id: 'id', projectId: 'project_id', title: 'title', archived: 'archived', createdAt: 'created_at', status: 'status', position: 'position' },
    issueLabels: { issueId: 'issue_id', labelId: 'label_id' },
  },
}));

// Stub drizzle-orm helpers used inside createIssue.
vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => ({ __and: args }),
  eq: (col: unknown, val: unknown) => ({ __eq: [col, val] }),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...vals: unknown[]) => ({ __sql: { strings, vals } }),
    { __brand: 'sql' },
  ),
}));

// ---------------------------------------------------------------------------
// Now import services (they see the mocked DB).
// ---------------------------------------------------------------------------

import { createIssue } from '../services/issues.js';
import { bulkImportIssues, BulkImportInvariantError } from '../services/bulk-import-issues.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSelectChain(result: unknown[]) {
  // Build a chain where every terminal call resolves to `result`.
  // Supports both .where().limit(n) and await .where() (thenable).
  const resolved = Promise.resolve(result);
  const terminal = {
    limit: vi.fn().mockResolvedValue(result),
    then: resolved.then.bind(resolved),
    catch: resolved.catch.bind(resolved),
    finally: resolved.finally.bind(resolved),
  };
  const chain = {
    from: vi.fn(() => chain),
    where: vi.fn(() => terminal),
    ...terminal,
  };
  return chain;
}

function makeInsertChain(returning: unknown[]) {
  const chain = {
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(returning),
    onConflictDoNothing: vi.fn().mockResolvedValue([]),
  };
  return chain;
}

// ---------------------------------------------------------------------------
// createIssue() smoke tests
// ---------------------------------------------------------------------------

describe('createIssue()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('idempotency: returns {created:false} when title already exists for key', async () => {
    // First select (idempotency check) returns a hit.
    mockSelect
      .mockReturnValueOnce(makeSelectChain([{ id: 'existing-id' }]));

    const result = await createIssue({
      projectId: 'proj-1',
      title: 'My task',
      idempotencyKey: 'abc',
    });

    expect(result.created).toBe(false);
    expect(result.id).toBe('existing-id');
    expect(result.idempotencyKey).toBe('abc');
    // Must NOT have called insert.
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('sets completedAt when status=done and no explicit completedAt', async () => {
    // Idempotency select → no hit.
    mockSelect
      .mockReturnValueOnce(makeSelectChain([]))    // idempotency check
      .mockReturnValueOnce(makeSelectChain([{ maxPos: 0 }])); // max position

    const fakeIssue = {
      id: 'new-id',
      status: 'done',
      completedAt: new Date(),
      title: '[mykey] My task',
    };
    mockInsert.mockReturnValue(makeInsertChain([fakeIssue]));

    const before = Date.now();
    const result = await createIssue({
      projectId: 'proj-1',
      title: 'My task',
      status: 'done',
      idempotencyKey: 'mykey',
    });
    const after = Date.now();

    expect(result.created).toBe(true);
    expect(result.id).toBe('new-id');

    // Verify the values passed to insert include a completedAt in the right range.
    const insertCall = mockInsert.mock.results[0].value;
    const valuesArg = insertCall.values.mock.calls[0][0] as Record<string, unknown>;
    expect(valuesArg.status).toBe('done');
    expect(valuesArg.completedAt).toBeInstanceOf(Date);
    const completedMs = (valuesArg.completedAt as Date).getTime();
    expect(completedMs).toBeGreaterThanOrEqual(before);
    expect(completedMs).toBeLessThanOrEqual(after);
  });
});

// ---------------------------------------------------------------------------
// bulkImportIssues() smoke tests
// ---------------------------------------------------------------------------

describe('bulkImportIssues()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects items with in_progress status with BulkImportInvariantError message', async () => {
    const result = await bulkImportIssues({
      projectId: 'proj-1',
      items: [
        {
          idempotencyKey: 'k1',
          title: 'Active task',
          // @ts-expect-error — intentionally passing forbidden status
          status: 'in_progress',
        },
      ],
    });

    expect(result.total).toBe(1);
    expect(result.created).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].idempotencyKey).toBe('k1');
    expect(result.errors[0].error).toMatch(/only backlog\|done allowed in bulk/);
    expect(result.items[0].action).toBe('error');
  });

  it('creates a backlog item and returns created=1 skipped=0', async () => {
    // createIssue internally calls select (idempotency) then insert.
    mockSelect
      .mockReturnValueOnce(makeSelectChain([]))   // idempotency: no hit
      .mockReturnValueOnce(makeSelectChain([{ maxPos: 0 }])); // max position

    const fakeIssue = { id: 'bulk-new-id', status: 'backlog', title: '[k2] A task' };
    mockInsert.mockReturnValue(makeInsertChain([fakeIssue]));

    const result = await bulkImportIssues({
      projectId: 'proj-1',
      items: [{ idempotencyKey: 'k2', title: 'A task', status: 'backlog' }],
    });

    expect(result.created).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.errors).toHaveLength(0);
    expect(result.items[0].action).toBe('created');
    expect(result.items[0].issueId).toBe('bulk-new-id');
  });
});
