# 2026-05-16: Verbal W26 — Auto-assign to Fenster + To Do Heartbeat Pickup

## Summary

Two bugs together broke the "add card → run" loop end-to-end. Both are fixed in this wave.

---

## Bug A: Auto-assign Defaults to Fenster

### Root Cause (one line)
The keyword routing `matchRule` used a word-length filter of `> 3` chars, allowing short generic words like `"type"` (4) and `"icon"` (4) in Fenster's routing pattern to match almost any engineering issue, routing unrelated items to Fenster instead of leaving them unassigned.

### Evidence
The routing.md "Work Type → Route To" table includes the Fenster pattern:
`"Visual design, UX flows, color/type/icon system, empty states"`.
After splitting on `/[\s,/]+/` and filtering `> 3` chars, the word `"type"` (4 chars) survived and would match any issue mentioning TypeScript types, type errors, or type parameters. Similarly `"icon"` (4 chars) matched any UI reference to icons. Since these words are ubiquitous in any codebase, Fenster's rule effectively behaved as a near-catchall.

Secondary anti-patterns also present (not the primary cause, but cleaned up):
- `resolveRouteTier3` fallback paths fell back to `activeAgents[0]` (undefined DB order, often Fenster alphabetically) when LLM routing failed.
- MCP `run_agent` without explicit `agentId` picked `LIMIT 1` without `ORDER BY` — also undefined.

### Fix
1. **`packages/server/src/services/routing-compiler.ts`** — `matchRule` keyword filter changed from `w.length > 3` to `w.length > 4`. Words must now be ≥ 5 chars to participate in keyword matching. This removes `"type"`, `"icon"`, `"live"`, `"view"` (all 4 chars) from spurious matching while keeping meaningful keywords like `"design"` (6), `"flows"` (5), `"color"` (5), `"stepper"` (7), etc.

2. **`packages/server/src/engine/router.ts`** — `resolveRouteTier3` fallback paths now return `null` instead of `activeAgents[0]`. A Tier-3 failure (LLM error, schema violation, or unresolved agent name) now produces "all tiers exhausted → human triage" rather than silently routing to an arbitrary agent. All `activeAgents` queries now include `ORDER BY name ASC` for determinism.

3. **`packages/server/src/mcp/server.ts`** — `handleRunAgent` auto-pick (no `agentId` supplied) now uses a least-loaded subquery (`COUNT pending+running runs`) with `name ASC` tiebreak instead of undefined `LIMIT 1` order.

---

## Bug B: Heartbeat Doesn't Pick Up New To Do Items

### Root Cause (one line)
No sweep existed to scan `issues` with `status='todo'` and no active `issue_run`, so items that landed in the To Do column with no routing match were never auto-dispatched.

### Evidence
The `ready-workflow-steps` sweep calls `claimAndRun()` every 5 s, which claims existing **pending** `issue_runs`. But if an item arrives in To Do without a routing match (because Bug A's Fenster false-positive was fixed, OR because the HTTP route only uses Tier-1 and no label rule matched), no `issue_run` row is ever created — so `claimAndRun()` has nothing to claim.

### Fix
4. **`packages/server/src/engine/sweeps/pickup-todos.ts`** (NEW) — `pickupTodosSweep` runs every 10 s and:
   - Queries all `issues` with `status='todo'` and `archived=0`.
   - Filters to those with no `pending` or `running` `issue_run` (idempotent guard).
   - Per uncovered issue: runs Tier-2 keyword scoring (`resolveRouteTier2`) → if score > 0, creates a `pending` `issue_run` for the matched agent with `routingTier=2`.
   - If Tier-2 yields no match: falls back to the **least-loaded active agent** (agent with fewest pending+running runs, tiebroken by name) so work is distributed rather than piled onto a single agent.

5. **`packages/server/src/index.ts`** — imports and registers `pickupTodosSweep`.
6. **`packages/server/heartbeat.config.json`** — adds `"pickup-todos": { "intervalMs": 10000, "enabled": true }`.
7. **`packages/client/src/components/heartbeat/SweepTimeline.tsx`** — adds `pickup-todos` lane (`"Todo Dispatch"`) to `ALL_SWEEPS` per W25 pattern.

---

## Canonical Assignment Rule (going forward)

| Scenario | Behavior |
|---|---|
| Issue created with a matching **label** routing rule | Tier-1 routes immediately; `issue_run` created on POST |
| Issue created with a matching **keyword** routing rule (≥5-char words) | Tier-1 routes immediately; `issue_run` created on POST |
| Issue created with **no routing match** | Item starts unassigned; no `issue_run` created at POST time |
| Item sits in **To Do** with no active run | `pickup-todos` sweep (10 s) auto-dispatches via Tier-2 scoring or least-loaded fallback |
| **No active agents** in project | Item stays in To Do with a console warning; user must hire or activate an agent |
| Tier-3 LLM routing **fails** | Returns null → "human triage" log; no run created; `pickup-todos` handles it on next tick |
| MCP `run_agent` with **no agentId** | Picks least-loaded active agent (not first alphabetical) |

**Default for new items: unassigned until Tier-1/2 routes or `pickup-todos` sweep fires.**

---

## Files Changed

| File | Change |
|---|---|
| `packages/server/src/services/routing-compiler.ts` | `matchRule` keyword min-length `> 3` → `> 4` |
| `packages/server/src/engine/router.ts` | Tier-3 fallbacks return `null`; `ORDER BY name` on agent queries; add `asc` import |
| `packages/server/src/mcp/server.ts` | `handleRunAgent` least-loaded pick; add `sql`, `asc` imports |
| `packages/server/src/engine/sweeps/pickup-todos.ts` | NEW — To Do dispatch sweep |
| `packages/server/src/index.ts` | Import + register `pickupTodosSweep` |
| `packages/server/heartbeat.config.json` | Add `pickup-todos` entry |
| `packages/client/src/components/heartbeat/SweepTimeline.tsx` | Add `pickup-todos` lane |
| `packages/server/src/__tests__/triage-and-heartbeat.test.ts` | NEW — 10 vitest cases (7 Bug A + 3 Bug B) |

---

## Test Results

- 10 new vitest cases: all passing.
- 434 total server tests: all passing.
- `pnpm -r build`: green.
