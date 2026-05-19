# The Squadboard Dogfood Loop

> "We build Squadboard with Squadboard."

This document describes the end-to-end cycle by which work captured in the
Squadboard inbox flows through durable routing, agent execution, GitHub, Scribe
close-out, and decision memory — closing the loop.

---

## Overview

```
Ahmed (human)
  │
  │  "capture: <feature/bug description>"
  ▼
Squadboard Inbox + .squad/decisions/inbox
  │  (POST /api/inbox, directive capture API, MCP `capture` tool, or CLI)
  │
  ▼
Conjure classifier
  │  classifies intent, drafts issue body
  │
  ▼
Issue created in Squadboard project
  │
  ▼
Coordinator
  │  deterministic prefilters + bounded LLM routing
  │
  ▼
Ceremony dispatcher
  │  selects ceremony + agent from routing.md
  │  creates issue_runs row (status=pending)
  │
  ▼
Agent invocation
  │  Agent receives spawn prompt with charter, team root, decisions/history,
  │  skills, MCP context, workspace path/mode, and external_gh_context
  │  Agent works: writes code, commits, pushes
  │
  ▼
GitHub + Ralph monitor (optional)
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
  └─► enrichRunExternalContext + Scribe close-out
        │  finds active issue_runs tied to the GH issue/PR
        │  appends event to issue_runs.external_gh_context
        │
        ▼
      Next agent invocation sees:
        issue body + prior output + recent GH events + decision memory
        → agent is fully contextualised without manual handoff
```

---

## Key phases

### 1. Capture (`squadboard inbox capture`, directive capture, or MCP)

Ahmed writes a task description or implementation directive. The Conjure
classifier converts issue-like work to a structured card, while directive
capture can also write idempotent markdown into `.squad/decisions/inbox/`.

**Relevant code:**
- `packages/server/src/routes/inbox.ts` — `POST /api/inbox`
- `packages/server/src/services/conjure-classifier.ts`
- `packages/server/src/services/directive-capture.ts` — decision inbox files and idempotency
- `packages/server/src/mcp/server.ts` — `capture` MCP tool

---

### 2. Routing → Ceremony → Run

The coordinator builds a real input from labels, parent links, priority,
project rules, agent capabilities, and recent run state. Deterministic
prefilters handle concrete rules before the LLM is asked for semantic role fit.
The ceremony dispatcher creates an `issue_runs` row and hands off to the agent
executor.

**Relevant code:**
- `packages/server/src/coordinator/input-builder.ts`
- `packages/server/src/coordinator/prefilters.ts`
- `packages/server/src/services/coordinator-routing-log.ts`
- `packages/server/src/services/ceremony-dispatcher.ts`
- `packages/server/src/services/ceremony-scheduler.ts`

---

### 3. Agent execution

The agent (e.g. Verbal, Hockney, Keyser) receives the issue, charter, team root,
requester, workspace path/mode, decision/history instructions, assigned skills,
MCP context, validation expectations, and any `external_gh_context` already
attached to the run. It works, commits, and optionally pushes a branch or opens
a PR using the git-ops helpers.

**Relevant code:**
- `packages/server/src/services/github-git-ops.ts` — `pushBranch`, `createPr`,
  `dispatchWorkflow`, `pollWorkflowRun` (G1.1), `listWorkflows`,
  `getDefaultBranch`, `listBranches`, `whoAmI` (G1.2)
- MCP tools: `github_push_branch`, `github_open_pr`, `github_dispatch_workflow`,
  `github_poll_workflow_run`, `github_list_workflows`, `github_get_default_branch`,
  `github_list_branches`, `github_whoami`
- `packages/server/src/sdk/spawn-prompt.ts` — server-side spawn prompt builder

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
Human → Inbox/Decisions → Issue → Coordinator → Ceremony → Agent
                                                              │
                                                         git push / PR
                                                              │
                                                         GitHub Webhook
                                                              │
                                       ┌──────────────────────┴──────────────────────┐
                                       │ Card side-effects + context enrichment      │
                                       │ Scribe close-out + Ralph monitor decisions  │
                                       └──────────────────────┬──────────────────────┘
                                                              │
                                                       Next agent turn
                                      (sees webhook events + decision memory)
```

---

## Follow-ups / known gaps

- **Ralph live actions**: non-pickup GitHub actions are currently prioritized and
  audited; live auto-merge/remediation remains policy-gated future work.
- **Context window limits**: `external_gh_context` is capped at 20 events to
  avoid large prompts; a summarisation step could help for long-lived issues.

---

_Last updated: 2026-05-18 (coordinator parity certification)_
