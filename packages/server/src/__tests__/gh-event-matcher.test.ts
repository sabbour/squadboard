/**
 * gh-event-matcher.test.ts — CER-5 (W29): Tests for matchesGithubEventFilters.
 *
 * Each filter is tested with:
 *   - filter present + payload matches → matched=true, reasons=[]
 *   - filter present + payload doesn't match → matched=false with descriptive reason
 *   - filter absent → no contribution to result
 *
 * Design decisions documented in gh-event-matcher.ts header.
 */

import { describe, it, expect } from 'vitest';
import {
  matchesGithubEventFilters,
  type GithubEventPayload,
} from '../ceremonies/gh-event-matcher.js';
import type { GithubEventTriggerFilters } from '../ceremonies/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pr(overrides: Partial<NonNullable<GithubEventPayload['pull_request']>> = {}): GithubEventPayload {
  return {
    event: 'pull_request',
    action: 'opened',
    pull_request: {
      additions: 10,
      deletions: 5,
      draft: false,
      user: { login: 'octocat' },
      base: { ref: 'main' },
      milestone: null,
      labels: [],
      ...overrides,
    },
  };
}

function review(state: 'approved' | 'changes_requested' | 'commented' | 'dismissed'): GithubEventPayload {
  return {
    event: 'pull_request_review',
    action: 'submitted',
    pull_request: { additions: 10, deletions: 5, draft: false, labels: [] },
    review: { state },
  };
}

function expectMatch(filters: GithubEventTriggerFilters, payload: GithubEventPayload) {
  const result = matchesGithubEventFilters(filters, payload);
  expect(result.matched, `Expected match but got reasons: ${result.reasons.join('; ')}`).toBe(true);
  expect(result.reasons).toEqual([]);
  return result;
}

function expectNoMatch(filters: GithubEventTriggerFilters, payload: GithubEventPayload, reasonSubstring?: string) {
  const result = matchesGithubEventFilters(filters, payload);
  expect(result.matched, `Expected no match but matched=true`).toBe(false);
  expect(result.reasons.length, 'Expected at least one reason').toBeGreaterThan(0);
  if (reasonSubstring) {
    const allReasons = result.reasons.join(' | ');
    expect(allReasons, `Expected reason to contain "${reasonSubstring}"`).toContain(reasonSubstring);
  }
  return result;
}

// ---------------------------------------------------------------------------
// labels (OR semantics)
// ---------------------------------------------------------------------------

describe('matchesGithubEventFilters — labels', () => {
  it('filter absent — any payload matches', () => {
    expectMatch({}, pr({ labels: [] }));
  });

  it('payload has matching label — matches (OR: one is enough)', () => {
    expectMatch(
      { labels: ['design', 'review-needed'] },
      pr({ labels: [{ name: 'review-needed' }] }),
    );
  });

  it('payload has none of the labels — no match', () => {
    expectNoMatch(
      { labels: ['design', 'review-needed'] },
      pr({ labels: [{ name: 'other-label' }] }),
      'labels:',
    );
  });

  it('payload labels empty, filter non-empty — no match', () => {
    expectNoMatch({ labels: ['design'] }, pr({ labels: [] }), 'labels:');
  });

  it('uses issue labels when no pull_request on payload', () => {
    const payload: GithubEventPayload = {
      event: 'issues',
      issue: { labels: [{ name: 'bug' }] },
    };
    expectMatch({ labels: ['bug'] }, payload);
  });
});

// ---------------------------------------------------------------------------
// prSize
// ---------------------------------------------------------------------------

describe('matchesGithubEventFilters — prSize', () => {
  it('filter absent — always matches', () => {
    expectMatch({}, pr({ additions: 1000, deletions: 1000 }));
  });

  it('+50/-30 = 80 lines, min:0 max:100 — matches', () => {
    expectMatch({ prSize: { min: 0, max: 100 } }, pr({ additions: 50, deletions: 30 }));
  });

  it('+50/-30 = 80 lines, min:100 — no match (below min)', () => {
    expectNoMatch({ prSize: { min: 100 } }, pr({ additions: 50, deletions: 30 }), 'below minimum of 100');
  });

  it('+50/-30 = 80 lines, max:50 — no match (exceeds max)', () => {
    expectNoMatch({ prSize: { max: 50 } }, pr({ additions: 50, deletions: 30 }), 'exceeds maximum of 50');
  });

  it('min only, exactly at min — matches', () => {
    expectMatch({ prSize: { min: 80 } }, pr({ additions: 50, deletions: 30 }));
  });

  it('max only, exactly at max — matches (inclusive)', () => {
    expectMatch({ prSize: { max: 80 } }, pr({ additions: 50, deletions: 30 }));
  });

  it('missing additions/deletions on payload — skip filter (matched=true, permissive)', () => {
    // prSize data unavailable → don't reject
    const payload: GithubEventPayload = {
      event: 'push',
      pull_request: { labels: [] }, // no additions/deletions
    };
    expectMatch({ prSize: { min: 100, max: 200 } }, payload);
  });

  it('no pull_request on payload — skip filter (matched=true)', () => {
    const payload: GithubEventPayload = { event: 'push' };
    expectMatch({ prSize: { min: 0, max: 10 } }, payload);
  });
});

// ---------------------------------------------------------------------------
// reviewState
// ---------------------------------------------------------------------------

describe('matchesGithubEventFilters — reviewState', () => {
  it('filter absent — always matches', () => {
    expectMatch({}, review('approved'));
  });

  it('review.state="approved", filter.in=[approved] — matches', () => {
    expectMatch({ reviewState: { in: ['approved'] } }, review('approved'));
  });

  it('review.state="changes_requested", filter.in=[approved,changes_requested] — matches', () => {
    expectMatch(
      { reviewState: { in: ['approved', 'changes_requested'] } },
      review('changes_requested'),
    );
  });

  it('review.state="commented", filter.in=[approved] — no match', () => {
    expectNoMatch(
      { reviewState: { in: ['approved'] } },
      review('commented'),
      'reviewState:',
    );
  });

  it('payload has no review object — no match with reason', () => {
    expectNoMatch(
      { reviewState: { in: ['approved'] } },
      pr(), // no review key
      'review state not present',
    );
  });
});

// ---------------------------------------------------------------------------
// milestone
// ---------------------------------------------------------------------------

describe('matchesGithubEventFilters — milestone', () => {
  it('filter absent — always matches', () => {
    expectMatch({}, pr({ milestone: { id: 1, title: 'v1.0.0' } }));
  });

  it('milestone.in: title matches one in list — matches', () => {
    expectMatch(
      { milestone: { in: ['v1.0.0', 'v1.1.0'] } },
      pr({ milestone: { id: 1, title: 'v1.0.0' } }),
    );
  });

  it('milestone.in: title not in list — no match', () => {
    expectNoMatch(
      { milestone: { in: ['v1.0.0', 'v1.1.0'] } },
      pr({ milestone: { id: 99, title: 'v2.0.0' } }),
      'milestone:',
    );
  });

  it('milestone.ids: id matches — matches', () => {
    expectMatch(
      { milestone: { ids: [101, 102] } },
      pr({ milestone: { id: 101, title: 'Sprint 1' } }),
    );
  });

  it('milestone.ids: id not in list — no match', () => {
    expectNoMatch(
      { milestone: { ids: [101, 102] } },
      pr({ milestone: { id: 999, title: 'Sprint 9' } }),
      'milestone:',
    );
  });

  it('payload milestone is null, filter set — no match', () => {
    expectNoMatch(
      { milestone: { in: ['v1.0.0'] } },
      pr({ milestone: null }),
      'no milestone',
    );
  });

  it('milestone on issue payload — uses issue.milestone', () => {
    const payload: GithubEventPayload = {
      event: 'issues',
      issue: { milestone: { id: 5, title: 'v1.0.0' } },
    };
    expectMatch({ milestone: { in: ['v1.0.0'] } }, payload);
  });
});

// ---------------------------------------------------------------------------
// author
// ---------------------------------------------------------------------------

describe('matchesGithubEventFilters — author', () => {
  it('filter absent — always matches', () => {
    expectMatch({}, pr({ user: { login: 'anyone' } }));
  });

  it('PR author in filter list — matches', () => {
    expectMatch({ author: { in: ['octocat'] } }, pr({ user: { login: 'octocat' } }));
  });

  it('PR author not in filter list — no match', () => {
    expectNoMatch(
      { author: { in: ['octocat', 'dependabot[bot]'] } },
      pr({ user: { login: 'other-user' } }),
      'author:',
    );
  });

  it('author comparison is case-sensitive (GitHub logins matched exactly)', () => {
    // "Octocat" ≠ "octocat" — compare exactly as provided
    expectNoMatch(
      { author: { in: ['octocat'] } },
      pr({ user: { login: 'Octocat' } }),
      'author:',
    );
  });

  it('login missing from payload — no match with reason', () => {
    expectNoMatch(
      { author: { in: ['octocat'] } },
      pr({ user: {} }),
      'login not present',
    );
  });

  it('uses issue.user.login when no pull_request', () => {
    const payload: GithubEventPayload = {
      event: 'issues',
      issue: { user: { login: 'octocat' } },
    };
    expectMatch({ author: { in: ['octocat'] } }, payload);
  });
});

// ---------------------------------------------------------------------------
// branch
// ---------------------------------------------------------------------------

describe('matchesGithubEventFilters — branch', () => {
  it('filter absent — always matches', () => {
    expectMatch({}, pr({ base: { ref: 'feature/x' } }));
  });

  it('base ref in filter list — matches', () => {
    expectMatch({ branch: { in: ['main', 'develop'] } }, pr({ base: { ref: 'main' } }));
  });

  it('base ref not in filter list — no match', () => {
    expectNoMatch(
      { branch: { in: ['main'] } },
      pr({ base: { ref: 'feature/new-thing' } }),
      'branch:',
    );
  });

  it('base ref missing from payload — no match with reason', () => {
    const payload: GithubEventPayload = { event: 'push' };
    expectNoMatch({ branch: { in: ['main'] } }, payload, 'base ref not present');
  });
});

// ---------------------------------------------------------------------------
// draft
// ---------------------------------------------------------------------------

describe('matchesGithubEventFilters — draft', () => {
  it('filter absent — always matches', () => {
    expectMatch({}, pr({ draft: true }));
  });

  it('draft.equals=true, payload.draft=true — matches', () => {
    expectMatch({ draft: { equals: true } }, pr({ draft: true }));
  });

  it('draft.equals=false, payload.draft=false — matches', () => {
    expectMatch({ draft: { equals: false } }, pr({ draft: false }));
  });

  it('draft.equals=true, payload.draft=false — no match', () => {
    expectNoMatch({ draft: { equals: true } }, pr({ draft: false }), 'draft:');
  });

  it('draft.equals=false, payload.draft=true — no match', () => {
    expectNoMatch({ draft: { equals: false } }, pr({ draft: true }), 'draft:');
  });

  it('draft field missing on non-PR event — no match with reason', () => {
    const payload: GithubEventPayload = { event: 'push' };
    expectNoMatch({ draft: { equals: false } }, payload, 'draft field not present');
  });
});

// ---------------------------------------------------------------------------
// Multi-filter: all pass / one fails / reasons accumulate
// ---------------------------------------------------------------------------

describe('matchesGithubEventFilters — multi-filter behavior', () => {
  it('all filters present and all match — matched=true', () => {
    expectMatch(
      {
        labels: ['review-needed'],
        prSize: { min: 0, max: 100 },
        reviewState: { in: ['approved'] },
        milestone: { in: ['v1.0.0'] },
        author: { in: ['octocat'] },
        branch: { in: ['main'] },
        draft: { equals: false },
      },
      {
        event: 'pull_request_review',
        pull_request: {
          additions: 30,
          deletions: 20,
          draft: false,
          user: { login: 'octocat' },
          base: { ref: 'main' },
          milestone: { id: 1, title: 'v1.0.0' },
          labels: [{ name: 'review-needed' }],
        },
        review: { state: 'approved' },
      },
    );
  });

  it('multiple filters present, one fails — matched=false with that reason', () => {
    const result = expectNoMatch(
      {
        labels: ['review-needed'],
        prSize: { min: 0, max: 10 }, // 50 lines → fail
        author: { in: ['octocat'] },
      },
      pr({
        additions: 40,
        deletions: 10,
        labels: [{ name: 'review-needed' }],
        user: { login: 'octocat' },
      }),
      'exceeds maximum of 10',
    );
    expect(result.reasons).toHaveLength(1);
  });

  it('multiple filters fail — reasons array contains ALL failures, not just first', () => {
    const result = matchesGithubEventFilters(
      {
        labels: ['needs-label'],
        prSize: { min: 1000 },  // 15 lines → fail
        author: { in: ['expected-user'] },
        branch: { in: ['release'] },
        draft: { equals: true },
      },
      pr({
        additions: 10,
        deletions: 5,
        labels: [],
        user: { login: 'octocat' },
        base: { ref: 'main' },
        draft: false,
      }),
    );
    expect(result.matched).toBe(false);
    // All 5 filters should fail
    expect(result.reasons.length).toBeGreaterThanOrEqual(5);
  });
});
