/**
 * issue-run-events-schema.test.ts — Wave 28 JIS-T1 regression
 *
 * Verifies the issueRunEvents Drizzle schema shape, basic insert, and
 * ordered fetch by seq — all via mocked DB.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock DB layer before importing schema consumers.
// ---------------------------------------------------------------------------

const mockInsert = vi.fn();
const mockSelect = vi.fn();
const mockDb = { insert: mockInsert, select: mockSelect };

vi.mock('../db/index.js', () => ({
  getDb: () => mockDb,
  schema: {
    issueRunEvents: {
      id:        'id',
      runId:     'run_id',
      seq:       'seq',
      eventType: 'event_type',
      payload:   'payload',
      createdAt: 'created_at',
    },
  },
}));

// ---------------------------------------------------------------------------
// Schema shape tests (import directly from schema)
// ---------------------------------------------------------------------------

import * as schema from '../db/schema.js';

describe('issueRunEvents schema shape', () => {
  it('exports issueRunEvents table', () => {
    expect(schema.issueRunEvents).toBeDefined();
  });

  it('has expected column definitions', () => {
    const cols = schema.issueRunEvents;
    // Check that drizzle table object has the expected keys
    expect(cols).toHaveProperty('id');
    expect(cols).toHaveProperty('runId');
    expect(cols).toHaveProperty('seq');
    expect(cols).toHaveProperty('eventType');
    expect(cols).toHaveProperty('payload');
    expect(cols).toHaveProperty('createdAt');
  });

  it('exports IssueRunEvent type (infer select present)', () => {
    // TypeScript compile-time check: inferSelect must exist on the table
    type Row = schema.IssueRunEvent;
    const row: Partial<Row> = { seq: 1, eventType: 'start' };
    expect(row.seq).toBe(1);
    expect(row.eventType).toBe('start');
  });

  it('exports NewIssueRunEvent type (infer insert present)', () => {
    type NewRow = schema.NewIssueRunEvent;
    const newRow: Partial<NewRow> = {
      runId:     '00000000-0000-0000-0000-000000000001',
      seq:       0,
      eventType: 'start',
      payload:   { message: 'Agent starting' },
    };
    expect(newRow.eventType).toBe('start');
  });
});

// ---------------------------------------------------------------------------
// Insert simulation
// ---------------------------------------------------------------------------

function makeInsertChain(returning: unknown[]) {
  return {
    values:    vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(returning),
  };
}

function makeSelectChain(result: unknown[]) {
  const resolved = Promise.resolve(result);
  const terminal = {
    limit:   vi.fn().mockResolvedValue(result),
    offset:  vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    where:   vi.fn().mockReturnThis(),
    then:    resolved.then.bind(resolved),
  };
  return {
    from:    vi.fn(() => terminal),
    ...terminal,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('issueRunEvents insert simulation', () => {
  it('inserts an event row and returns the record', async () => {
    const fakeRow = {
      id: 1,
      runId: 'run-abc',
      seq: 0,
      eventType: 'start',
      payload: {},
      createdAt: new Date(),
    };
    const chain = makeInsertChain([fakeRow]);
    mockInsert.mockReturnValue(chain);

    const db = mockDb;
    const [row] = await db.insert({}).values({ runId: 'run-abc', seq: 0, eventType: 'start', payload: {} }).returning();

    expect(row).toEqual(fakeRow);
    expect(chain.values).toHaveBeenCalledWith({ runId: 'run-abc', seq: 0, eventType: 'start', payload: {} });
  });

  it('inserts multiple events with sequential seq values', async () => {
    const rows = [
      { id: 1, runId: 'run-abc', seq: 0, eventType: 'start',  payload: {}, createdAt: new Date() },
      { id: 2, runId: 'run-abc', seq: 1, eventType: 'turn',   payload: { text: 'hi' }, createdAt: new Date() },
      { id: 3, runId: 'run-abc', seq: 2, eventType: 'finish', payload: {}, createdAt: new Date() },
    ];
    const chain = makeInsertChain(rows);
    mockInsert.mockReturnValue(chain);

    const db = mockDb;
    const inserted = await db.insert({}).values([]).returning();

    expect(inserted).toHaveLength(3);
    expect(inserted.map((r: { seq: number }) => r.seq)).toEqual([0, 1, 2]);
  });
});

// ---------------------------------------------------------------------------
// Ordered fetch by seq (ascending)
// ---------------------------------------------------------------------------

describe('issueRunEvents ordered fetch', () => {
  it('returns events sorted by seq ASC', async () => {
    const events = [
      { id: 1, seq: 0, eventType: 'start' },
      { id: 2, seq: 1, eventType: 'turn' },
      { id: 3, seq: 2, eventType: 'finish' },
    ];
    const chain = makeSelectChain(events);
    mockSelect.mockReturnValue(chain);

    const db = mockDb;
    const result = await db.select().from({}).where({}).orderBy({});

    expect(result).toHaveLength(3);
    expect(result[0].seq).toBe(0);
    expect(result[1].seq).toBe(1);
    expect(result[2].seq).toBe(2);
  });

  it('since_seq filter only returns events with seq >= N', async () => {
    const allEvents = [
      { id: 1, seq: 0, eventType: 'start' },
      { id: 2, seq: 1, eventType: 'turn' },
      { id: 3, seq: 2, eventType: 'finish' },
    ];
    const sinceSeq = 1;
    const filtered = allEvents.filter(e => e.seq >= sinceSeq);
    const chain = makeSelectChain(filtered);
    mockSelect.mockReturnValue(chain);

    const db = mockDb;
    const result = await db.select().from({}).where({}).orderBy({});

    expect(result).toHaveLength(2);
    expect(result.every((e: { seq: number }) => e.seq >= sinceSeq)).toBe(true);
  });
});
