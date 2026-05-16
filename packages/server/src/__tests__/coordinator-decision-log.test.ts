/**
 * coordinator-decision-log.test.ts — W29 MC-10
 *
 * Tests for services/coordinator-decision-log.ts:
 *   1. buildCoordinatorDecisionRecord produces correct shape for dispatch decision
 *   2. ...for skip decision
 *   3. ...for ambiguous decision
 *   4. persistedAt is ISO 8601
 *   5. persistCoordinatorDecision updates the row (mock DB)
 *   6. persistCoordinatorDecision is idempotent (calling twice yields same JSONB)
 *   7. persistCoordinatorDecision does NOT throw if runId doesn't exist (warn + return)
 *   8. JSONB roundtrip: record shape survives JSON serialize/deserialize
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CoordinatorDecision, CoordinatorCallMeta } from '../coordinator/types.js';

// ---------------------------------------------------------------------------
// Mock db/index.js before importing service (drizzle needs no real DB here)
// ---------------------------------------------------------------------------

vi.mock('../db/index.js', () => ({
  getDb: vi.fn(),
  schema: {
    issueRuns: {
      id: 'issue_runs.id',
    },
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: (col: unknown, val: unknown) => ({ __eq: [col, val] }),
}));

import {
  buildCoordinatorDecisionRecord,
  persistCoordinatorDecision,
  type CoordinatorDecisionRecord,
} from '../services/coordinator-decision-log.js';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const baseMeta: CoordinatorCallMeta = {
  model: 'claude-haiku-4.5',
  promptTokens: 100,
  completionTokens: 50,
  durationMs: 320,
  cacheHit: false,
  inputHash: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
};

const dispatchDecision: CoordinatorDecision = {
  kind: 'dispatch',
  agent: 'verbal',
  rationale: 'Best match for UI work',
  confidence: 0.92,
};

const skipDecision: CoordinatorDecision = {
  kind: 'skip',
  reason: 'Issue is blocked by another',
};

const ambiguousDecision: CoordinatorDecision = {
  kind: 'ambiguous',
  suggestedAgents: ['verbal', 'fenster'],
  question: 'Is this a UI or backend task?',
};

// ---------------------------------------------------------------------------
// Mock DB factory for persistence tests
// ---------------------------------------------------------------------------

function makeMockDb(returnedRows: unknown[] = [{ id: 'run-abc' }]) {
  const mockReturning = vi.fn().mockResolvedValue(returnedRows);
  const mockWhere = vi.fn().mockReturnValue({ returning: mockReturning });
  const mockSet = vi.fn().mockReturnValue({ where: mockWhere });
  const mockUpdate = vi.fn().mockReturnValue({ set: mockSet });
  return { db: { update: mockUpdate }, mockUpdate, mockSet, mockWhere, mockReturning };
}

// ---------------------------------------------------------------------------
// 1–4: buildCoordinatorDecisionRecord
// ---------------------------------------------------------------------------

describe('buildCoordinatorDecisionRecord', () => {
  it('1. produces correct shape for dispatch decision', () => {
    const record = buildCoordinatorDecisionRecord(dispatchDecision, baseMeta);
    expect(record.decision).toEqual(dispatchDecision);
    expect(record.meta).toEqual(baseMeta);
    expect(typeof record.persistedAt).toBe('string');
  });

  it('2. produces correct shape for skip decision', () => {
    const record = buildCoordinatorDecisionRecord(skipDecision, baseMeta);
    expect(record.decision).toEqual(skipDecision);
    expect(record.meta).toEqual(baseMeta);
  });

  it('3. produces correct shape for ambiguous decision', () => {
    const record = buildCoordinatorDecisionRecord(ambiguousDecision, baseMeta);
    expect(record.decision).toEqual(ambiguousDecision);
    expect(record.meta).toEqual(baseMeta);
    expect((record.decision as typeof ambiguousDecision).suggestedAgents).toHaveLength(2);
  });

  it('4. persistedAt is a valid ISO 8601 string', () => {
    const record = buildCoordinatorDecisionRecord(dispatchDecision, baseMeta);
    const date = new Date(record.persistedAt);
    expect(isNaN(date.getTime())).toBe(false);
    expect(record.persistedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});

// ---------------------------------------------------------------------------
// 5–8: persistCoordinatorDecision
// ---------------------------------------------------------------------------

describe('persistCoordinatorDecision', () => {
  it('5. updates the row with coordinator decision record', async () => {
    const { db, mockUpdate, mockSet, mockWhere } = makeMockDb([{ id: 'run-abc' }]);
    await persistCoordinatorDecision('run-abc', dispatchDecision, baseMeta, db as never);

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledTimes(1);
    expect(mockWhere).toHaveBeenCalledTimes(1);

    const setArg = mockSet.mock.calls[0][0] as { coordinatorDecision: CoordinatorDecisionRecord };
    expect(setArg.coordinatorDecision.decision).toEqual(dispatchDecision);
    expect(setArg.coordinatorDecision.meta).toEqual(baseMeta);
    expect(typeof setArg.coordinatorDecision.persistedAt).toBe('string');
  });

  it('6. is idempotent — calling twice yields same JSONB shape', async () => {
    const { db, mockSet } = makeMockDb([{ id: 'run-abc' }]);
    await persistCoordinatorDecision('run-abc', dispatchDecision, baseMeta, db as never);
    await persistCoordinatorDecision('run-abc', dispatchDecision, baseMeta, db as never);

    const first  = (mockSet.mock.calls[0][0] as { coordinatorDecision: CoordinatorDecisionRecord }).coordinatorDecision;
    const second = (mockSet.mock.calls[1][0] as { coordinatorDecision: CoordinatorDecisionRecord }).coordinatorDecision;

    // decision + meta must be identical
    expect(first.decision).toEqual(second.decision);
    expect(first.meta).toEqual(second.meta);
  });

  it('7. does NOT throw if runId does not exist — warns and returns', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { db } = makeMockDb([]); // empty rows = row not found

    await expect(
      persistCoordinatorDecision('nonexistent-run', dispatchDecision, baseMeta, db as never),
    ).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('nonexistent-run'),
    );
    warnSpy.mockRestore();
  });

  it('8. JSONB roundtrip — record survives JSON serialize/deserialize', () => {
    const record = buildCoordinatorDecisionRecord(dispatchDecision, baseMeta);
    const serialized = JSON.stringify(record);
    const deserialized: CoordinatorDecisionRecord = JSON.parse(serialized);

    expect(deserialized.decision).toEqual(record.decision);
    expect(deserialized.meta).toEqual(record.meta);
    expect(deserialized.persistedAt).toBe(record.persistedAt);
  });
});
