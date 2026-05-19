import { describe, expect, it } from 'vitest';
import { BUILT_IN_PREAMBLE } from '../coordinator/preamble-builtin.js';
import { PARITY_RULES, summarizeParityRules } from '../coordinator/parity.js';
import { coordinatorDecisionSchema } from '../coordinator/schemas.js';

function extractPreambleDecisionRules() {
  const section = BUILT_IN_PREAMBLE.match(/## Decision rules \(in priority order\)([\s\S]*?)\n---/)?.[1];
  expect(section).toBeDefined();

  return [...section!.matchAll(/\n(\d+)\.\s+\*\*(.+?)\.\*\*([\s\S]*?)(?=\n\d+\. \*\*|$)/g)].map(
    (match) => ({
      number: Number(match[1]),
      title: match[2].replace(/\.$/, ''),
      body: match[3],
    }),
  );
}

function thresholdPattern(value: number): RegExp {
  const text = Number.isInteger(value) ? `${value}(?:\\.0+)?` : String(value).replace('.', '\\.');
  return new RegExp(`(^|[^0-9])${text}(?![0-9])`);
}

describe('coordinator coexistence rule matrix', () => {
  it('has stable unique rule ids', () => {
    const ids = PARITY_RULES.map((rule) => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('tracks all 12 mini-coordinator dispatch rules', () => {
    const dispatchIds = PARITY_RULES
      .filter((rule) => rule.domain === 'dispatch')
      .map((rule) => rule.id)
      .sort();

    expect(dispatchIds).toEqual([
      'R-13',
      'R-14',
      'R-15',
      'R-16',
      'R-17',
      'R-18',
      'R-19',
      'R-20',
      'R-21',
      'R-22',
      'R-23',
      'R-24',
    ]);
  });

  it('keeps preamble dispatch rule count and order aligned with the parity matrix', () => {
    const dispatchRules = PARITY_RULES.filter((rule) => rule.domain === 'dispatch');
    const preambleRules = extractPreambleDecisionRules();

    expect(preambleRules.map((rule) => rule.number)).toEqual(
      dispatchRules.map((_, index) => index + 1),
    );
    expect(preambleRules.map((rule) => rule.title)).toEqual(
      dispatchRules.map((rule) => rule.preambleTitle ?? rule.title),
    );
  });

  it('keeps numeric dispatch thresholds aligned with the built-in preamble', () => {
    const preambleRules = new Map(
      extractPreambleDecisionRules().map((rule) => [rule.title, rule.body]),
    );

    for (const rule of PARITY_RULES.filter((candidate) => candidate.domain === 'dispatch')) {
      if (!rule.thresholds) continue;
      const title = rule.preambleTitle ?? rule.title;
      const body = preambleRules.get(title);
      expect(body, `missing preamble rule for ${rule.id}: ${title}`).toBeDefined();
      for (const value of Object.values(rule.thresholds)) {
        expect(body!).toMatch(thresholdPattern(value));
      }
    }
  });

  it('documents that near-tie routing needs candidate scores before deterministic enforcement', () => {
    const nearTie = PARITY_RULES.find((rule) => rule.id === 'R-22');
    expect(nearTie?.limitation).toContain('no candidate score list');
    expect(() =>
      coordinatorDecisionSchema.parse({
        kind: 'dispatch',
        agent: 'verbal',
        rationale: 'Best fit',
        confidence: 0.8,
        candidateScores: [
          { agent: 'verbal', confidence: 0.8 },
          { agent: 'fenster', confidence: 0.75 },
        ],
      }),
    ).toThrow();
  });

  it('documents the first-slice Ralph live-action limitation', () => {
    const ralph = PARITY_RULES.find((rule) => rule.id === 'R-58');

    expect(ralph).toMatchObject({
      targetHome: 'server-deterministic',
      inScope: true,
    });
    expect(ralph?.limitation).toContain('only assigned-issue pickup performs a live side effect');
  });

  it('summarizes current parity ownership for dashboard/report consumers', () => {
    const summary = summarizeParityRules();

    expect(summary.total).toBe(PARITY_RULES.length);
    expect(summary.inScope).toBe(PARITY_RULES.filter((rule) => rule.inScope).length);
    expect(summary.byDomain.dispatch).toBe(12);
    expect(summary.byDomain.scribe).toBe(8);
    expect(summary.byTargetHome.deferred ?? 0).toBe(0);
    expect(summary.byTargetHome['squadboard-ui'] ?? 0).toBe(0);
  });
});
