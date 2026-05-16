# Hockney Agent — Compact History Summary

**Focus areas:** Server architecture (routes, websockets, MCP, embedded-postgres), diagnostics, heartbeat registry, backend lifecycle management.

**Key learnings:**
- Heartbeat registry: 6 sweeps, ~30s cadence per sweep (5s fast, 25s standard, 5s heartland). Check `lastTickAt` and ring cursor advancement via `GET /api/heartbeat/status` for smoke-test verification.
- Diagnostics false-negative resolution: double-nesting bug in `resolveSquadDir()` when `projects.path` pointed AT `.squad/` (not parent). Solution: helper tolerates both layouts, returns single clear error.
- MCP Phase 1 starter tools: 11 tools total (stdio + HTTP transports), naming convention (bare names, no `squadboard.*` prefix). Tools: `list_projects`, `list_inbox`, `capture` (Conjure classifier), `get_routing`.
- Express route ordering trap: `POST /formulate` MUST register BEFORE parameterized `GET /:id` / `PATCH /:id` routes. Express matches declaration order.
- Formulate routes use `{ ok, error }` envelope (not bare `{ error }`), matching `apiFetch<Envelope<T>>`.
- `curl` smoke-test for missing routes: returns `<!doctype html>` when route not mounted → client `JSON.parse('<!doctype ...')` throws. Add route-mount auditing to Wave DoD.
- per-file `git add -- <path>` discipline: prevents accidental sweeps of other agents' uncommitted changes (mcmanus history, server/index.ts, vite churn).

**Recent work:**
- other two → `ok: false, reason: "no .squad/ directory found at ... or ..."`
  — single, clear, actionable. (Their `.squad/` was indeed never created.)

**Files touched (4 total):**
- `packages/server/src/services/diagnostics.ts` — +`resolveSquadDir`,
  rewrote `checkSquadDirShape` body, updated `checkDiskWriteable`.
- `packages/server/src/mcp/server.ts` — +4 TOOLS entries, +4 handlers,
  +4 switch cases, imports for new services.
- `packages/server/src/mcp/README.md` — new file.

**Decision filed:** `.squad/decisions/inbox/hockney-mcp-and-diagnostics.md`.

**Status:** COMPLETE. `tsc --noEmit` clean. Local commits only — not pushed.

### Learnings

1. **Read what's already there before adding a new package.** The brief
   suggested standing up `packages/mcp/` for the MCP server. A 30-second
   look at `packages/server/src/mcp/` showed the whole stdio + HTTP
   apparatus was already built (Phase 18). Extending the existing factory
   was the right call — same lifecycle, same DB pool, same build.
2. **`projects.path` semantics are inconsistent across the table.** The
   schema comment says ".squad/ directory" but seeders / project-create
   flows have stored both layouts. Future writers should either (a) pick
   one layout and migrate, or (b) keep using `resolveSquadDir()`. Logged
   in the decision doc as a follow-up.
3. **Cascading false-negatives mask the actual bug.** When a parent check
   fails, don't run dependent child checks — they generate noise. Pattern
   is now: resolve once, fail-fast with remediation, only descend when the
   parent is healthy.

---

## Heartbeat live verification path — Wave 10 E4 (2026-05-15T13:09:47-07:00)

**Verified by:** Hockney (programmatic, no browser needed)

### Data path traced

| Layer | Detail |
|---|---|
| Engine | `engine/heartbeat.ts` — `Heartbeat._runSweep()` sets `this.lastTickAt = new Date()` on every sweep completion |
| Sweeps | 6 registered: `stuck-issue-runs` (30s), `stale-presence` (30s), `idle-live-sessions` (60s), `ready-workflow-steps` (5s), `ceremonies-due` (5s), `github-sync-overdue` (60s) |
| Service | `services/heartbeat.ts` — `getHeartbeatSnapshot()` reads `heartbeat.getStatus().lastTickAt` and returns it as `lastTickAt` in the snapshot. Also maintains an in-memory ring buffer (capacity 200) of recent sweep events keyed by monotonic `seq`. |
| API endpoint | `GET /api/heartbeat/status` — returns `{ active, lastTickAt, lastError, sweeps[], recent }` |
| React component | `pages/Heartbeat.tsx` — polls `/api/heartbeat/status` every 5s; renders `lastTickAt` via `relativeTime()` helper in the "Last tick" section card |
| No DB column | `lastTickAt` is pure in-memory (`Heartbeat` singleton). The lease+heartbeat column `heartbeat_at` on `issue_runs` is separate (written by runWorker at 30s interval during active LLM runs). |

### Live-fire samples (server was already running on :3000)

| Sample | `lastTickAt` | Ring cursor |
|---|---|---|
| T1 | `2026-05-15T20:15:30.871Z` | 374 |
| T2 | `2026-05-15T20:15:58.809Z` | 384 |

- **Delta:** 27.9 s ✅ (within ~30s ± 5s; driven by the 5s fast-sweeps so actual cadence is ≤5s between any tick)
- **Ring advancement:** +10 events — confirms continuous sweep completions
- **Status:** ✅ TICKING — `active: true`, no `lastError`

### Quick re-verify command (future agents)

```bash
T1=$(curl -s http://localhost:3000/api/heartbeat/status | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['lastTickAt'])")
sleep 10
T2=$(curl -s http://localhost:3000/api/heartbeat/status | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['lastTickAt'])")
echo "T1=$T1  T2=$T2"
# Expect T2 > T1 by ≥5s (fastest sweep cadence)
```

- **2026-05-15 Wave 11B — M1 (Hire-team server routes) — IN-FLIGHT:** Dispatched to fix missing POST handlers for `/api/projects/:projectId/agents/hire-team/propose` and `/hire-team/confirm`. Root cause: Express SPA catch-all returned index.html instead of JSON, client `apiFetch` threw "Unexpected token '<'". M1 adds route handlers, returns proper JSON errors. Sequenced first in Stream M to unblock M2+M3 (client-side fixes) and M4 (e2e regression test).

### Wave 11B — M1 M4 Landing (2026-05-15)

**Completed:** Added two missing POST routes in `packages/server/src/routes/agents.ts`:
- `POST /api/projects/:projectId/agents/hire-team/propose` → `{ ok: true, data: { members: CastedMember[] } }`
- `POST /api/projects/:projectId/agents/hire-team/confirm` → `{ ok: true, data: { created: Agent[], errors: [...] } }`

**Context:** Cast-Team modal crash root cause. When routes are `import`ed but missing an `app.use()` mount, Express silently falls through to SPA fallback (`res.sendFile('index.html')`). Client calls `JSON.parse('<!doctype...')` → "Unexpected token '<'" with zero context.

**Learning:** Router mounting discipline — grep `index.ts` for unmatched imports after adding any new router file. Add route-mount audit to squad DoD. The SPA catch-all is a feature trap; unimplemented routes should ideally throw 404 or register a default 404 handler instead of silently serving HTML.
