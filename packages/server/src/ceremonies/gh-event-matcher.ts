/**
 * gh-event-matcher.ts — CER-5 (W29): Pure function that evaluates github-event
 * trigger filters against a GitHub event payload.
 *
 * Design decisions:
 *  - labels: OR semantics — payload must contain AT LEAST ONE of the listed labels
 *    (mirrors CER-3 spec: "PR/issue must have at least one matching label").
 *  - paths: NOT evaluated here. Path matching requires diff inspection and is
 *    handled by the trigger router elsewhere. This function skips paths silently.
 *  - prSize missing data: if the payload lacks additions/deletions fields, the
 *    prSize filter is skipped (matched=true). This is permissive by design —
 *    avoid false rejections when the GH API omits these fields (e.g., push events).
 *  - author case sensitivity: GitHub logins are matched exactly as provided.
 *    GitHub itself treats logins case-insensitively, but we compare as-is to
 *    avoid silent surprises. Users should normalize casing in their YAML.
 *  - All failures are collected (not short-circuited) so the reasons array
 *    contains every failing filter, not just the first.
 */

import type { GithubEventTriggerFilters } from './types.js';

/**
 * Minimal shape of the GitHub event payload we care about.
 * Does not depend on @octokit/types — self-contained.
 */
export interface GithubEventPayload {
  event: string;
  action?: string;
  pull_request?: {
    additions?: number;
    deletions?: number;
    draft?: boolean;
    user?: { login?: string };
    base?: { ref?: string };
    milestone?: { id?: number; title?: string } | null;
    labels?: Array<{ name: string }>;
    changed_files?: number;
    head?: { ref?: string };
  };
  review?: {
    state?: 'approved' | 'changes_requested' | 'commented' | 'dismissed';
  };
  issue?: {
    user?: { login?: string };
    milestone?: { id?: number; title?: string } | null;
    labels?: Array<{ name: string }>;
  };
  changes?: unknown;
}

export interface MatchResult {
  matched: boolean;
  /** Human-readable reasons when matched=false. Contains ALL failures (not just first). */
  reasons: string[];
}

/**
 * Evaluate all applicable filters in `filters` against `payload`.
 * Returns {matched: true, reasons: []} when all filters pass,
 * or {matched: false, reasons: [...]} listing every filter that failed.
 */
export function matchesGithubEventFilters(
  filters: GithubEventTriggerFilters,
  payload: GithubEventPayload,
): MatchResult {
  const reasons: string[] = [];

  // -------------------------------------------------------------------------
  // labels — OR semantics: payload must have at least one of the listed labels
  // -------------------------------------------------------------------------
  if (filters.labels !== undefined && filters.labels.length > 0) {
    const payloadLabels =
      payload.pull_request?.labels?.map((l) => l.name) ??
      payload.issue?.labels?.map((l) => l.name) ??
      [];
    const hasMatch = filters.labels.some((label) => payloadLabels.includes(label));
    if (!hasMatch) {
      reasons.push(
        `labels: payload has [${payloadLabels.join(', ')}], expected at least one of [${filters.labels.join(', ')}]`,
      );
    }
  }

  // -------------------------------------------------------------------------
  // paths — skipped; evaluated by the trigger router (requires diff inspection)
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // prSize — additions + deletions vs min/max
  // Missing data → skip (permissive; see file header).
  // -------------------------------------------------------------------------
  if (filters.prSize !== undefined) {
    const { min, max } = filters.prSize;
    const additions = payload.pull_request?.additions;
    const deletions = payload.pull_request?.deletions;
    if (additions !== undefined && deletions !== undefined) {
      const total = additions + deletions;
      if (min !== undefined && total < min) {
        reasons.push(`prSize: ${total} lines changed is below minimum of ${min}`);
      }
      if (max !== undefined && total > max) {
        reasons.push(`prSize: ${total} lines changed exceeds maximum of ${max}`);
      }
    }
    // If additions/deletions are missing, skip filter (permissive — see header)
  }

  // -------------------------------------------------------------------------
  // reviewState — review.state must be in the listed values
  // -------------------------------------------------------------------------
  if (filters.reviewState !== undefined) {
    const state = payload.review?.state;
    if (state === undefined) {
      reasons.push(
        `reviewState: review state not present in payload (event may not be a pull_request_review event)`,
      );
    } else if (!filters.reviewState.in.includes(state)) {
      reasons.push(
        `reviewState: "${state}" is not in [${filters.reviewState.in.join(', ')}]`,
      );
    }
  }

  // -------------------------------------------------------------------------
  // milestone — match by title (in) OR by id (ids), mutually exclusive
  // -------------------------------------------------------------------------
  if (filters.milestone !== undefined) {
    const ms =
      payload.pull_request?.milestone ?? payload.issue?.milestone ?? null;

    if (ms === null || ms === undefined) {
      reasons.push('milestone: payload has no milestone set');
    } else {
      if (filters.milestone.in !== undefined) {
        if (ms.title === undefined || !filters.milestone.in.includes(ms.title)) {
          reasons.push(
            `milestone: title "${ms.title ?? '(none)'}" is not in [${filters.milestone.in.join(', ')}]`,
          );
        }
      } else if (filters.milestone.ids !== undefined) {
        if (ms.id === undefined || !filters.milestone.ids.includes(ms.id)) {
          reasons.push(
            `milestone: id ${ms.id ?? '(none)'} is not in [${filters.milestone.ids.join(', ')}]`,
          );
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // author — PR or issue author login (exact, case-sensitive)
  // -------------------------------------------------------------------------
  if (filters.author !== undefined) {
    const login =
      payload.pull_request?.user?.login ?? payload.issue?.user?.login;
    if (login === undefined) {
      reasons.push('author: login not present in payload');
    } else if (!filters.author.in.includes(login)) {
      reasons.push(
        `author: "${login}" is not in [${filters.author.in.join(', ')}]`,
      );
    }
  }

  // -------------------------------------------------------------------------
  // branch — pull_request.base.ref must be in the listed branch names
  // -------------------------------------------------------------------------
  if (filters.branch !== undefined) {
    const baseRef = payload.pull_request?.base?.ref;
    if (baseRef === undefined) {
      reasons.push('branch: base ref not present in payload (event may not be a pull_request event)');
    } else if (!filters.branch.in.includes(baseRef)) {
      reasons.push(
        `branch: "${baseRef}" is not in [${filters.branch.in.join(', ')}]`,
      );
    }
  }

  // -------------------------------------------------------------------------
  // draft — pull_request.draft must equal `equals`
  // -------------------------------------------------------------------------
  if (filters.draft !== undefined) {
    const draft = payload.pull_request?.draft;
    if (draft === undefined) {
      reasons.push('draft: draft field not present in payload (event may not be a pull_request event)');
    } else if (draft !== filters.draft.equals) {
      reasons.push(
        `draft: payload draft=${draft}, filter requires draft=${filters.draft.equals}`,
      );
    }
  }

  return { matched: reasons.length === 0, reasons };
}
