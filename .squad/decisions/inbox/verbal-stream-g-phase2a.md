# Decision: Stream G Phase 2A — Comment + Merge PR + Card Badges

**Date:** 2026-05-15T22:42:29.855-07:00  
**Author:** Verbal (Real-time / WebSocket Dev)  
**Wave:** 17  
**Status:** Accepted  
**Relates to:** Stream G (GitHub integration) — Phase 2, Chunk A  

---

## Deliverables shipped

### G2.3 — Comment on linked GitHub issue

**Endpoint:** `POST /api/projects/:projectId/runs/:runId/git/comment`

Request body:
```json
{ "issueNumber": 42, "body": "Run completed. Output: …" }
```

Response 200:
```json
{ "commentUrl": "https://github.com/owner/repo/issues/42#issuecomment-…", "issueNumber": 42 }
```

Response errors: 400 (missing/invalid body or issueNumber), 500 (gh CLI failure with verbatim detail).

**Safety:**
- Body sanitized with `sanitizeCommentBody()` — strips null bytes and ANSI escape sequences.
- Body passed to `gh` via **stdin** (`--body-file -`), not as a shell argument. This is the correct pattern for arbitrary user content and prevents shell injection regardless of content.
- 30 s timeout (`GIT_TIMEOUT_MS`).
- `issueNumber` validated as positive integer before use.

**WS event:** `git.comment.posted`
```json
{
  "type": "git.comment.posted",
  "projectId": "…",
  "payload": { "runId": "…", "commentUrl": "https://…#issuecomment-…", "issueNumber": 42 }
}
```

**UI:** "💬 Comment on issue" button in Run Drawer footer when `linkedIssueNumber` is set. Opens a modal pre-filled with `lastSummary` (the run's last output summary). Issues their `githubIssueNumber` is resolved by the parent that renders `<GitActions>`.

---

### G2.5 — Merge PR

**Endpoint:** `POST /api/projects/:projectId/runs/:runId/git/pr/merge`

Request body:
```json
{ "method": "squash" }   // "merge" | "squash" | "rebase" — default "squash"
```

**Default merge method: `squash`.** Rationale: squash keeps `main` history linear, makes reverts clean (one commit per feature), and is the GitHub default for Squad-style micro-PRs. Users can override via the menu.

Response 200:
```json
{ "prUrl": "https://github.com/…/pull/42", "sha": "abc123…", "method": "squash" }
```

Response 409:
```json
{ "error": "Required CI checks are failing or still running — cannot merge.", "checks": "…verbatim gh output…" }
```

Response errors: 404 (run not found), 403 (unsafe workspace), 422 (no PR found / no workspace), 500 (gh pr merge failed with verbatim detail).

**PR number discovery** (ordered):
1. `issueRuns.prNumber` — cached by the `git/pr` create endpoint.
2. `gh pr view --json number,url,state` on the worktree branch — resolved and cached on the run record.

**CI gate:**  
`gh pr checks <number> --required` is called before merge. If it exits non-zero (checks failing or still pending), return 409 with the check output verbatim. This respects branch protection rules natively — `gh pr merge` will also fail naturally if branch protection blocks it.

**WS event:** `git.pr.merged`
```json
{
  "type": "git.pr.merged",
  "projectId": "…",
  "payload": { "runId": "…", "prUrl": "https://…/pull/42", "sha": "abc123…", "method": "squash" }
}
```

**UI:** After PR is created (`prState.phase === 'done'`), a split-button appears: primary action "⤴ Merge PR" (squash), dropdown reveals "Create a merge commit" and "Rebase and merge". Shows "Merging (squash)…" → "✓ Merged" with PR link.

**Post-merge card automation:** `git.pr.merged` is emitted. Moving the linked card to a "done" column based on `column_meta.is_done: true` is deferred — coordinate with Hockney's column model in W18. The WS event carries all necessary data for Hockney to pick up in a follow-up PR.

---

### G2.6 — Card GitHub Badges

**Data shape per card** (added to `GET /api/projects/:id/issues` response):

```json
{
  "github": {
    "branch": "squad/verbal/use-template",
    "branchUrl": "https://github.com/…/tree/squad/verbal/use-template",
    "pr": { "number": 42, "state": "open", "url": "https://github.com/…/pull/42" },
    "ci": { "state": "passing", "url": "https://…" }
  }
}
```

`github` is `null` when no worktree run with git data exists for the issue.

**Data source:** `issue_runs` table — most recent worktree run per issue with `git_branch IS NOT NULL`. Uses `DISTINCT ON (issue_id)` raw SQL (more efficient than a lateral join for this pattern).

**PR state values:** `open` | `draft` | `merged` | `closed`  
**CI state values:** `passing` | `failing` | `running` | `unknown`

**Schema additions to `issue_runs`:**
| Column | Type | Purpose |
|---|---|---|
| `git_branch` | TEXT | pushed branch name |
| `git_branch_url` | TEXT | GitHub tree URL |
| `pr_number` | INTEGER | cached from `gh pr create` or `gh pr view` |
| `pr_url` | TEXT | GitHub PR HTML URL |
| `pr_state` | TEXT | `open`/`draft`/`merged`/`closed` |
| `ci_state` | TEXT | `passing`/`failing`/`running`/`unknown` |
| `ci_url` | TEXT | URL to CI check run |
| `git_cache_refreshed_at` | TIMESTAMPTZ | last time CI was refreshed from gh |

**Cache invalidation strategy:**
- `git.push.complete` → `gitBranch` + `gitBranchUrl` written to run by push endpoint.
- `git.pr.created` → `prNumber` + `prUrl` + `prState='open'` written to run by PR endpoint.
- `git.pr.merged` → `prState='merged'` written to run by merge endpoint.
- **5-minute soft TTL for CI:** `listIssues` checks `git_cache_refreshed_at` per run; if age > 5 min and PR is open, spawns a fire-and-forget `refreshCiState()` task that calls `gh pr checks --json name,state,conclusion` and updates `ciState` + `gitCacheRefreshedAt`. Next `listIssues` call picks up the refreshed value.

**UI badges** (in `IssueCard.tsx`):
- Branch badge: `🌿 squad/verbal/use-template` (truncated at 20 chars, full name on hover) — links to GitHub tree URL.
- PR badge: `🔀 PR #42 · open|draft|merged|closed` — color per state (green/muted/purple/red matching Fluent2 color semantics).
- CI badge: `✅ CI passing` / `⚠️ CI failing` / `⏳ CI running` / `⚪ CI unknown` — links to CI URL.
- All badges are links opening GitHub URL in new tab. Click on badge does not propagate to card-open handler.

---

## Files changed

| File | Change |
|---|---|
| `packages/server/src/db/schema.ts` | Added 8 git-cache columns to `issueRuns` table definition |
| `packages/server/src/db/index.ts` | Wave 17 migration block: `ALTER TABLE issue_runs ADD COLUMN IF NOT EXISTS git_branch …` (8 columns) |
| `packages/server/src/realtime/event-bus.ts` | Added `git.comment.posted`, `git.pr.merged` to `GitEventType` |
| `packages/server/src/routes/runs.ts` | (1) `sanitizeCommentBody()` helper; (2) push endpoint now persists `gitBranch`/`gitBranchUrl`; (3) PR endpoint now persists `prNumber`/`prUrl`/`prState`; (4) `POST /:runId/git/comment` (G2.3); (5) `POST /:runId/git/pr/merge` (G2.5) |
| `packages/server/src/services/issues.ts` | `listIssues` now batch-fetches git data from most-recent worktree run per issue; `GitHubBlock` interface exported; `refreshCiState()` fire-and-forget background refresh |
| `packages/client/src/realtime/ws-client.ts` | Added `git.comment.posted`, `git.pr.merged` to `WsEventMap` |
| `packages/client/src/api/git.ts` | Added `CommentResult`, `MergeResult`, `MergeMethod` types; `useCommentOnIssue`, `useMergePr` hooks |
| `packages/client/src/api/issues.ts` | `Issue.github` optional block added |
| `packages/client/src/components/runs/GitActions.tsx` | Comment modal (G2.3) + Merge PR split-button with method picker (G2.5) + WS fast-path for all 4 git events |
| `packages/client/src/components/board/IssueCard.tsx` | `GitHubBadges` component + rendering below labels (G2.6) |

---

## Open questions for Chunk B (W18+)

### G4 — Copilot watch
- What is the webhook shape for `@copilot` PR authorship? The `pull_request.opened` event has `user.login = 'github-copilot[bot]'` — is that stable?
- Should card move to `in_review` on PR *open* or on PR *ready for review* (draft → ready event)?
- Auth model: does the GitHub App installation need `pull_request:write`?

### G6.1/G6.2 — Webhook expansion
- The `gh` CLI webhook forwarding (`gh webhook forward`) is only available with GitHub Apps, not PAT auth. Do we plan to switch auth type in W18?
- The `triggers:` YAML schema for ceremony workflows — should it live on `workflow_versions.steps_json` or as a separate `trigger_rules` table? Hockney needs to decide.
- Rate limit: `check_run` events can be very high-frequency. Should we debounce before emitting `git.ci.updated` on the WS channel?

### G2.5 post-merge card automation
- Coordinate with Hockney: `column_meta.is_done` flag needed for automatic card move on `git.pr.merged`. The WS event already carries `runId` so Hockney can look up the issue and move it. Emit the WS event in W17; add the server-side card move in W18 once Hockney confirms the column model.

### CI URL
- `gh pr checks --json name,state,conclusion` does not return the per-check URL in all GH API versions. May need `--json name,state,conclusion,link` (newer API). Field is stored as nullable `ciUrl` — safe to omit if unavailable.
