# Design: Jump Into Running Session — Live Viewer + Steering

**Author:** Design Research Team  
**Date:** 2026-05-16  
**Status:** PROPOSAL  
**Outcome:** Enable users to click into a running `issue_run` to watch live events and inject steering messages without killing the run.

---

## 1. Problem Statement

Currently, when an agent is assigned to an issue and begins execution as an `issue_run`, the user cannot:
- Watch the execution in real time
- See token usage, model selection, or intermediate outputs
- Inject guidance or course corrections mid-stream
- Know if the run has stalled or is consuming budget at an unexpected rate

This gap leaves operators blind during high-stakes or expensive runs. By contrast, live `SquadClient` sessions (Consult page) are already interactive and streamable, but they are manual — not routed through the board automation.

**Design Goal:** Expose running `issue_run` agent execution as a real-time event stream with optional steering injection, reusing the existing event bus and WebSocket infrastructure, and designed to work seamlessly with both the current direct-dispatch model AND the upcoming mini-coordinator architecture (W28–W29).

---

## 2. Current State (Research Findings)

### 2.1 Event Infrastructure

**Event Bus** (`packages/server/src/realtime/event-bus.ts`):
- Already defines `SessionEventType` (line 38–49) including:
  - `session.started`, `session.message`, `session.delta`, `session.tool`, `session.usage`, `session.error`, `session.completed`
  - **Already includes** `session.steered` (line 46) — suggesting steering was anticipated
- Scoped to `projectId` for fan-out via WebSocket rooms
- Single-process EventEmitter; no Redis (hacking phase)

**WebSocket Server** (`packages/server/src/realtime/ws-server.ts`):
- Room-based subscription: clients subscribe to `projectId`
- Multiplexes all events from the bus into client rooms
- State: `rooms: Map<projectId → Set<ClientState>>`
- **Already supports N viewers** per room (broadcast to all clients except sender)
- No native "focus" or "priority" for concurrent viewers

**Session Event Publishing** (`packages/server/src/sdk/squad-stream.ts`, RunningLiveSession class):
- Live `SquadClient` sessions already:
  - Attach SDK event listeners (assistant.message_delta, reasoning_delta, usage, error, etc.)
  - Translate to `session.*` events
  - Publish to event bus (line 160) with `enrichedPayload` containing `sessionId`
  - Persist to `live_session_events` table (durable transcript)
  - Update usage rollups on the session row

### 2.2 Two Session Types

1. **Live Sessions** (`live_sessions` table):
   - Multi-turn SquadClient sessions — user-initiated, interactive
   - Powered by `startLiveSession()` / `squad-stream.ts`
   - Events are already streamed and steerable (Consult page pattern)
   - UI: `/projects/:id/live/:sessionId`

2. **Issue Runs** (`issue_runs` table):
   - Single-agent dispatcher runs (Invariant 1: bridge.ts)
   - Powered by `executeAgentRun()` → `createAgentSession()` (one-shot)
   - Events are NOT currently streamed; only final output stored
   - No realtime interaction; no steering surface
   - **This is where the gap is.**

### 2.3 Steering Events

- Event type `session.steered` already exists in the bus
- Payload shape (from `realtime/ws-client.ts`):
  ```
  { sessionId, action: 'inject' | 'interrupt' | 'handoff' | 'invite',
    actor?, honoured?, reason?, note?, deferred?, toAgentId?, agentId? }
  ```
- Routes exist: `POST /api/projects/:id/sessions/:sessionId/handoff` and `/invite` (routes/sessions.ts)
- Activity feed renders `session.steered` events (AgentActivityFeed.tsx)
- **Infrastructure is ready; just needs to be wired into issue_runs.**

### 2.4 Coordinator Architecture Context (W28–W29 Pivot)

**Decision:** Mini coordinator-agent replaces charter parser (2026-05-16T04:10).

**Implication for this design:**
- Current: `issue_run` created by auto-router → Agent picked by tier-2 keyword score → SDK called directly
- Future (W28+): `issue_run` created by auto-router → Mini coordinator-agent LLM call → Agent + model chosen → SDK called
- **Key:** The event streaming surface should NOT assume direct dispatch. Make it generic enough that coordinator telemetry can layer on top.

---

## 3. Surface Layer (UI/UX)

### 3.1 Entry Point: Board Card Row Action

**Current:** Board card row shows issue title, status, assignee, attempt count, last-touched timestamp.

**Proposed addition:**
- Add a **"Watch"** or **"View Live"** button (icon: eye or play) next to the card row IF:
  - Run status = `'running'`
  - Run has been running for > 2 seconds (to avoid jitter)
  - Run's `started_at` + lease TTL has not expired
- Button opens a side panel or modal (or navigates to `/projects/:id/runs/:runId/live`)

**Alternative (less intrusive):**
- Make the entire card row clickable when `status='running'`
- Show a pulsing indicator (dot, pulse animation) to draw attention

### 3.2 Live Viewer Panel / Page

**Components:**

1. **Header Bar:**
   - Run ID + linked issue title + agent name + agent model
   - **Coordinator context (W28+):** Add "Coordinator reasoning" collapsible section showing why this agent+model was chosen
   - Status badge: `running` / `paused` / `error`
   - Elapsed time (HH:MM:SS)

2. **Metrics Panel (top right):**
   - Tokens used so far (input + output separately)
   - Estimated cost so far (USD)
   - Budget remaining (if project has budget configured)
   - Model name + context window
   - Warning if budget is low or tokens exceed expected range

3. **Event Stream (main area):**
   - Vertical timeline of session events (similar to Consult activity feed)
   - Event types rendered:
     - `session.started`: "Agent started with model X"
     - `session.message`: Render assistant output as a chat bubble
     - `session.delta`: Stream into the current message bubble (real-time)
     - `session.usage`: Show token delta in a footnote or tooltip
     - `session.tool`: Show tool call metadata if present
     - `session.error`: Render as red/warning bubble
     - `session.steered`: Render as a system message showing what was steered
     - `session.completed`: Terminal state message
   - Auto-scroll to newest event
   - Search / filter by event type (optional, MVP can skip)

4. **Steering Control Bar (bottom):**
   - Text input + Send button
   - Dropdown menu for steering actions:
     - `inject`: Add user context/message as a new user turn
     - `interrupt`: Stop current response, return to idle
     - `redirect`: Tell agent to switch approach (special case of inject)
   - Checkbox: "Inject & continue" vs. "Interrupt & wait"
   - Clear visual affordance (blue/orange color to distinguish from chat)

### 3.3 Multiple Viewers

**Behavior:**
- Up to N browsers can watch the same `issue_run` simultaneously
- All receive events via the same WS room (project-scoped)
- **Steering conflict:** If two users send steering messages simultaneously:
  - Both messages queued server-side
  - Processed in order received (timestamped at ingestion)
  - Second user's UI shows a toast: "Your message queued (1 ahead)" to signal concurrency
  - UI does NOT explicitly "lock" one user for priority

**Rationale:** For now (single-user squad board), explicit locking is overkill. If multi-user coordination becomes critical, add a "take control" button in a future wave.

### 3.4 Mobile / Narrow Screen

- Steering bar moves to a sticky bottom sheet (full-width text input)
- Metrics panel collapses to a top badge showing "{tokens} / {cost} / {time}"
- Event stream takes remaining space, full-width
- Header bar remains visible but agent name truncates

---

## 4. Server-side Mechanics

### 4.1 Streaming Issue Runs

**Current flow:**
1. `stepper.ts`: `executeAgentRun(input)` → `createAgentSession()` → runs to completion → returns result
2. Output buffered in memory, flushed to DB at end
3. No intermediate events emitted

**Proposed flow:**
1. `stepper.ts`: Mark run status as `'running'` + set `started_at` (already done)
2. `executeAgentRun()` or a wrapper calls a new `createStreamedAgentSession()` or adapts `createAgentSession()` to emit events
3. SDK events (message, delta, usage, error) are captured and published to event bus **immediately**
   - Event scope: `sessionId = issueRunId` (reuse the run UUID)
   - Publish via `eventBus.emitSessionEvent(type, projectId, payload)`
4. Steering messages received on a new endpoint: `POST /api/issues/:issueId/runs/:runId/steer`
5. Steering message queued / injected into the running session
6. On completion, run status transitions to `'completed'` and the session is cleaned up

### 4.2 WebSocket Multiplex — How Viewers Subscribe

**Current:**
- Client sends `{ type: 'subscribe', payload: { projectId } }`
- Subscribed clients receive all project-scoped events

**New:**
- Viewers already receive `issue_run` events because they're scoped to the project
- No new subscription needed — just existing project subscription covers the run
- Events reach clients with `payload.sessionId = issueRunId` so UI can route to the right viewer

**Example event flow:**
```
run.status = 'running', issueRunId = 'abc-123', projectId = 'proj-456'
eventBus.emitSessionEvent('session.delta', 'proj-456', 
  { sessionId: 'abc-123', delta: 'Hello' })
→ WS server broadcasts to all clients in room 'proj-456'
→ Client filters for sessionId='abc-123' and renders in the viewer
```

### 4.3 Steering Injection — How Messages Get Into the Session

**Challenge:** The SDK `SquadClient` session must be kept open and able to accept out-of-band messages mid-turn.

**Option A: Active Session Registry (Recommended)**
- Keep a `Map<issueRunId → RunningIssueSession>` in memory (similar to `RunningLiveSession` in squad-stream.ts)
- `RunningIssueSession` wraps the open SDK session and owns the lifetime
- Steering HTTP request looks up the session by ID and calls `session.sendMessage(steeredPrompt)`
- Advantages:
  - Reuses existing `RunningLiveSession` pattern (battle-tested)
  - No SDK changes needed
  - Steering is immediate (not queued)
- Disadvantages:
  - If server restarts, in-flight session is lost (clients see "connection lost" + must retry)
  - Memory footprint grows with concurrent runs

**Option B: Steering Queue (Conservative)**
- Steering messages stored in a `steering_messages` table with `(issueRunId, message, ingested_at, status)`
- `executeAgentRun()` wrapper polls the queue before each turn
- If steering message exists, prepend it to the next user turn: `"[Steering from operator: ...]\n{agent_response}"`
- Advantages:
  - Survives server restart (message persisted)
  - No in-memory session registry
- Disadvantages:
  - Latency: steering only takes effect on the NEXT turn (not immediate)
  - UX is degraded: "interrupt" feels delayed

**Recommendation:** Start with **Option A** (Active Session Registry). Provide a graceful "session lost, reconnect" message if the server crashes. For Phase 2, add Option B as a persistence layer (hybrid: try immediate inject, fall back to queue).

**Steering message shape:**
```json
{
  "issueRunId": "...",
  "action": "inject" | "interrupt" | "redirect",
  "message": "user text or new direction",
  "actor": "user email or 'system'",
  "ingestedAt": "2026-05-16T04:11:00Z"
}
```

### 4.4 Authentication & Authorization

**Current:** Squadboard is single-user/single-project-per-board (no multi-user RBAC yet).

**For now:**
- All requests from the same browser session are trusted
- No per-user permission checks on steering (any viewer can steer)

**Future (post-MVP):**
- Steering should probably require a specific role (e.g., "run_operator" or "can_steer_runs")
- Audit log: record who steered, when, and what message
- Proposal: Add a `steering_actions` table: `(id, runId, actor, action, message, ingestedAt)`

### 4.5 Conflict Handling

**Simultaneous steering from two viewers:**
1. Both HTTP requests arrive within milliseconds
2. First request wins: `sendMessage()` is called with message A
3. Second request queues message B or returns "session busy" error
4. UI shows toast: "Another viewer is steering. Your message was queued."

**If either message causes an agent error:**
- Error event emitted: `session.error`
- All viewers see the error
- Session enters error state; no further steering accepted

---

## 5. State & Persistence

### 5.1 New Schema Fields / Tables

#### Option A: Minimal (Reuse existing)
- **`issue_runs`:** No new columns. Reuse existing fields:
  - `status`: already has `'running'`, `'completed'`, `'failed'`
  - `output`: already stores final output (no need for intermediate events)
  - `started_at`, `updated_at`: already tracked
- **New table:** `issue_run_events` (mirrors `live_session_events`):
  ```sql
  CREATE TABLE issue_run_events (
    id BIGSERIAL PRIMARY KEY,
    runId UUID NOT NULL REFERENCES issue_runs(id) ON DELETE CASCADE,
    type TEXT NOT NULL,  -- session.message, session.delta, session.usage, etc.
    payload JSONB NOT NULL,
    createdAt TIMESTAMP DEFAULT NOW(),
    INDEX (runId, createdAt)
  );
  ```
  - Allows replaying the event stream on reconnect
  - Supports pagination for long-running tasks

#### Option B: Extended
- Add columns to `issue_runs`:
  - `inputTokens: INT DEFAULT 0`
  - `outputTokens: INT DEFAULT 0`
  - `costUsd: DECIMAL(10,6) DEFAULT 0`
  - `steeredBy: TEXT` (snapshot of last steering actor, for audit)
  - `steeringCount: INT DEFAULT 0` (counter for monitoring)
- Purpose: Denormalized metrics for quick access without joining `issue_run_events`
- Trade-off: Updates on every event (more writes) vs. faster query time

**Recommendation:** Start with Option A. Denormalize counters in Option B if performance becomes an issue.

### 5.2 Event Persistence & Reconnection

**Scenario:** Viewer's WS drops; user refreshes the browser.

**Current LiveSession behavior:**
- Client fetches `GET /api/projects/:id/sessions/:sessionId` (returns row + all events from DB)
- Replays events in the viewer
- Resubscribes to WS for future events

**For issue_run events:**
- New endpoint: `GET /api/issues/:id/runs/:runId/events` (returns paginated event list)
- Replay logic same as LiveSession
- Resubscribe to WS project room
- Only events ingested since the last reconnect are sent (avoid duplicate replay)

### 5.3 Event Cleanup / Archival

**Retention policy:**
- Keep all `issue_run_events` for 90 days (run for audit + cost analysis)
- After 90 days, archive to cold storage (not in scope for MVP)
- For streaming feedback, events should be available for at least the run's entire lifetime + 7 days post-completion

---

## 6. Coordinator-Aware Design (W28+ Context)

### 6.1 Coordinator Telemetry in the Viewer

**After mini-coordinator lands (W28–W29):**

`issue_run` creation flow becomes:
```
Auto-router creates issue_run (status='pending')
→ Coordinator daemon woken up
→ LLM decides: agent=Hockney, model=claude-sonnet-4.6, reasoning={...}
→ Coordinator emits 'issue_run.coordinator_chosen' event
→ Run transitions to status='running'
→ Agent session begins
```

**Viewer shows coordinator reasoning:**
- Header bar gets a "Coordinator decision" collapsible section:
  ```
  🔹 Coordinator chose Hockney (claude-sonnet-4.6)
     "Hockney specializes in API design; this issue is about endpoint 
      routing. Model sonnet-4.6 provides good cost/quality for this task."
     [Tokens: 245 | Cost: $0.005]
  ```
- Collapsed by default; expand on click
- If coordinator reasoning changed agents mid-run (unlikely but possible), show a "Redirected by coordinator" message

**Steering messages may route through coordinator (future):**
- User clicks "Redirect to Keyser instead"
- Message: `{ action: 'redirect', toAgentId: 'keyser-...' }`
- Server asks coordinator: "User wants Keyser. Should I honor this?"
- Coordinator responds: "Yes, graceful handoff" or "No, Hockney is already 70% done"
- Result shown to user: "Handoff approved" or "Suggestion noted; continuing with Hockney"

**For now (MVP):**
- Don't over-design for coordinator routing
- Just expose the coordinator's initial choice in the viewer header
- Steering is a simple message injection (no coordinator approval loop)
- Coordinator routing can layer on in Phase 2

### 6.2 Event Bus Integration

- Coordinator events: `coordinator.decision_made`, `coordinator.guidance_requested`
- Scoped to project (same as issue_run events)
- Viewer subscribes to both run events + coordinator events for the project

---

## 7. Implementation Breakdown (W28 Execution)

### Todo List

**[S] T1: Schema & Migration**
- Create `issue_run_events` table (mirrors `live_session_events`)
- Optional: Add denormalized token/cost columns to `issue_runs`
- Files: `packages/server/src/db/schema.ts`, migration
- Estimate: **Small** (30 min)

**[S] T2: Event Streaming Adapter for Issue Runs**
- Create `RunningIssueSession` class (wraps SDK session, mirrors `RunningLiveSession`)
- Attach SDK event listeners and translate to `session.*` event types
- Implement `attachListeners()` method (same pattern as squad-stream.ts line 124–143)
- Files: `packages/server/src/sdk/issue-stream.ts` (new), `packages/server/src/sdk/squad-client.ts` (adapt)
- Estimate: **Small** (45 min)

**[S] T3: Wire Event Streaming Into executeAgentRun()**
- Replace one-shot `createAgentSession()` call with `createStreamedAgentSession()` (or wrap to emit events)
- Publish events to event bus during execution
- Persist events to `issue_run_events` table
- Files: `packages/server/src/sdk/bridge.ts`, `packages/server/src/engine/stepper.ts`
- Estimate: **Small** (45 min)

**[M] T4: Steering Injection Endpoint**
- POST `/api/issues/:id/runs/:runId/steer`
- Req body: `{ action, message, actor? }`
- Look up `issueRunId` from issue + run
- Fetch active session from registry
- Call `sendMessage(steeringPrompt)`
- Return success or "session not found" / "run not running"
- Files: `packages/server/src/routes/issues.ts` (extend)
- Estimate: **Medium** (1 hour)

**[S] T5: Active Session Registry**
- Global `Map<issueRunId → RunningIssueSession>` with registration/deregistration
- Add/remove on stream start/stop
- Files: `packages/server/src/sdk/issue-stream.ts`
- Estimate: **Small** (20 min)

**[S] T6: Events Query Endpoint**
- GET `/api/issues/:id/runs/:runId/events?limit=50&offset=0`
- Return paginated `issue_run_events` ordered by `createdAt`
- Files: `packages/server/src/routes/issues.ts` (extend)
- Estimate: **Small** (30 min)

**[S] T7: Client API Hook — useRunStream()**
- React hook to subscribe to `issue_run` events via WS
- Parallels `useSessionStream()` for live sessions
- Filter events by `sessionId = runId`
- Files: `packages/client/src/api/runs.ts` (new)
- Estimate: **Small** (20 min)

**[M] T8: LiveRunViewer Component**
- New React page/panel showing run header + metrics + event stream + steering bar
- Route: `/projects/:id/runs/:runId` or side panel modal
- Renders based on event types (similar to AgentActivityFeed)
- Files: `packages/client/src/pages/LiveRunViewer.tsx` (new), `packages/client/src/components/runs/RunMetricsBar.tsx`, `packages/client/src/components/runs/RunSteeringBar.tsx`
- Estimate: **Medium** (2 hours)

**[S] T9: Board Card Row Action — "Watch" Button**
- Add button to board card row if `run.status = 'running'`
- Button opens LiveRunViewer or navigates to `/projects/:id/runs/:runId`
- Files: `packages/client/src/components/board/BoardCardRow.tsx` (extend)
- Estimate: **Small** (20 min)

**[S] T10: Event Stream Reconnection Logic**
- Client WS drops → fetch cached events from `GET .../runs/:runId/events`
- Replay events with minimal janking
- Resubscribe to WS
- Files: `packages/client/src/pages/LiveRunViewer.tsx` (extend), `packages/client/src/realtime/ws-client.ts` (extend)
- Estimate: **Small** (30 min)

**[S] T11: Steering Message Persistence (Optional for MVP, Phase 2)**
- Create `steering_messages` table for fallback queueing
- Fallback if active session not found
- Files: `packages/server/src/db/schema.ts`, `packages/server/src/routes/issues.ts`
- Estimate: **Small** (45 min, Phase 2)

**[S] T12: Tests & Integration**
- Unit tests for `RunningIssueSession` event emission
- Integration test for steering endpoint
- E2E test (optional): Start run, watch events, send steering message, verify response
- Files: `*.test.ts` in parallel
- Estimate: **Small** (1 hour)

---

## 8. Open Questions for Brady

1. **Session lifecycle on steering injection:**
   - Should steering always queue for the next turn, or can we interrupt mid-token-stream?
   - If interrupt, should the agent see a partial message or start fresh?

2. **Coordinator integration timing:**
   - Should we anticipate coordinator events in the v1 design (headers/styling), or fully decouple?
   - Recommend: Design generic, implement w/ placeholder for coordinator in v1.

3. **Budget guardrails:**
   - Should a steering message that might push the run over budget trigger a confirmation UI?
   - Or just show a warning and let the user decide?

4. **Multi-user steering conflicts:**
   - For single-user squad board (now), do we need explicit "take control" locking?
   - Recommend: Keep it simple; queue + toast for now. Lock in Phase 2 if needed.

5. **Mobile-first consideration:**
   - Should LiveRunViewer support mobile/tablet screens in v1, or desktop-only?
   - Recommend: Mobile-aware (bottom sheet for input), but not full touch optimization yet.

6. **Audit trail depth:**
   - Do steering messages need to be logged to a separate audit table, or is event history enough?
   - Recommend: Event history is sufficient for MVP. Add audit table in compliance wave.

---

## 9. Risks & Alternatives

### 9.1 Risk: SDK Mid-Turn Injection Not Supported

**Risk:** The Squad SDK's `SquadClient.sendMessage()` may not work mid-response (e.g., while token-streaming).

**Mitigation:**
1. Test immediately: Can `sendMessage()` interrupt a stream-in-progress?
2. If no: Fall back to queue-and-deliver-after-next-turn (Option B above)
3. If yes: Implement Option A and document the behavior

**Fallback plan:** "Passive viewer first, steering second wave" — Ship v1 as read-only event stream (no steering), add steering in Phase 2 once SDK capability is verified.

### 9.2 Risk: Performance Degradation (High Event Volume)

**Risk:** Streaming many small `session.delta` events (every token) could overwhelm the event bus / DB inserts.

**Mitigation:**
1. Throttle or batch deltas: only emit every N tokens or every 100ms
2. Use `stream_buffering` pattern: collect deltas in memory, emit once per 500ms
3. Don't persist every delta to DB; persist only message completions (already done in squad-stream.ts)

**For MVP:** Emit all deltas to WS (low overhead, already working in LiveSession), but batch DB inserts.

### 9.3 Risk: Memory Leak in Session Registry

**Risk:** `Map<runId → RunningIssueSession>` could grow unbounded if runs don't clean up properly.

**Mitigation:**
1. Enforce cleanup on run completion (success or error)
2. Add a TTL: if run is still "running" after 24 hours, auto-evict and mark as stalled
3. Add monitoring/alerting on registry size
4. Log warnings if cleanup is missed

**Implementation:** Add a periodic sweep in the engine heartbeat (already exists).

### 9.4 Alternative: Don't Stream Issue Runs, Only Stream Manual Live Sessions

**Rejected:** This would require users to manually start a "consulting session" instead of routing through the board, defeating the purpose of automation. The whole value prop is "see the bot working" without extra clicks.

### 9.5 Alternative: Defer Steering to Phase 2, Launch as Read-Only Viewer

**Considered:** Ship only the passive event stream (no injection) to validate the surface.

**Recommendation:** Include steering endpoint in v1 (simple to add, high value). If SDK testing reveals blocking issues, disable steering via a feature flag but keep the endpoint code.

---

## 10. Summary & Recommendation

### What We're Shipping (W28)

1. **Streaming issue_run events** to event bus (already have infrastructure)
2. **New LiveRunViewer UI** to watch events in real time
3. **Steering injection endpoint** to send messages to the running session
4. **Board card action button** to jump into a running run
5. **Coordinator telemetry** surfaced in viewer header (anticipate future; placeholder shape now)

### What We're Not Shipping (Phase 2+)

- Steering message audit table (use event history instead)
- Multi-user locking / conflict resolution UI
- Explicit "take control" affordance
- Server restart persistence (use Phase 2 queue table)
- Mobile-specific touch optimizations

### Why This Design

- **Reuses existing patterns:** Event bus, WS rooms, RunningLiveSession shape
- **Minimal schema changes:** One new table (`issue_run_events`), no breaking migrations
- **Coordinator-ready:** Generic event types don't assume direct dispatch; coordinator reasoning surfaces in viewer header
- **Graceful degradation:** If steering fails, viewer still works as read-only stream
- **Clear ownership:** Issue runs become "observable" without changing core execution model

---

## Appendix: File Manifest

### New Files
- `packages/server/src/sdk/issue-stream.ts` — RunningIssueSession class + registry
- `packages/client/src/pages/LiveRunViewer.tsx` — Main viewer page
- `packages/client/src/components/runs/RunMetricsBar.tsx` — Metrics display
- `packages/client/src/components/runs/RunSteeringBar.tsx` — Steering input
- `packages/client/src/api/runs.ts` — React hooks for run streams

### Modified Files
- `packages/server/src/db/schema.ts` — Add `issue_run_events` table
- `packages/server/src/sdk/bridge.ts` — Adapt `executeAgentRun()` to stream events
- `packages/server/src/engine/stepper.ts` — Pass registry to runner
- `packages/server/src/routes/issues.ts` — Add steer + events endpoints
- `packages/client/src/components/board/BoardCardRow.tsx` — Add Watch button
- `packages/client/src/realtime/ws-client.ts` — Event type for steering
- `packages/server/src/realtime/event-bus.ts` — Verify session.steered already present

---

**End of Design Doc**
