# Squadboard-on-Squadboard — Dogfood Playbook (Wave 10 / Stream A)

This file documents how this repo's coordinator (Copilot CLI loaded with
`.github/agents/squad.agent.md`) drives squadboard's own development on
squadboard itself, via the MCP server shipped at
[`packages/server/src/mcp`](../packages/server/src/mcp/README.md).

The goal: every directive, bug report, or work item Ahmed surfaces in this
CLI session should land — automatically and without ceremony — as a card in
squadboard's own inbox, where it can be triaged through the normal Conjure
→ inbox → board → run → close loop.

## How the loop is wired

```
Ahmed (Copilot CLI)
   │
   ├─► Coordinator detects directive / work item            (existing flow)
   │     │
   │     ├─► .squad/decisions/inbox/copilot-directive-*.md  (existing flow)
   │     │
   │     └─► capture(...) MCP tool                          (NEW — this stream)
   │             │
   │             ▼
   │         squadboard inbox row (status=captured)
   │             │
   │             ▼
   │         Conjure classifier (intent=issue → card materialised)
   │             │
   │             ▼
   │         /projects/<squadboard>/inbox  → board → run → close
```

The MCP wiring lives in `.copilot/mcp-config.json`; the project ID it
defaults to comes from `SQUADBOARD_DEFAULT_PROJECT_ID` (read by the stdio
transport in `packages/server/src/mcp/index.ts`).

## When the coordinator should call `capture`

The coordinator already captures directives to
`.squad/decisions/inbox/copilot-directive-*.md` (see
[`squad.agent.md` § Directive Capture](../.github/agents/squad.agent.md)).
Wave 10 adds a **second, complementary** call — the existing markdown
capture stays in place; the MCP capture is additive.

**Always call `capture` (in addition to the existing flow) when:**

- Ahmed reports a bug or regression ("the hover resize is broken",
  "Heartbeat shows 'service not yet active'").
- Ahmed asks for a UX/polish change ("Costs columns should right-align").
- Ahmed asks for a feature ("add 7 non-tech roles to HireTeamModal").
- Ahmed surfaces a directive that has implementation work attached
  ("From now on, all dialog actions are right-aligned — apply across the
  board"). Capture the directive file AND a `capture` call for the
  implementation work.

**Do NOT call `capture` for:**

- Pure questions ("how does X work?") — answer directly.
- Pure directives with no work attached ("we're not doing X") — the
  decisions inbox file is enough; nothing to land on the board.
- Conversation about a card that already exists — comment / link
  instead of duplicating.

## What `capture` does under the hood

1. The coordinator calls the MCP tool `capture` with `{ prompt: "<text>" }`.
2. `SQUADBOARD_DEFAULT_PROJECT_ID` (set in the running CLI's env or via
   the env block in `.copilot/mcp-config.json`) supplies the project.
3. The Conjure classifier in `services/conjure-classifier.ts` decides the
   intent (`project | issue | team | agent | skill | tool`).
4. When `intent === 'issue'` AND a `projectId` is in scope, the tool
   creates the card immediately and returns `{ action: 'issue_created',
   issue, classification }`.
5. For non-`issue` intents the tool returns `{ action: 'draft_only',
   classification }` — the coordinator surfaces the draft + routing hint
   to the user so they can confirm.

The classifier is rule-based first, LLM-augmented only when the
rule-based confidence is below the threshold; it's cheap to call.

## Coordinator response template

After a successful `capture` call:

> 📌 Captured directive locally **and** dropped a card into squadboard:
> #abc1234 "Fix hover resize on project tiles" (status: backlog).

If `capture` returns `action: 'draft_only'`, surface the draft to Ahmed
and ask whether to publish:

> 🪄 Conjure classified this as a **skill** draft, not a board card.
> Draft body: "<…>". Want me to surface it on the Skills page or on the
> board anyway?

## Gotchas

- The capture tool uses the **inbox + Conjure classifier**, not the raw
  `create_issue` tool. That keeps everything routed through the same
  classification path the UI uses, so the dogfood loop stays
  representative.
- `SQUADBOARD_DEFAULT_PROJECT_ID` only kicks in when neither the
  `projectId` arg nor the `x-project-id` HTTP header is set. If Ahmed
  switches projects mid-session, prefer passing `projectId` explicitly.
- Captures are not idempotent — re-running the same prompt creates a new
  card. Use the inbox UI to dedup if needed.

## Related docs

- [`packages/server/src/mcp/README.md`](../packages/server/src/mcp/README.md)
  — MCP install + transport reference (stdio + HTTP).
- [`.github/agents/squad.agent.md`](../.github/agents/squad.agent.md)
  — coordinator playbook (existing directive-capture flow lives there).
- Wave 10 plan — `~/.copilot/session-state/<id>/plan.md`.

## Close-out flow (Wave 10 dogfood addendum — E3)

**When to call `capture` again with a close-out message:**

When a batch of agent work completes for a directive that was captured into squadboard
on intake, the coordinator should call `capture` a second time with a closing summary
to move the card from inbox → done on its own board.

**Close-out format:**

```
done: {one-line summary of what was fixed/completed} (sha={commit-sha-if-available})
```

Or with PR reference (if applicable):

```
done: {summary} (sha=abc123) — see PR #N
```

**How the MCP tool will route the close-out card:**

The `capture` tool in `packages/server/src/mcp/server.ts` does NOT yet have
"find existing card by text prefix" logic. Therefore, the close-out flow uses a
**coordinator-side convention** for now:

1. When calling `capture` on intake, the coordinator records the original **first 60
   characters** of the prompt (or captures it in the orchestration log via Scribe).
2. When calling `capture` on close-out, the coordinator includes a `done:` prefix
   followed by that same opening phrase (or first 60 chars of the original).
3. **Example workflow:**
   - **Intake:** `capture({ prompt: "Fix hover resize on project tiles — broken since PR #39" })`
     → Card created with ID #abc-123
   - **Close-out:** `capture({ prompt: "done: Fix hover resize on project tiles (sha=def456) — see PR #42" })`
     → New card created (for now) with the `done:` status visible to the coordinator

**If the original card can't be located:**

If the first 60-char anchor doesn't match any existing card, the close-out `capture`
call will create a new "done" card. This is acceptable for now — the inbox UI can
dedup manually. The coordinator should note in the orchestration log which cards
were paired (intake → close-out).

**Future enhancement:**

When Squadboard adds a "find by text prefix" feature to the `capture` tool (or a
dedicated `update_issue_by_match` tool), the close-out flow can be improved to:
1. Query existing issues by prefix match
2. Transition the matched issue from backlog → done (or the current status → done)
3. Return the updated issue ID to the coordinator

Until then, the coordinator-side convention + manual inbox cleanup is the pattern.

**In orchestration logs and Scribe history:**

When a coordinator calls `capture` for close-out, Scribe should record:
- Original intake capture (prompt, returned issue ID if available)
- Close-out capture call (prompt, returned issue ID)
- Any manual dedup actions taken in the squadboard UI

---

## Smoke-test findings (Stream A6)

Run date: 2026-05-15. Target project: `7a9cc07a-d463-4f8c-864a-c733342aa8a8`
("foo" → would be "Squadboard" if A1 had inserted it; pre-existing row was
created manually before the dogfood plumbing landed, so the idempotency
guard skipped insertion and re-used the existing id).

Two scripts now live under `packages/server/src/scripts/`:

- `seed-wave10-backlog.ts` — pushes every Stream B/C/D/E card from the
  Wave 10 plan through the same `classifyAndDraft` + `db.insert(issues)`
  path the MCP `capture` tool uses. Idempotent (dedups by title).
- `smoke-loop-mcp.ts` — drives the actual MCP stdio transport via the
  SDK client; runs `capture → list_issues → update_issue × 3 →
  list_issues` and asserts the card moves backlog → todo → in_progress →
  done.

### Results

- **A5 seed:** 26 / 26 cards landed on the board. Board now shows 27
  rows in the project (one pre-existing card + the 26 wave-10 cards).
- **A6 smoke loop:** PASS — capture-from-MCP → backlog → todo →
  in_progress → done verified in a single script run, all via stdio
  transport. `SQUADBOARD_DEFAULT_PROJECT_ID` env var was used as the
  only project-id source (no `projectId` arg, no header).

### Rough edges discovered (real findings — these need their own cards)

1. **Conjure classifier mis-routes 8 / 26 plain "fix bug" / "feature"
   prompts when they mention domain words.** Even with `hint='issue'`,
   the rule-based scorer over-weights words like "project", "skill",
   "team", "tool", "ceremony" that legitimately appear in the
   description of an issue. Misclassified examples (all real wave-10
   work items): C3 → `project`, C4 → `project`, C5 → `skill`, C8 →
   `project`, D1 → `team`, D2 → `project`, D3 → `tool`, E3 → `skill`.
   The hint should weight more heavily — currently it appears to be
   tied with the keyword scorer rather than dominating it. The seed
   script falls back to force-creating an issue when hint=issue is set
   and intent comes back as something else; the MCP `capture` tool does
   not have that fallback and would silently return `draft_only` to the
   coordinator. **→ Capture as a wave-10 follow-up bug:** _"Conjure
   classifier should respect explicit `hint` parameter as a hard
   override (not a soft signal) when caller has already chosen the
   intent."_

2. **Capture tool with no projectId silently no-ops to draft_only.**
   This is per spec, but when the caller has set
   `SQUADBOARD_DEFAULT_PROJECT_ID` _and_ omits a header, the tool
   correctly picks it up after A3 — verified in the smoke run. Without
   the env var (and with no header / arg), the tool returns a draft and
   the coordinator has to know to do something with it. The README now
   documents this clearly; consider auto-suggesting `list_projects`
   from inside the draft_only response so a caller knows what to do
   next.

3. **The pre-existing project row name is "foo", not "Squadboard".**
   A1 (self-register) is dedup-by-path — when a row already points at
   `<repo>/.squad`, it doesn't rename. This is correct behaviour for
   idempotency, but cosmetically the dogfood project on the projects
   page is labelled "foo". The projects PATCH endpoint
   (`/api/projects/:id`) only accepts `defaultModel` updates today;
   renaming requires direct DB access. **→ Capture as a
   not-blocking-but-irritating bug:** _"PATCH /api/projects/:id should
   accept `name` updates so users (and the self-register service) can
   rename a row without a DB round-trip."_

4. **Spawned MCP server emits a noisy `pg` shutdown trace to stderr
   when the parent disconnects.** When the smoke client closes the
   stdio transport, the MCP child process tries to drain its postgres
   connection pool against the still-running embedded cluster and the
   pool's last `release()` call dumps the full client object to stderr
   before the process exits. Doesn't affect the test result (the loop
   completes successfully _before_ disconnect), but it's ugly. **→
   Capture as a polish issue:** _"MCP stdio entry should swallow `pg`
   pool shutdown errors and exit cleanly when stdin EOFs."_

5. **HTTP transport sessions look fragile under curl.** Hitting the
   `/mcp` Streamable HTTP endpoint with curl (one shot, no SSE keep-
   alive) makes the second request return `Unknown or expired
   Mcp-Session-Id`. The SDK client (used by the smoke loop) keeps the
   stream open and works fine. Likely the transport's `onclose` handler
   evicts the session when the SSE stream tears down. Worth verifying
   that this doesn't break the VS Code MCP client too. **→ Capture as
   an investigation card:** _"HTTP MCP transport: confirm session
   survives across short-lived clients (curl, fetch with no SSE)."_

### Cards to capture back into squadboard

These four findings will themselves get captured into squadboard via the
same `capture` tool — closing the dogfood loop on itself. Run:

```bash
SQUADBOARD_DEFAULT_PROJECT_ID=<id> \
  pnpm --filter @sabbour/squadboard-server tsx src/scripts/smoke-loop-mcp.ts
```

…to re-run the smoke at any time.

