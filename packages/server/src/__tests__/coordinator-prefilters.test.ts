import { describe, expect, it } from 'vitest';
import {
  LOW_CONFIDENCE_FLOOR,
  applyDeterministicPrefilters,
  applyDeterministicPostprocessing,
  filterBlockedAgents,
  isBacklogGated,
  isHumanOnlyOperation,
  isThinIssue,
  resolveNamedAgent,
} from '../coordinator/prefilters.js';
import type { CoordinatorInput } from '../coordinator/types.js';

function makeInput(overrides: Partial<CoordinatorInput['issue']> = {}): CoordinatorInput {
  return {
    issue: {
      id: 'issue-1',
      title: 'Add auth endpoint',
      body: 'Implement the endpoint.',
      labels: ['backend'],
      column: 'ready',
      parentId: null,
      blockedParentIds: [],
      priority: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      ...overrides,
    },
    candidateAgents: [
      {
        name: 'verbal',
        role: 'implementer',
        charterHash: 'abc',
        charterContent: '# Verbal',
        capabilities: ['backend', 'api'],
        available: true,
      },
      {
        name: 'scribe',
        role: 'scribe',
        charterHash: 'def',
        charterContent: '# Scribe',
        capabilities: ['docs'],
        available: false,
      },
    ],
    project: { id: 'project-1', name: 'Project', rules: '' },
    recentRuns: [],
  };
}

describe('coordinator deterministic prefilters', () => {
  it('dispatches explicit named-agent mentions without LLM judgment', () => {
    const decision = resolveNamedAgent(
      { title: 'Assign to verbal', body: 'Please handle this.' },
      makeInput().candidateAgents,
    );

    expect(decision).toEqual({
      kind: 'dispatch',
      agent: 'verbal',
      rationale: 'Issue explicitly names verbal.',
      confidence: 1,
    });
  });

  it('honors unavailable named agents so explicit routing can queue behind busy work', () => {
    const decision = resolveNamedAgent(
      { title: 'Assign to scribe', body: 'Please handle this.' },
      makeInput().candidateAgents,
    );

    expect(decision).toEqual({
      kind: 'dispatch',
      agent: 'scribe',
      rationale: 'Issue explicitly names scribe.',
      confidence: 1,
    });
  });

  it('detects human-only operations', () => {
    expect(isHumanOnlyOperation({ title: 'Rotate org-level secrets', body: null })).toBe(true);
    expect(isHumanOnlyOperation({ title: 'Fix auth bug', body: null })).toBe(false);
  });

  it('detects thin issues structurally', () => {
    expect(isThinIssue({ title: 'Fix thing', body: '', labels: [] })).toBe(true);
    expect(isThinIssue({ title: 'Fix thing', body: 'Details here', labels: [] })).toBe(false);
  });

  it('blocks backlog issues without label/capability overlap', () => {
    expect(
      isBacklogGated(
        { column: 'backlog', labels: ['frontend'] },
        makeInput().candidateAgents,
      ),
    ).toBe(true);
    expect(
      isBacklogGated(
        { column: 'backlog', labels: ['backend'] },
        makeInput().candidateAgents,
      ),
    ).toBe(false);
  });

  it('applies prefilters in deterministic priority order', () => {
    const decision = applyDeterministicPrefilters(makeInput({ title: 'Fix thing', body: '', labels: [], column: 'backlog' }));

    expect(decision).toEqual({
      kind: 'skip',
      reason: 'Backlog item has no label/capability match; leaving it for triage.',
    });
  });

  it('filters circuit-breaker blocked agents and returns skip when all are blocked', () => {
    const input = makeInput();
    const partial = filterBlockedAgents(input, new Set(['scribe']));
    expect(partial.decision).toBeNull();
    expect(partial.input.candidateAgents.map((agent) => agent.name)).toEqual(['verbal']);

    const all = filterBlockedAgents(input, new Set(['verbal', 'scribe']));
    expect(all.decision).toEqual({
      kind: 'skip',
      reason: 'All candidate agents are circuit-breaker blocked for issue issue-1; leaving queued for retry.',
    });
  });

  it('turns dispatches below the confidence floor into ambiguous decisions', () => {
    const input = makeInput();
    const decision = applyDeterministicPostprocessing(input, {
      kind: 'dispatch',
      agent: 'verbal',
      rationale: 'Weak fit',
      confidence: LOW_CONFIDENCE_FLOOR - 0.01,
    });

    expect(decision).toEqual({
      kind: 'ambiguous',
      suggestedAgents: ['verbal'],
      question: 'Best fit verbal scored 0.39, below the 0.40 floor. Please clarify scope before dispatch.',
    });
  });

  it('leaves dispatches at the confidence floor unchanged', () => {
    const original = {
      kind: 'dispatch' as const,
      agent: 'verbal',
      rationale: 'At floor',
      confidence: LOW_CONFIDENCE_FLOOR,
    };

    expect(applyDeterministicPostprocessing(makeInput(), original)).toBe(original);
  });
});
