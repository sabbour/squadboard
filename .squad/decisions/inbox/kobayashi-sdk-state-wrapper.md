# Decision: sdk-state-wrapper API Surface

**Author:** Kobayashi (Squad SDK Integrator)  
**Date:** 2026-05-15T08:21:46.164-07:00  
**Phase:** p5-state-wrapper  
**Status:** Settled

---

## SquadState API Surface Chosen

`SquadState.fromStorage(storage, rootDir)` is used (synchronous factory) rather than the async `SquadState.create()` because:

- `projects.path` in the DB is already the validated `.squad/` directory — it was written there by `linkProjectToSquad()`, which calls `validateSquadDir()` before persisting.
- Re-validating on every cache miss is redundant I/O.
- `fromStorage()` constructs all eight collection instances (`agents`, `routing`, `decisions`, `skills`, `team`, `templates`, `config`, `log`) immediately without hitting the filesystem.

`projects.path` is the `.squad/` dir itself; `SquadState` expects its parent, so `rootDir = path.dirname(squadPath)`.

`FSStorageProvider` is constructed with `rootDir` as the confinement root, preventing any path-traversal escapes out of the project directory.

Collections exposed:
| Accessor | Collection class | Primary methods |
|---|---|---|
| `getAgents()` | `AgentsCollection` | `.list()`, `.get(name)`, `.create()`, `.delete()` |
| `getRouting()` | `RoutingCollection` | `.get()`, `.update()` |
| `getDecisions()` | `DecisionsCollection` | `.list()`, `.add()` |
| `getSkills()` | `SkillsCollection` | `.list()`, `.get(id)`, `.exists()` |
| `getTeam()` | `TeamCollection` | `.get()`, `.update()` |
| `getTemplates()` | `TemplatesCollection` | `.list()`, `.get(id)`, `.exists()` |
| `getConfig()` | `ConfigCollection` | `.get()`, `.update()`, `.exists()` |

`log` is accessible via `state.log` but not given a dedicated top-level accessor (it's internal plumbing; callers can reach it via `getState(id).then(s => s.log)` if needed).

---

## Cache Invalidation Strategy

A module-level `Map<string, SquadState>` caches one instance per `projectId`.

- **Hit:** returns the same in-memory instance — collections share the `FSStorageProvider`, which in turn hits the real filesystem on each collection `.get()` / `.list()` call. There is no stale-data risk for reads because the storage layer never caches file contents.
- **Invalidation trigger:** callers invoke `invalidateState(projectId)` to evict the entry. Appropriate when the project's linked `.squad/` path changes (e.g., after `linkProjectToSquad()` with a new path).
- **Process restart:** the Map is in-process memory only — it is rebuilt fresh on every server start.
- **Granularity:** per-projectId, not per-collection. Evicting a single project doesn't affect others.

---

## SDK Quirks Discovered

1. **`FSStorageProvider` constructor is optional-rootDir** — passing it confines all paths; omitting it allows the provider to touch anywhere. Always pass `rootDir` for security.
2. **`SquadState.fromStorage` is synchronous** — it doesn't validate the `.squad/` directory exists. Validation happens at a higher layer (the DB `projects.path` column is already validated on write).
3. **`log` collection exists on `SquadState`** but is not exported by the barrel in `state/index.d.ts` as a top-level named type import — it's accessible only via `state.log` at runtime.
4. **Collection constructors are not exported** — `AgentsCollection` etc. can be imported by name for typing purposes but should only be *instantiated* via `SquadState`, never `new AgentsCollection(...)` directly from service code.
