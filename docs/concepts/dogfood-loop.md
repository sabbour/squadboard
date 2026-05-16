# The Squadboard Dogfood Loop

> "We build Squadboard with Squadboard."

This document describes the end-to-end cycle by which work captured in the
Squadboard inbox flows through an AI agent, lands on GitHub, and feeds
information back into the next agent invocation — closing the loop.

---

## Overview

```
Ahmed (human)
  │
  │  "capture: <feature/bug description>"
  ▼
Squadboard Inbox
  │  (POST /api/inbox, MCP `capture` tool, or CLI)
  │
  ▼
Conjure classifier
  │  classifies intent, drafts issue body
  │
  ▼
Issue created in Squadboard project
  │
  ▼
Routing engine (3-tier)
  │  Tier 1: keyword match
  │  Tier 2: scored rules
  │  Tier 3: LLM routing
  │
  ▼
Ceremony dispatcher
  │  selects ceremony + agent from routing.md
  │  creates issue_runs row (status=pending)
  │
  ▼
Agent invocation
  │  Agent reads issue body + external_gh_context
  │  (external_gh_context contains recent GH events — see G6.6)
  │  Agent works: writes code, commits, pushes
  │
  ▼
GitHub (optional)
  │  git push → opens PR
  │  PR reviewed / merged
  │  Workflow dispatched / completed
  │
  ▼
GitHub Webhook → POST /api/projects/:id/github/webhook
  │  Signature-validated (G6.4)
  │  Persisted to github_events table
  │  Re-emitted on internal event bus
  │  Card-state side effects applied (G6.3):
  │    PR opened  → card moves to semantic='in_review'
  │    PR merged  → card moves to semantic='done', deliverable_status='accepted'
  │    Label 'blocked' → card moves to semantic='blocked'
  │
  └─► enrichRunExternalContext (G6.6)
        │  finds active issue_runs tied to the GH issue/PR
        │  appends event to issue_runs.external_gh_context
        │
        ▼
      Next agent invocation sees:
        issue body + prior output + recent GH events
        → agent is fully contextualised without manual handoff
```

---

## Key phases

### 1. Capture (`squadboard inbox capture`)

Ahmed writes a task description. The Conjure classifier converts it to a
structured issue body (title, acceptance criteria, size estimate). The issue
lands in the project backlog.

**Relevant code:**
- `packages/server/src/routes/inbox.ts` — `POST /api/inbox`
- `packages/server/src/services/conjure-classifier.ts`
- `packages/server/src/mcp/server.ts` — `capture` MCP tool

---

### 2. Routing → Ceremony → Run

The routing engine reads `routing.md` (per-project) and assigns the issue to an
agent and ceremony. The ceremony dispatcher creates an `issue_runs` row and
hands off to the agent executor.

**Relevant code:**
- `packages/server/src/engine/router.ts`
- `packages/server/src/services/ceremony-dispatcher.ts`
- `packages/server/src/services/ceremony-scheduler.ts`

---

### 3. Agent execution

The agent (e.g. Verbal, Hockney, Keyser) reads the issue body and any
`external_gh_context` already attached to the run. It works, commits, and
optionally pushes a branch or opens a PR using the git-ops helpers.

**Relevant code:**
- `packages/server/src/services/github-git-ops.ts` — `pushBranch`, `createPr`,
  `dispatchWorkflow`, `pollWorkflowRun` (G1.1), `listWorkflows`,
  `getDefaultBranch`, `listBranches`, `whoAmI` (G1.2)
- MCP tools: `github_push_branch`, `github_open_pr`, `github_dispatch_workflow`,
  `github_poll_workflow_run`, `github_list_workflows`, `github_get_default_branch`,
  `github_list_branches`, `github_whoami`

---

### 4. GitHub events loop back (G6.6)

When GitHub fires a webhook (PR opened, PR merged, issue labeled, push, workflow
completed), the webhook handler:

1. Validates the signature (HMAC-SHA256 against project secret).
2. Persists the raw event to `github_events`.
3. Re-emits on the internal event bus.
4. Applies card-state side effects (G6.3, see below).
5. Calls `enrichRunExternalContext`:
   - Finds `issue_runs` rows for the referenced GH issue/PR that are still
     `pending` or `running`.
   - Appends a lightweight event summary to `issue_runs.external_gh_context`
     (JSONB, capped at 20 events, oldest dropped first).
   - On the **next** invocation, the agent runtime prepends these events to the
     prompt context so the agent sees: _"A PR was opened for this issue 10 min
     ago."_ or _"CI failed on the branch 2 min ago."_

**Relevant code:**
- `packages/server/src/routes/github-sync.ts` — webhook handler, `enrichRunExternalContext`
- DB column: `issue_runs.external_gh_context` (JSONB)

---

### 5. Card-state side effects (G6.3)

Configurable rules in `gh_card_side_effects` table drive automatic card
transitions when webhook events arrive:

| Event                          | Effect                                           |
|-------------------------------|--------------------------------------------------|
| `pull_request.opened`          | Move referenced card to `semantic='in_review'`   |
| `pull_request.closed` (merged) | Move card to `semantic='done'`, `deliverable_status='accepted'` |
| `issues.labeled` with `blocked` | Move card to `semantic='blocked'`               |
| `issues.labeled` with `bug`   | Badge marker (UI only, no semantic change)       |

Rules are idempotent (no-op if already in target state) and configurable:
disable or add new rules by toggling the `enabled` flag in `gh_card_side_effects`.

---

### 6. GitHub Activity Feed (G6.5)

`GET /api/projects/:id/github/activity` returns a cursor-paginated feed of
events from `github_events` joined with `issue_runs` git state. The
`GitHubActivityFeed` React component renders this in the Settings page under
**GitHub → GitHub Activity**.

---

## Sequence diagram (compact)

```
Human  →  Inbox  →  Issue  →  Router  →  Ceremony  →  Agent
                                                         │
                                                    git push / PR
                                                         │
                                                    GitHub Webhook
                                                         │
                                           ┌─────────────┴──────────────┐
                                           │ Card side-effects (G6.3)   │
                                           │ Enrich run context (G6.6)  │
                                           └─────────────┬──────────────┘
                                                         │
                                                  Next agent turn
                                              (sees webhook events)
```

---

## Follow-ups / known gaps

- **Real-time feed**: the activity endpoint is polling-based; a future item could
  push events via WebSocket using the existing `event-bus`.
- **Context window limits**: `external_gh_context` is capped at 20 events to
  avoid large prompts; a summarisation step could help for long-lived issues.
- **Dogfood project bootstrap**: the Squadboard project itself is not yet
  mirrored to GitHub — that wiring (setting `githubSyncEnabled=true` + webhook)
  completes the loop from spec to GitHub.

---

_Last updated: 2026-05-16 (Wave 21, Stream G closure)_
