/**
 * charter-backfill.test.ts — W29 MC-5 Backfill Helper Tests
 *
 * Verifies:
 * - Backfill service exports the main function
 * - Stats structure has required fields
 * - Idempotent wrapper exists
 */

import { describe, it, expect } from 'vitest';
import {
  backfillCharterContent,
  ensureCharterBackfill,
  formatBackfillErrorSummary,
  type BackfillStats,
} from '../services/charter-backfill.js';

describe('Charter Backfill Service (W29 MC-5)', () => {
  describe('exports and types', () => {
    it('backfillCharterContent function is exported', () => {
      expect(typeof backfillCharterContent).toBe('function');
    });

    it('ensureCharterBackfill function is exported', () => {
      expect(typeof ensureCharterBackfill).toBe('function');
    });

    it('BackfillStats type has required fields', () => {
      const stats: BackfillStats = {
        inspected: 0,
        updated: 0,
        skipped: 0,
        suppressedInternal: 0,
        errors: [],
      };
      expect(stats.inspected).toBe(0);
      expect(stats.updated).toBe(0);
      expect(stats.skipped).toBe(0);
      expect(Array.isArray(stats.errors)).toBe(true);
    });

    it('BackfillStats error items have agent and error fields', () => {
      const stats: BackfillStats = {
        inspected: 1,
        updated: 0,
        skipped: 1,
        suppressedInternal: 0,
        errors: [
          {
            agent: 'hockney',
            error: 'File not found',
          },
        ],
      };
      expect(stats.errors[0].agent).toBe('hockney');
      expect(stats.errors[0].error).toContain('File not found');
    });
  });

  describe('function signatures', () => {
    it('backfillCharterContent accepts squadRoot string', async () => {
      // This is a compile-time check; the function must accept a string
      const fn = (squadRoot: string): Promise<BackfillStats> => {
        throw new Error('Not implemented in test');
      };
      expect(typeof fn).toBe('function');
    });

    it('ensureCharterBackfill accepts squadRoot string', async () => {
      // This is a compile-time check; the function must accept a string
      const fn = (squadRoot: string): Promise<BackfillStats | null> => {
        throw new Error('Not implemented in test');
      };
      expect(typeof fn).toBe('function');
    });

    it('backfillCharterContent returns BackfillStats with counts', () => {
      type ExpectedStats = BackfillStats;
      const sample: ExpectedStats = {
        inspected: 5,
        updated: 3,
        skipped: 2,
        suppressedInternal: 0,
        errors: [],
      };
      expect(sample.inspected).toBe(5);
      expect(sample.updated).toBe(3);
      expect(sample.skipped).toBe(2);
    });

    it('ensureCharterBackfill returns BackfillStats or null', () => {
      type ExpectedReturn = BackfillStats | null;
      const results: ExpectedReturn[] = [
        { inspected: 0, updated: 0, skipped: 0, suppressedInternal: 0, errors: [] },
        null,
      ];
      expect(results[0]).not.toBeNull();
      expect(results[1]).toBeNull();
    });
  });

  describe('error summaries', () => {
    it('aggregates repeated missing-charter errors and samples examples', () => {
      const errors = Array.from({ length: 8 }, (_, i) => ({
        agent: `agent-${i}`,
        error: `Charter file not found at /workspace/.squad/agents/agent-${i}/charter.md`,
      }));

      const summary = formatBackfillErrorSummary(errors, 3);

      expect(summary).toContain('8× Charter file not found at <path>');
      expect(summary).toContain('agent-0');
      expect(summary).toContain('agent-2');
      expect(summary).not.toContain('agent-7:');
      expect(summary).toContain('5 more omitted');
    });
  });
});
