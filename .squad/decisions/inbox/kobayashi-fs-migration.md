# Decision: p5-migrate-fs — SDK Collection Migration (Phase 5)

**Author:** Kobayashi  
**Date:** 2026-05-15  
**Task:** p5-migrate-fs

---

## Raw-fs Callsites Migrated

**Total: 3 callsites replaced in 1 file (`services/agent-sync.ts`)**

| # | Original call | Replaced with |
|---|---------------|---------------|
| 1 | `fs.readdir(agentsDir, { withFileTypes: true })` | `(await getAgents(projectId)).list()` |
| 2 | `fs.access(charterPath)` + `parseCharter(charterPath)` | `(await getAgents(projectId)).get(agentName).charter()` |
| 3 | `computeCharterHash(charterPath)` (read + hash) | `computeContentHash(charterContent)` (in-memory, no fs read) |

`charter-compiler.ts` was **not** changed at the callsite level — it was refactored to expose:
- `parseCharterContent(content: string)` — pure in-memory parser (new export)
- `computeContentHash(content)` — pure in-memory hash (new export)
- `parseCharter(charterPath)` — still exists, now delegates to `parseCharterContent` internally
- `computeCharterHash(charterPath)` — still exists, now delegates to `computeContentHash` internally

No callers outside the two target files had to change.

---

## Fallback Strategy: YES — kept, and it matters

The SDK-first + raw-fs-fallback pattern was **retained** for both callsites:

**Why it was kept:**
- `getAgents(projectId)` requires a live DB connection and a valid project row. If the DB is not yet seeded (cold-start) or the project row is missing, the SDK throws `ProjectNotFoundError`.
- Charter compilation is on the critical path for agent sync, which is triggered on every `GET /agents` request. A single SDK failure must not silently kill an entire sync run.
- The watcher (`watchAgents`) fires on every file change; if the SDK cache is cold at that moment, the fallback ensures charters still get parsed.

**Fallback log prefix:** `[agent-sync]` with `console.warn` so it is observable without being alarming.

---

## SDK Quirks Discovered

1. **`AgentsCollection.get(name)` is synchronous but `AgentHandle.charter()` is async.** The handle is created synchronously; only the IO operations are async. You must `await handle.charter()` even though `agents.get(name)` itself doesn't return a promise.

2. **No SDK method to UPDATE an existing charter markdown.** `AgentsCollection.create(name, charter)` creates a new agent directory+charter; `AgentHandle.update(partial)` mutates `Agent` domain-object fields (role, status, etc.), not the raw markdown file. Consequently, `writeCharter(charterPath, meta)` in `charter-compiler.ts` was left as a raw-fs write — there is no safe SDK equivalent for in-place charter overwrites yet. Future migrations should wait for an `AgentHandle.updateCharter()` surface to appear in the SDK.

3. **`AgentsCollection.list()` returns directory names, not filtered-by-charter-existence names.** An agent directory without a `charter.md` would appear in the list, then `handle.charter()` would throw. The fallback's `fs.access` guard handles this gracefully; SDK callers need to be prepared for `charter()` to reject.

4. **The SquadState cache in `sdk-state.ts` is per-process.** Each `Promise.all` iteration that calls `getAgents(projectId)` re-enters the same cached `SquadState`, so there is no DB round-trip per agent — only one on cold-start. No performance concern.
