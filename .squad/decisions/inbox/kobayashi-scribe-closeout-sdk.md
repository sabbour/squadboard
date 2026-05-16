# Decision: squadboard.scribe.closeOut() — SDK contract and ceremony registration

**Date:** 2026-05-15T22:14:50.847-07:00
**Author:** Kobayashi (Squad SDK Integrator)
**Wave:** 14 — q8-scribe-as-ceremony
**Status:** Accepted

---

## Summary

Carved `squadboard.scribe.closeOut()` into a new library package and registered it as
a first-class ceremony in the server's ceremony registry. This is the convergence point
that unblocks Verbal (q7 daemon) and Wave 15 (q9 End Wave button).

**Course-corrected (same wave):** Initial implementation diverged from the spec by
replacing the date-window archive gate with a size-target algorithm. Corrected —
the SDK is now a verbatim mirror of squad.agent.md tasks 0-8. See "Mirror contract"
section below.

---

## Mirror contract — SDK is a verbatim mirror of squad.agent.md tasks 0-8

**Rule (established Wave 14, q8, 2026-05-15):**
The SDK MUST NOT diverge from squad.agent.md. If the algorithm is wrong, the
fix goes into squad.agent.md FIRST, then the SDK is synced. Never the other way.
"One algorithm, multiple callers" — Scribe stays one agent with one spec.

**Sync verification recipe:**
1. Open `.github/agents/squad.agent.md`, search "SPAWN MANIFEST".
2. For each task 0-8, locate the corresponding primitive in
   `packages/squadboard-sdk/src/scribe/primitives.ts`.
3. Confirm thresholds, logic, and paths match the spec exactly.
4. Any divergence is a bug in the SDK file, not in squad.agent.md.

**Current SDK ↔ spec mapping (as of 2026-05-15):**

| squad.agent.md task | SDK primitive |
|---|---|
| 0 PRE-CHECK | `archiveDecisionsBySize` (measures size as first step) |
| 1 DECISIONS ARCHIVE | `archiveDecisionsBySize` — 20480B→30d, 51200B→7d (date-window, verbatim) |
| 2 DECISION INBOX | `mergeInbox` |
| 3 ORCHESTRATION LOG | `writeOrchestrationLogs` |
| 4 SESSION LOG | `writeSessionLog` |
| 5 CROSS-AGENT | `crossAgentHistoryUpdates` |
| 6 HISTORY SUMMARIZATION | `summarizeHistoryIfLarge` — 15360B threshold (verbatim) |
| 7 GIT COMMIT | `commitScribeFiles` — individual `git add -- <path>`, -F flag (verbatim) |
| 8 HEALTH REPORT | `CloseOutResult` fields (decisionsSize, inboxFilesMerged, etc.) |

**Known follow-up against squad.agent.md (do NOT fix in SDK):**
Wave 13 Scribe-4 left decisions.md at 74.7KB after task #1 ran. This is because
the date-window approach cannot guarantee the file shrinks when all content is
"recent." The correct fix is to update squad.agent.md task #1 to add a targetBytes
guarantee (e.g., "archive oldest entries until file ≤ 30KB"), then sync the SDK.
Filed as a follow-up against squad.agent.md for a future wave.

---

**Chose (a)** — separate package from `packages/squadboard/`.

Rationale:
- `packages/squadboard/` is a *distribution* package: coordinator-fragment.md, postinstall
  script, no TypeScript source. Adding a code library there would blur the boundary.
- Future SDK consumers (Auditor agent, Verbal daemon, plugin authors) import a library,
  not a distribution artifact. Clean separation makes versioning and testing straightforward.
- Rule: MCP protocol surface (`packages/squadboard/`) stays distinct from library surface
  (`packages/squadboard-sdk/`).

Package name: `@sabbour/squadboard-sdk` · workspace peer in pnpm-workspace.yaml.

---

## SDK contract

```typescript
// packages/squadboard-sdk/src/scribe/close-out.ts

interface CloseOutOptions {
  projectId?: string;
  spawnManifest?: SpawnManifest;
  teamRoot?: string;
  archiveThresholdBytes?: { soft?: number; hard?: number; target?: number };
  commitMessage?: string;
  push?: boolean; // default false; daemon sets true when remote configured
}

interface CloseOutResult {
  decisionsArchived: boolean;
  decisionsSize: { before: number; after: number };
  inboxFilesMerged: number;
  orchestrationLogsWritten: number;
  sessionLogPath: string | null;
  historiesUpdated: string[];
  historiesSummarized: string[];
  commitSha: string | null;
  pushed: boolean;
  errors: Array<{ step: string; error: string }>;
}

async function closeOut(opts: CloseOutOptions): Promise<CloseOutResult>;
```

The implementation is a thin orchestrator that delegates to seven named primitives:

| Primitive | Implements task # (squad.agent.md) |
|---|---|
| `archiveDecisionsBySize` | 0 (pre-check) + 1 (archive gate) |
| `mergeInbox` | 2 (inbox merge) |
| `writeOrchestrationLogs` | 3 (orch logs) |
| `writeSessionLog` | 4 (session log) |
| `crossAgentHistoryUpdates` | 5 (cross-agent) |
| `summarizeHistoryIfLarge` | 6 (history summarization) |
| `commitScribeFiles` | 7 (git commit) |

All primitives are named exports — independently importable for testing or composition.

---

## Archive-gate bug fix

**Problem (Wave 13, Scribe-4):** decisions.md ended at 74.7KB after Scribe ran. The old
date-window approach (archive entries older than 7d / 30d) failed because most content
was "recent" — archiving by date doesn't guarantee the file shrinks below the threshold.

**Fix in `archiveDecisionsBySize`:** Walk H2 sections from OLDEST to NEWEST. Move the
oldest sections to `decisions-archive.md` until the file is ≤ `targetBytes` (default 30KB).
This guarantees convergence regardless of how recent the content is.

Parameters:
- `softBytes` (default 20KB) — gate trigger
- `hardBytes` (default 51KB) — trigger more aggressive target
- `targetBytes` (default 30KB) — guaranteed post-archive size

**For Scribe's next pass:** The squad.agent.md task #1 still uses the old date-window
logic. When the CLI coordinator migration happens (see below), replace task #1 with a
call to `archiveDecisionsBySize` with `targetBytes: 30720`.

---

## Convergence pattern — three caller paths, one function

```
CLI coordinator (squad.agent.md spawn)          ─┐
Standalone daemon (q7, Verbal building now)      ├─► squadboard.scribe.closeOut()
Manual "End Wave" button (q9, Wave 15)          ─┘
```

All three paths call the same `closeOut()` with the same contract. Differences are in
the options they pass:
- CLI coordinator: `push: false`, `spawnManifest` from the active run
- Daemon: `push: true` (if remote configured), `spawnManifest` from scheduled run
- Button: `push: false`, `spawnManifest` optional (user may not have one)

---

## Ceremony registration

`ceremony-translator.ts` now has a `BUILT_IN_CEREMONIES` registry:

```typescript
{
  id: 'scribe-close-out',
  name: 'End-of-Wave Close-Out',
  facilitator: 'scribe',
  participants: ['scribe'],
  triggers: { manual: true, scheduled: true, coordinator: true },
  invoke: async (ctx) => {
    const sdk = await import('@sabbour/squadboard-sdk');
    return sdk.squadboard.scribe.closeOut({ projectId: ctx.projectId, ... });
  },
}
```

Public functions added to ceremony-translator.ts:
- `getBuiltInCeremony(id)` — lookup by id
- `listBuiltInCeremonies()` — for daemon discovery and ceremony picker UI
- `invokeBuiltInCeremony(id, ctx)` — fire by id (throws if not found)

To add a new ceremony: push an entry to `BUILT_IN_CEREMONIES`. No other changes needed.

---

## What changes for the CLI coordinator migration (future wave)

When Ahmed decides to migrate the CLI coordinator's Scribe spawn to call the SDK:

1. In `squad.agent.md`, replace the Scribe `prompt:` block with a single MCP tool call:
   `squadboard_invoke_ceremony` (tool to be added to `packages/server/src/mcp/server.ts`)
   with `{ ceremonyId: 'scribe-close-out', spawnManifest: {spawn_manifest} }`.
2. The MCP tool calls `invokeBuiltInCeremony('scribe-close-out', ctx)`.
3. Remove tasks 0-8 from the spawn prompt entirely — the SDK handles them.
4. The Scribe agent itself stays unchanged (charter.md is immutable).

Until that migration: the CLI coordinator continues to spawn Scribe directly with the
9-task prompt. The SDK and the spawn template coexist without conflict.

---

## What stays the same

- Scribe's charter.md — unchanged
- squad.agent.md Scribe spawn template — unchanged (deferred migration)
- MCP tool surface in packages/server/src/mcp/server.ts — unchanged (invoke_ceremony
  tool is future scope)
- The daemon (q7, Verbal) and the button (q9) — not built here, but both unblocked
