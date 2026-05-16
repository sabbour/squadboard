# Decision: Stream G Phase 1 — GitHub Integration Backend + UI

**Date:** 2026-05-15T22:42:29.855-07:00
**Author:** Verbal (Real-time / WebSocket Dev)
**Wave:** 16
**Status:** Accepted
**Relates to:** Stream G (GitHub integration) — Phase 1

---

## What shipped in Wave 16

### G1.3 — Branch naming convention

Convention: `squad/{agent-name-lowercased}/{slug-from-issue-title}`
Ceremony variant: `squad/ceremony/{ceremony-slug}-{run-id-suffix}`

Implementation in `packages/server/src/engine/workspace.ts`:
- `deriveSquadBranchName(agentName, issueTitle)` — exported pure function
- `assertSafeWorkspacePath(path)` — validates workspace is under `~/.squadboard/` or OS tmpdir
- `resolveWorkspace` extended with optional `opts.agentName + opts.issueTitle` to apply convention on worktree creation
- `stepper.ts` now passes `agent.name` and `issue.title` through

See `verbal-git-branch-convention.md` for full convention spec.

### G1.4 — Default PR template

File: `.github/PULL_REQUEST_TEMPLATE.md`

Sections:
- **Summary** — one paragraph description
- **Squad Context** — Agent, Ceremony/Run, Issue link
- **Test Plan** — verification steps
- **Risk** — checkbox tiers (No risk / Low / Medium / High)
- **Notes for the next agent** — handoff context

Pre-fill source map (applied by `buildPrBody()` in `routes/runs.ts`):
| Template field | Source |
|---|---|
| Agent | `agents.name` via `agentId` on the run |
| Ceremony / Run | `ad-hoc (run {runId[0..8]})` for direct runs; ceremony slug TBD in G3 |
| Branch | current HEAD branch of the worktree |
| Issue | left as placeholder — user fills in modal |

### G2.1 — Push branch (backend + UI)

**Endpoint:** `POST /api/projects/:projectId/runs/:runId/git/push`

Request: no body required.

Response 200:
```json
{
  "branch": "squad/verbal/push-branch-ui",
  "branchUrl": "https://github.com/owner/repo/tree/squad/verbal/push-branch-ui",
  "pushOutput": "Branch 'squad/verbal/push-branch-ui' set up to track remote branch…"
}
```

Response errors: 404 (run not found), 422 (not a worktree run / protected branch / unsafe path), 403 (path outside allowed roots), 500 (git push failed with detail).

Safety guards:
- `assertSafeWorkspacePath` — workspace must be under `~/.squadboard/` or OS tmpdir
- `PROTECTED_BRANCHES = {'main','master','develop','trunk'}` — hard-blocked
- `sanitizeBranchName` — rejects anything outside `[a-zA-Z0-9/_.-]`
- `timeout: 30_000 ms` on all `execFile` calls
- On failure, git stderr is surfaced verbatim to the client (not swallowed)

**WS event emitted:** `git.push.complete`
```json
{
  "type": "git.push.complete",
  "projectId": "...",
  "payload": {
    "runId": "...",
    "branch": "squad/verbal/push-branch-ui",
    "branchUrl": "https://github.com/...",
    "pushOutput": "..."
  }
}
```

**UI:** `GitActions.tsx` added to the RunOutputPanel footer (worktree runs only).
Button states: `↑ Push branch` → `Pushing…` → `✓ Pushed · {branch link}` (or `✗ Push failed`).

### G2.2 — Create PR (backend + UI)

**Endpoint:** `POST /api/projects/:projectId/runs/:runId/git/pr`

Request body (all optional):
```json
{
  "title": "optional override title",
  "body": "optional override body",
  "draft": false
}
```

Response 200:
```json
{
  "prUrl": "https://github.com/owner/repo/pull/42",
  "prNumber": 42
}
```

Response errors: same 4xx/5xx pattern as push endpoint.

Implementation: shells out to `gh pr create --title ... --body ...`. Requires `gh auth status` to be working (same assumption as the daemon's git-push helpers from W14).

**WS event emitted:** `git.pr.created`
```json
{
  "type": "git.pr.created",
  "projectId": "...",
  "payload": {
    "runId": "...",
    "branch": "squad/verbal/push-branch-ui",
    "prUrl": "https://github.com/owner/repo/pull/42",
    "prNumber": 42
  }
}
```

**UI:** After push succeeds, a `⎇ Create PR` button appears. Clicking opens a modal (560px wide) with editable Title + Body (pre-filled from `buildPrBody()`). Submit calls the endpoint; result shows `✓ PR #42` with link.

---

## Files changed

| File | Change |
|---|---|
| `packages/server/src/engine/workspace.ts` | `deriveSquadBranchName`, `assertSafeWorkspacePath`, opts on `resolveWorkspace`, robust branch cleanup |
| `packages/server/src/engine/stepper.ts` | Pass `agent.name + issue.title` to `resolveWorkspace` |
| `packages/server/src/realtime/event-bus.ts` | `GitEventType`, `emitGitEvent` |
| `packages/server/src/routes/runs.ts` | `POST /:runId/git/push`, `POST /:runId/git/pr`, `buildPrBody` |
| `packages/client/src/realtime/ws-client.ts` | `git.push.complete` + `git.pr.created` in `WsEventMap` |
| `packages/client/src/api/git.ts` | `usePushBranch`, `useCreatePr` mutation hooks |
| `packages/client/src/components/runs/GitActions.tsx` | Push button + PR modal component |
| `packages/client/src/components/runs/RunOutputPanel.tsx` | Imports and renders `<GitActions>` in footer |
| `.github/PULL_REQUEST_TEMPLATE.md` | Default PR template |

---

## Phase 2 queue (W17+)

- **G3 — MCP tool wrappers:** `github_push_branch`, `github_open_pr` MCP tools wrapping these endpoints so the dogfood CLI can drive the same flow.
- **G4 — Copilot watch:** Watch for @copilot-authored draft PRs linked to board cards; move card to `in_review` on PR open.
- **G6 — Webhook expansion:** Add handlers for `push`, `pull_request`, `workflow_run`, `check_run` events; trigger ceremony runs via YAML `triggers:` schema.
- **PR template ceremony pre-fill:** When a run is spawned from a ceremony workflow, include the ceremony slug + run ID in the pre-filled body (requires ceremony context on the run row).
