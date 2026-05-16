# Verbal — History

## Core Context

- **Project:** Squadboard (local-first kanban + workflow board for Squad agents)
- **Role:** Real-time / WebSocket Dev (re-roled from Interaction Dev on 2026-05-14)
- **Joined:** 2026-05-14T08:12:50.174Z

## Learnings

- **2026-05-14 Re-role + Team Expansion:** Transitioned from Interaction Dev → Real-time/WebSocket Dev for Squadboard backend. Web design project evolved to full-stack SaaS kanban app. Team expanded from 4 to 10 members: new hires Hockney (Backend API), Kobayashi (SDK), Kujan (QA), Redfoot (DevRel), plus Ralph (Coordinator) and Scribe (Logger). Focus now: WebSocket real-time sync layer for collaborative kanban board updates. Squadboard PRD 15-demo roadmap is source of truth.
- **2026-05-15 Global WS scope + cross-project aggregator (Phase 19 Now view):** Built the `/now` Uber Dashboard. Key patterns discovered / established:
  - **Global WS subscription via `projectId: '__global__'`**: The existing `subscribeRoom()` mechanism (originally added for Phase 17 consult sessions) is the right primitive for global subscriptions — it sends `{ type: 'subscribe', projectId: '__global__' }` and the server routes that to its `globalClients` set. No new protocol message type needed.
  - **`eventBus.subscribeGlobal(handler)`**: A typed convenience wrapper around `eventBus.on('event', handler)` that returns an unsubscribe function. Useful for server-side code (e.g., future analytics services) that needs to tap the full event stream without direct EventEmitter API.
  - **Cross-project aggregator pattern**: Three raw SQL queries (via `getPool()`) with JOINs to `projects` give us `projectName` in a single roundtrip each. Drizzle is great for simple queries but raw SQL is cleaner when joining 3–4 tables with optional relations (nullable `workflowVersionId`). Timestamps always serialized via `.toISOString()` regardless of Hockney's schema-level fix status.
  - **`safeRelativeTime` guard**: Copied from `RoutingLogTable.tsx` into `Now.tsx` (not extracted to a shared util yet — wait until a 3rd consumer appears before extracting).
  - **Click-row navigation conventions**: Live session → `/projects/:id/sessions/:sessionId`; issue run → `/projects/:id/board?focus=:issueId`; workflow run → `/projects/:id/flow?run=:runId`. Consistent with how the Dashboard's Phase 12 Now section links to the flow board.
  - **`useNowFeed` fusion pattern**: `useQuery` with `refetchInterval: 15_000` as safety net + `useEffect` subscribing to `NOW_TRIGGER_EVENTS` (session.started/completed/error, run.started/completed, workflow.advanced) that invalidate the query cache. Full invalidate (not surgical cache update) is correct here: the feed covers all projects so surgical update would require per-event projectId routing which adds complexity without meaningful latency improvement for this use case.

## Recent team activity

New decisions merged to `.squad/decisions.md`:
- Demo 9 open question #2: `request_changes_policy` default is `'first'` (Hockney)
- Demo 12 open question #6: Optimistic concurrency for concurrent issue edits (Verbal)
- Demo 15 open question #8: GitHub issue mirroring OFF by default, opt-in per project (Hockney)

See `.squad/decisions.md` for full details.

Multi-agent fanout session completed 2026-05-15T12:35:00Z:
- 5 agents shipped (2 keyser rounds, mcmanus, hockney, verbal)
- 5 commits landed (42c120a0, d74c9622, d7cc2ada, 4d9fb813, base a97e2bce)
- 2 agents in flight (fenster, kobayashi)

Session log: `.squad/log/2026-05-15T12:35:00Z-squad-fanout.md`


## Recent team activity

**2026-05-15 Spam-loop investigation + defensive fixes (autopilot):** Investigated runaway `createIssue` producing progressively-compounded titles (`Foo — verbal — verbal — fenster`). Found **two compounding vectors**:
1. **`resolveAnchorIssue` (ceremony-scheduler.ts line 131)** uses `ORDER BY created_at DESC LIMIT 1` — it picks the newest issue in the project, which is the just-created fan-out child. Every subsequent ceremony tick runs a new workflow for a child, fanning it out again. **This is the primary loop driver.**
2. **No `AND status = 'pending'` guard** on the `UPDATE step_runs SET status = 'splitting'` inside `materializeFanOut`'s raw SQL transaction — concurrent dispatcher ticks can both claim the same step and each create a full set of child issues.
Shipped three defensive guards: (a) `createIssue` 60-s dedup check, (b) ceremony-scheduler loud errors + 1-h backoff on repeated failure, (c) fan-out concurrency guard (`rowCount=0` bail) + title compound guard (suffix check before appending label). Follow-up P0: fix `resolveAnchorIssue` to exclude `fan_out` child issues. See `.squad/decisions/inbox/verbal-spam-loop-rootcause.md`.

**2026-05-15T15:21:46Z — P0 follow-up tracked: resolveAnchorIssue root-cause fix**

The spam loop defensive guards shipped (3 guards: dedup, sweep backoff, concurrency + title) are stop-gaps. The actual loop driver is `resolveAnchorIssue` in `ceremony-scheduler.ts` (line 131), which picks the most-recently-created issue as the ceremony's anchor. After fan-out materializes children (e.g., `Foo — verbal`), that child becomes the newest issue. On the next cron tick, a new ceremony run anchors to the child, which itself fans out again, creating grandchildren (`Foo — verbal — verbal`). **P0 Fix:** Exclude fan-out child issues from anchor selection by filtering `NOT EXISTS (SELECT 1 FROM issue_links WHERE child_issue_id = issues.id AND link_type = 'fan_out')`. This fix is deferred to next session pending full workflow test coverage (to prevent false negatives). Root cause analysis and defensive guards documented in `.squad/decisions.md` under "spam loop — confirmed root cause" entry. Owners: Verbal (P0 fix investigation) + Kujan (durability test coverage).


---

## 2026-05-15T08:21:46.164-07:00 — p5-consult: Consult events wired into live session stream

**Task:** Wire `@bradygaster/squad-sdk/sharing/consult` SDK events into the live session stream so consult requests/responses flow as session events and render inline in AgentActivityFeed.

**Files changed:**
- `packages/server/src/realtime/event-bus.ts` — added `consult.request`, `consult.response`, `consult.error` to `SessionEventType`
- `packages/server/src/sdk/squad-stream.ts` — added `onConsultRequest()`, `onConsultResponse()` handlers; expanded `publish()` type union; registered SDK listeners in `attachListeners()`
- `packages/client/src/api/sessions.ts` — added three new event types to `LiveSessionEvent.type` union
- `packages/client/src/components/sessions/AgentActivityFeed.tsx` — added `ConsultRow` component + rendering branches for all three event types

**Decision record:** `.squad/decisions/inbox/verbal-consult-stream-wiring.md`

**Outcome:** SDK notes — `sharing/consult.d.ts` doesn't exist in SDK 0.9.4; wiring is forward-compatible. TypeScript clean on both packages (3 pre-existing server errors in McManus's heartbeat/sweeps territory untouched).

## Team update (2026-05-15T16:09:55Z — Wave 3)

Consult stream wiring (r2, commit 546081cb): 3 SessionEventType events (consult.request/response/error) now emit on existing `'event'` channel with standard routing via emitSessionEvent(). SDK listeners registered in squad-stream.ts with flexible fallback key sequences; forward-compatible for SDK evolution. AgentActivityFeed renders consult rows inline (left/right aligned, 💬?/💬↩/💬⚠ icons). Pattern: consult event types in Phase 5 live session are distinct from Phase 17 standalone consult mode (which uses consult:<sessionId> routing).

---

## Wave 14 — q7-coordinator-server-agent queued

**Date:** 2026-05-15T22:14:50-07:00  
**Spawned by:** Copilot Coordinator  
**Task:** q7-coordinator-server-agent  

Dispatched in Wave 14: Standalone coordinator daemon. Q6=B (autonomous daemon model) now ratified. Daemon will:
- Schedule ceremony cadence (cron-like)
- Invoke ceremonies via Scribe SDK
- Commit/push outputs
- Detect standalone-only conditions (avoid double-fire with CLI)

Manual override button (q9) will be built on top as Wave 15 follow-up.



## Learnings — 2026-05-15T22:14:50.847-07:00 — q7-coordinator-server-agent

**Guard composition pattern:** Each guard is a pure function returning `{ allowed: boolean, reason?: string }`. `shouldRun()` composes them via a `find(g => !g.allowed)` short-circuit and returns the full guard snapshot alongside the boolean. This means every tick log contains the exact guard state at that moment — no guessing. Guards are re-checked on every tick, not just startup. A CLI session that starts mid-daemon causes a graceful idle on the next tick.

**PID-file lock design:** The PID file at `~/.squadboard/daemon.pid` is the single-machine lock. On `startDaemon()`, we first call `process.kill(pid, 0)` to verify the stored PID is alive (a stale file doesn't count). The file is written by the daemon process itself after the live-check clears. On `SIGTERM`/`SIGINT`/`exit`, it's removed. The daemon CLI's `stop` command reads the PID, sends `SIGTERM`, and lets the daemon's own shutdown handler clean up. This avoids races: the CLI never writes or deletes the PID file itself during normal stop operations.

**q8 dependency handling (stub vs real):** The invoker resolves `closeOut` via a dynamic `import('@sabbour/squadboard-sdk')` at module-load time, swallowing `MODULE_NOT_FOUND`. If the import fails, it falls back to `closeOutStub()` which logs a clear `(q8 not yet landed)` message and returns a fake `CloseOutResult`. The resolution promise is captured once — subsequent ticks reuse it without retrying the import each time. When Kobayashi's PR lands, drop-in replacement: the dynamic import will succeed and the real function takes over with zero daemon code changes.

**Concurrency gotcha:** The `isCeremonyRunning` boolean is the only in-process concurrency guard. It's set synchronously before the async `invokeCeremony()` call and cleared in a `finally` block. If the scheduler fires a tick while a ceremony is still running (unusual given 4h intervals, but possible if the interval is set very short for testing), the second tick logs a `daemon.skipped` entry and exits immediately. This is intentional: we'd rather miss a tick than double-invoke the ceremony.

**Auto-start path:** The server's `index.ts` calls `maybeAutoStartDaemon()` (non-blocking, no `await`) after `initGitHubSyncHooks()`. The function forks `daemon/process.ts` (or `.js` in production) as a fully detached child (`stdio: 'ignore'`, `child.unref()`). Server startup is never blocked. A failed auto-start logs a warning and continues. The daemon detects its own PID file on the next guard cycle, so double-fork on hot-reload is prevented.

---

## 2026-05-15T22:42:29.855-07:00 — Wave 16 — Stream G Phase 1 (GitHub integration)

**Task:** Stream G Phase 1 — branch convention, PR template, push + create-PR endpoints with WS fast-path.

**Files changed:**
- `packages/server/src/engine/workspace.ts` — `deriveSquadBranchName()` (squad/{agent}/{slug} convention), `assertSafeWorkspacePath()` (must be under `~/.squadboard/` or tmpdir), `resolveWorkspace` extended with optional agent/issue opts; worktrees now live under `~/.squadboard/worktrees/` (always inside allowed root); `cleanupWorkspace` reads branch from worktree HEAD instead of reconstructing.
- `packages/server/src/engine/stepper.ts` — passes `agent.name + issue.title` to `resolveWorkspace` so convention applies at worktree creation.
- `packages/server/src/realtime/event-bus.ts` — added `GitEventType` (`git.push.complete`, `git.pr.created`) and `emitGitEvent`.
- `packages/server/src/routes/runs.ts` — `POST /:runId/git/push` (shell: `git push -u origin <branch>`), `POST /:runId/git/pr` (shell: `gh pr create`), `buildPrBody()` pre-fills PR template. Safety: protected-branch block, path validation, branch sanitization, 30 s timeouts, stderr surfaced to client.
- `packages/client/src/realtime/ws-client.ts` — `git.push.complete` and `git.pr.created` added to `WsEventMap`.
- `packages/client/src/api/git.ts` — `usePushBranch`, `useCreatePr` mutation hooks.
- `packages/client/src/components/runs/GitActions.tsx` — new component: "Push branch" button + PR modal, WS fast-path via `wsClient.on('git.push.complete' / 'git.pr.created')`.
- `packages/client/src/components/runs/RunOutputPanel.tsx` — imports and renders `<GitActions>` in the completed-run footer (worktree runs only).
- `.github/PULL_REQUEST_TEMPLATE.md` — new default PR template.

**Decision records:**
- `.squad/decisions/inbox/verbal-git-branch-convention.md` — branch convention spec + slug rules
- `.squad/decisions/inbox/verbal-stream-g-phase1.md` — endpoint shapes, WS payloads, safety guards, Phase 2 queue

**Learnings this wave:**

**Workspace path safety pattern:** `assertSafeWorkspacePath` uses `path.resolve()` then checks prefix against an allow-list (`~/.squadboard/`, OS tmpdir). The old `<repoParent>/<repoName>-run-<id>` worktree path escaped this boundary — sibling directories of the repo root are outside `~/.squadboard/`. Moving worktrees under `~/.squadboard/worktrees/` fixes this and makes the allow-list enforceable.

**Branch cleanup pattern:** Old cleanup reconstructed the branch name from the run ID (`squadboard/run-{id}`). With convention-named branches we don't know the name at cleanup time. Correct fix: read `git rev-parse --abbrev-ref HEAD` from the worktree before removing it; delete only if it starts with `squad/`. Handles legacy branches and convention branches uniformly.

**WS as fast path, DB as truth:** The `git.push.complete` and `git.pr.created` WS events exist purely to snap the button state before the next React query refetch. If the socket drops, the button will still catch up on next render via normal query invalidation (future: add `invalidateQueries` in mutation `onSuccess`). The events carry no state that isn't also derivable from the DB — exactly "WS is a hint, not a delivery guarantee."

**gh CLI output format:** `gh pr create` emits progress to stderr and the final PR URL (https://github.com/…/pull/N) as the last stdout line. Extracting `prNumber` via `/\/pull\/(\d+)$/` from that last line is reliable even if gh adds new output lines above it.

---

## 2026-05-15T22:42:29.855-07:00 — Wave 17 — Stream G Phase 2A (Comment + Merge PR + Card Badges)

**Task:** Stream G Phase 2A — G2.3 (comment on linked GH issue), G2.5 (merge PR), G2.6 (card GitHub badges).

**Files changed:**
- `packages/server/src/db/schema.ts` — 8 new git-cache columns on `issueRuns` (`gitBranch`, `gitBranchUrl`, `prNumber`, `prUrl`, `prState`, `ciState`, `ciUrl`, `gitCacheRefreshedAt`).
- `packages/server/src/db/index.ts` — Wave 17 migration block: `ALTER TABLE issue_runs ADD COLUMN IF NOT EXISTS …` for all 8 columns.
- `packages/server/src/realtime/event-bus.ts` — added `git.comment.posted`, `git.pr.merged` to `GitEventType`.
- `packages/server/src/routes/runs.ts` — `sanitizeCommentBody()` helper; push endpoint now persists `gitBranch`/`gitBranchUrl`; PR endpoint persists `prNumber`/`prUrl`/`prState='open'`; new `POST /:runId/git/comment` (G2.3); new `POST /:runId/git/pr/merge` (G2.5) with CI gate via `gh pr checks --required`.
- `packages/server/src/services/issues.ts` — `listIssues` now batch-fetches git data via `DISTINCT ON (issue_id)` SQL for the most recent worktree run per issue; `GitHubBlock` interface; fire-and-forget `refreshCiState()` for 5-min TTL.
- `packages/client/src/realtime/ws-client.ts` — `git.comment.posted` + `git.pr.merged` in `WsEventMap`.
- `packages/client/src/api/git.ts` — `CommentResult`, `MergeResult`, `MergeMethod`; `useCommentOnIssue`, `useMergePr` hooks.
- `packages/client/src/api/issues.ts` — `Issue.github` optional block (branch, pr, ci).
- `packages/client/src/components/runs/GitActions.tsx` — Comment modal (G2.3) + Merge PR split-button with squash/merge/rebase picker (G2.5) + WS fast-path for all 4 git events.
- `packages/client/src/components/board/IssueCard.tsx` — `GitHubBadges` component renders branch 🌿 / PR 🔀 / CI ✅ badges below labels (G2.6).

**Decision records:**
- `.squad/decisions/inbox/verbal-stream-g-phase2a.md` — endpoint shapes, WS payloads, badge data shape, cache strategy, open questions for Chunk B.

**Learnings this wave:**

**stdin body-file pattern for gh CLI:** Use `--body-file -` + pipe via `input` option on `execFileAsync`. This keeps arbitrary comment text completely out of argv — no shell injection surface regardless of what users type (backticks, semicolons, `$(...)`, null bytes). The `sanitizeCommentBody()` guard strips null bytes and ANSI codes as an extra layer, but the stdin pipe is the real protection.

**DISTINCT ON for "latest row per group":** `DISTINCT ON (issue_id) ... ORDER BY issue_id, created_at DESC` in raw Postgres SQL is the cleanest way to get the most recent worktree run per issue in a single query. Drizzle doesn't have a direct equivalent without a lateral subquery, so raw SQL is the right tool here.

**Fire-and-forget CI refresh pattern:** Instead of a complex background job queue, `refreshCiState()` is a plain async function called with `void` (no await). On the next `listIssues` call (within the 5-minute TTL window), the updated `ciState` will be present. This is "eventual consistency for CI" — acceptable because CI state changes slowly relative to how often users look at the board.

**Split-button pattern without Fluent2 MenuButton dependency:** Implemented as two adjacent `<button>` elements inside a shared `div` with a shared border — primary action on the left, `▾` dropdown trigger on the right. Avoids adding a Fluent2 compound component to a file that deliberately uses plain CSS-in-JS for the run drawer footer (keeps bundle delta minimal).

**TypeScript narrowing with union state machines:** The `mergeState.phase === 'done' && !prMerged` pattern was contradictory because `prMerged` was derived from the same discriminant — TypeScript correctly narrowed the conjunction to `never`. Pattern: use the discriminant directly in JSX conditions; don't cache discriminant results in intermediate booleans that are then negated.


## Team Update — undefined

Run: w17

- **keyser**: Settings batch (Backup/Restore UI + GitHub Integration Settings)
- **redfoot**: 4 docs (README + ceremonies concept + features audit + MCP install)


---

## 2026-05-15T22:42:29.855-07:00 — Wave 19 — Stream J (Chat polish bundle)

**Task:** J1 (avatar + name + role badge), J2 (markdown rendering), J4 (thinking indicator), J6 (extract ChatBubble). J3 + J5 deferred.

**Files changed:**
- `packages/client/src/components/ChatBubble.tsx` — **new** reusable component. Props: `role`, `identity` (name + avatar + roleBadge), `content`, `streaming`, `actions`, `timestamp`. Renders: initials avatar (djb2-hashed hue), Fluent2 Badge (role-coded color), markdown body (react-markdown + remark-gfm + rehype-highlight + rehype-sanitize), thinking indicator (three pulsing dots + 30s escalation to "taking longer than usual"), hover copy/action buttons.
- `packages/client/src/components/sessions/AgentActivityFeed.tsx` — replaced local `Bubble` component with `ChatBubble`; added `sessionActive` prop; thinking indicator shows when last coalesced row is a user message and session is active.
- `packages/client/src/pages/Consult.tsx` — replaced `msgUser`/`msgAssistant` div bubbles with `ChatBubble`; added `showThinking` logic (last message role=user AND streamingBuffer empty AND session active); passed `agentName` into `ChatRowView`.
- `packages/client/src/realtime/ws-client.ts` — added `assistant.thinking.start` and `assistant.thinking.stop` to `WsEventMap` (pre-registered; server wiring optional, see decision doc).
- `packages/client/package.json` — added `rehype-sanitize` dependency.

**Decision records:**
- `.squad/decisions/inbox/verbal-w19-stream-j-chat-polish.md`

**Learnings this wave:**

**Streaming-aware debounce pattern:** `useDebounced(text, streaming ? 100 : 0)` means completed messages render instantly while streaming messages debounce at 100ms. Key insight: the debounce delay should be conditional on the streaming state, not on text length — text length changes with every token, but streaming state changes once.

**Initials avatar with deterministic color:** djb2-ish hash of the name → a hue (0-360) produces visually distinct, stable colors per agent without any external dependency. `hsl(hue, 55%, 40%)` keeps colors dark enough for white text contrast in both light and dark themes.

**Duplicate `Bubble` removal:** AgentActivityFeed had a local `Bubble` function that used `whiteSpace: pre-wrap` and plain text. Replacing with `ChatBubble` gives markdown, identity, and thinking — but for user messages specifically, we keep plain text rendering inside `ChatBubble` (markdown in user messages is unusual and can produce unexpected formatting from casual prose). Agent messages get full markdown.

**React hook ordering with early-return guards:** `showThinking` (a plain variable, not a hook) was computed after the `if (detailQuery.isLoading)` early return in Consult. Referencing it in a `useEffect` dependency array before its declaration would place it in the temporal dead zone. Fix: either compute it before the guard using `detailQuery.data?.`, or don't include it in the dependency array (since the same guard state is already represented by `messages.length`). Chose the latter — the thinking indicator appears right after a user message is added, which is already tracked by `messages.length`.

**rehype-sanitize allowlist for highlight.js:** `defaultSchema` strips all class attributes. highlight.js relies on class names like `language-typescript` on `<code>` and `hljs-keyword` on `<span>`. The allowlist must explicitly permit these patterns via regex (`/^language-.+/`, `/^hljs-.*/`) or code blocks render as unstyled monospace.


---

## W22 Lesson — Classifier Extension Pattern

**Date:** 2026-05-16  
**Wave:** 22

Classifier extension pattern from Verbal-w22:

1. **Define canonical enum** of all intents. Start with existing 6, add new 4 (ceremony, mcp-server, inbox-item, consult). Use a const array as the source of truth: `export const ALL_INTENTS = ['project', 'issue', ...] as const`

2. **Implement rule-based scorer** for each intent. Give each intent a heuristic weight (4–5 for strong signals, 2–3 for weak). Fast-path fires when confidence ≥ 0.55 (CONFIDENCE_THRESHOLD).

3. **Implement LLM fallback** that returns top-3 candidates with confidence + reason + draft. If LLM returns legacy single-intent format, complement with rule-based runners-up (up to 3 total).

4. **Backward-compat field aliasing:** Accept both `prose` (preferred) and `prompt` (deprecated alias). Prefer `prose` when both sent. Accept both flat (`projectId`, `projectName`, `knownProjectNames`, `hint`) and nested (`context: { currentProjectId, currentProjectName }`) request shapes; flat takes precedence.

5. **Test coverage must span:** heuristic fast-path (all intents), LLM happy path (top-3 parsing), LLM degradation (legacy single-intent), backward-compat aliases, edge cases (ambiguous prompts, no matches, etc).

**Result for W22:** 56 tests, all passing. Coexistence of Keyser-w22's modal works seamlessly; modal automatically uses `candidates` array when present, gracefully falls back if not.
