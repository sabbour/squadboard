# verbal-w21-stream-g-close

**Date:** 2026-05-16T00:50:00-07:00  
**Wave:** 21  
**Agent:** Verbal (integrations/back-end)  
**Status:** ✅ All five items shipped

---

## G1.1 — Workflow dispatch + run polling helpers

**Files touched:**
- `packages/server/src/services/github-git-ops.ts` — added `dispatchWorkflow()`,
  `pollWorkflowRun()`, two new error codes (`workflow_poll_timeout`, `introspection_failed`)
- `packages/server/src/mcp/server.ts` — added MCP tools `github_dispatch_workflow`,
  `github_poll_workflow_run` with handler functions
- `packages/server/src/routes/runs.ts` — added
  `GET /:runId/git/workflow/poll/:workflowRunId` HTTP endpoint with project-config
  resolution and WS event emission
- `packages/server/src/realtime/event-bus.ts` — added `git.workflow.polled` to
  `GitEventType` union

**Summary:**
`dispatchWorkflow` is a typed wrapper around the existing `triggerWorkflow` with
explicit `owner/repo/workflow_file/ref/inputs`. `pollWorkflowRun` polls every 5 s
(exponential backoff capped at 15 s) until `status === 'completed'` or timeout.

---

## G1.2 — Repo introspection helpers

**Files touched:**
- `packages/server/src/services/github-git-ops.ts` — added `listWorkflows()`,
  `getDefaultBranch()`, `listBranches()`, `whoAmI()`
- `packages/server/src/mcp/server.ts` — added MCP tools `github_list_workflows`,
  `github_get_default_branch`, `github_list_branches`, `github_whoami`
- `packages/server/src/routes/system.ts` — added HTTP endpoints:
  - `GET /api/system/github/whoami`
  - `GET /api/system/github/workflows?owner=&repo=`
  - `GET /api/system/github/default-branch?owner=&repo=`
  - `GET /api/system/github/branches?owner=&repo=&head=`

**Summary:**
All four functions shell to the `gh` CLI (respects `GH_BIN_OVERRIDE`). System-level
endpoints are mounted under `/api/system/github/...` so the Settings UI can query
them without going through MCP. No auth plumbing needed — `gh` uses the user's
existing session.

---

## G6.3 — Default card-state side-effects from GH events

**Files touched:**
- `packages/server/src/db/schema.ts` — new `ghCardSideEffects` table definition
- `packages/server/src/db/index.ts` — migration + `seedGhCardSideEffects()` (4
  default rules, idempotent `ON CONFLICT DO NOTHING`)
- `packages/server/src/routes/github-sync.ts` — `applyCardSideEffects()` helper
  called from webhook handler for `pull_request.opened`, `pull_request.closed`
  (merged), `issues.labeled`

**Rules seeded:**

| Event | Effect |
|-------|--------|
| `pull_request.opened` (PR body refs `#NNN`) | Move card → `semantic='in_review'` |
| `pull_request.closed` + merged | Move card → `semantic='done'`, `deliverable_status='accepted'` |
| `issues.labeled` / label=`blocked` | Move card → `semantic='blocked'` |
| `issues.labeled` / label=`bug` | Badge (UI marker, no semantic change) |

All rules are idempotent (`WHERE status IS DISTINCT FROM $target`), configurable
via `enabled` flag, and extensible (add rows to `gh_card_side_effects`).

---

## G6.5 — GitHub activity timeline UI

**Files touched:**
- `packages/server/src/routes/github-sync.ts` — `GET /api/projects/:id/github/activity`
  cursor-paginated endpoint (joins `github_events` + `issue_runs`, page size 25,
  max 100)
- `packages/client/src/components/GitHubActivityFeed.tsx` — new component:
  avatar + actor + event label + relative time + link; load-more button
- `packages/client/src/pages/Settings.tsx` — imported `GitHubActivityFeed`,
  rendered under the GitHub section with a "GitHub Activity" sub-header

**API shape:**
```json
GET /api/projects/:id/github/activity[?cursor=ISO&limit=N]
→ { items: ActivityItem[], nextCursor: string | null }
```

---

## G6.6 — Coordinator dogfood-loop closure on GH events

**Files touched:**
- `packages/server/src/db/index.ts` — `ALTER TABLE issue_runs ADD COLUMN IF NOT EXISTS external_gh_context JSONB` (Wave 21 migration block)
- `packages/server/src/db/schema.ts` — schema annotation comment for `external_gh_context`
- `packages/server/src/routes/github-sync.ts` — `enrichRunExternalContext()` called
  async from webhook handler; appends lightweight event to active `issue_runs`,
  capped at 20 events
- `docs/concepts/dogfood-loop.md` — NEW file: end-to-end diagram + phase breakdown
  of the capture → routing → ceremony → run → GH push → webhook → context loop

---

## Remaining gaps / follow-ups

1. **Real-time activity feed**: the `GET /api/projects/:id/github/activity`
   endpoint is poll-based. A future item should push new events via WebSocket
   (the bus already emits `github.*` events — add a WS subscriber).

2. **external_gh_context agent surface**: `enrichRunExternalContext` writes to
   the DB, but the agent executor prompt builder doesn't yet read this column.
   A follow-up item should prepend `external_gh_context.events` to the agent
   system prompt (or append to the issue body context).

3. **Dogfood project bootstrap**: the Squadboard project itself needs
   `githubSyncEnabled=true` + webhook configured to close the loop from code
   merge to board update.

4. **G6.3 bug label UI badge**: the "bug" rule has no semantic change; the
   actual badge render in `IssueCard.tsx` is a future UI item (Keyser lane).
