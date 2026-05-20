# @sabbour/squadboard-sdk

> Pre-alpha SDK for building tools on top of Squadboard.
> Separate from `@bradygaster/squad-sdk` (the Squad CLI ecosystem SDK).

## Install

```bash
npm install @sabbour/squadboard-sdk
```

## Modules

| Module | Import path | Purpose |
|--------|-------------|---------|
| Main | `@sabbour/squadboard-sdk` | Namespace object + all re-exported types |
| Scribe | `@sabbour/squadboard-sdk/scribe` | Agent close-out primitives, health reports |
| Bundle | `@sabbour/squadboard-sdk/bundle` | Schema types for portable project bundles |

---

## Scribe Module

Agent close-out orchestration. Library-ified mirror of squad.agent.md tasks 0-8.

### `closeOut(opts?)`

Run the full Scribe close-out sequence in order:
archive decisions → merge inbox → orchestration logs → session log →
cross-agent history → history compaction → git commit → optional push → optional health report.

Each step is non-fatal; failures collect in `result.errors` and the sequence continues.

**Parameters** (`CloseOutOptions` — all optional):

| Parameter | Type | Description |
|-----------|------|-------------|
| `spawnManifest` | `SpawnManifest` | Agents that ran this wave |
| `teamRoot` | `string` | Repo root (default: `git rev-parse --show-toplevel`) |
| `commitMessage` | `string` | Override the Scribe git commit message |
| `push` | `boolean` | Push after commit (default: `false`) |
| `healthReport` | `Omit<HealthReportOptions, 'teamRoot'>` | If provided, writes a step-8 health report |
| `projectId` | `string` | Project identifier (default: `SQUADBOARD_DEFAULT_PROJECT_ID`) |

**Returns:** `Promise<CloseOutResult>`

```typescript
import { squadboard } from '@sabbour/squadboard-sdk';

const result = await squadboard.scribe.closeOut({
  spawnManifest: {
    runId: 'wave-31',
    datetime: new Date().toISOString(),
    topic: 'sdk-docs',
    agents: [
      { name: 'kobayashi', summary: 'Added JSDoc to SDK and rewrote README' },
    ],
  },
  push: true,
  healthReport: {
    waveNumber: 31,
    sessionId: 'abc12345',
    backlogBefore: { total: 10, done: 4, inProgress: 2, blocked: 1, pending: 3 },
    backlogAfter:  { total: 10, done: 6, inProgress: 1, blocked: 1, pending: 2 },
    spawnSummaries: [
      { name: 'kobayashi', plainLanguageSummary: 'SDK docs complete.' },
    ],
  },
});

if (result.errors.length) console.warn('Non-fatal errors:', result.errors);
console.log('Commit:', result.commitSha);
// → "Commit: a1b2c3d4..."
```

---

### Primitive functions

Import these directly for fine-grained composition — e.g. in ceremony runners or auditors.

```typescript
import {
  archiveDecisionsBySize,
  mergeInbox,
  writeOrchestrationLogs,
  writeSessionLog,
  crossAgentHistoryUpdates,
  summarizeHistoryIfLarge,
  commitScribeFiles,
  writeHealthReport,
} from '@sabbour/squadboard-sdk/scribe';
```

#### `archiveDecisionsBySize(decisionsPath)`

Archive dated H2 sections from `decisions.md` into `decisions-archive.md` when the file
exceeds size thresholds (≥20KB → archive >30 days old; ≥50KB → archive >7 days old).

**Returns:** `Promise<ArchiveResult>` — `{ before, after, fired }`

```typescript
const { fired, before, after } = await archiveDecisionsBySize('.squad/decisions.md');
```

#### `mergeInbox(inboxDir, decisionsPath)`

Read all `.md` files in `inboxDir`, append them to `decisions.md` (deduplicating by H2
heading), then delete the source files.

**Returns:** `Promise<number>` — count of files merged

```typescript
const count = await mergeInbox('.squad/decisions/inbox', '.squad/decisions.md');
```

#### `writeOrchestrationLogs(manifest, logsDir, datetime)`

Write one orchestration-log file per agent: `{logsDir}/{isoTimestamp}-{agentName}.md`.

**Returns:** `Promise<number>` — count of files written

#### `writeSessionLog(manifest, logsDir, datetime)`

Write a brief session-log file summarising the run: `{logsDir}/{isoTimestamp}-{topic}.md`.

**Returns:** `Promise<string | null>` — path written, or `null` on failure

#### `crossAgentHistoryUpdates(manifest, agentsDir)`

Append a "team update" block to each agent's `history.md` listing peer summaries.

**Returns:** `Promise<string[]>` — names of agents whose history was updated

#### `summarizeHistoryIfLarge(historyPath)`

If a `history.md` is ≥15KB, compact the `## Learnings` section by moving older lines
to `history-archive.md`. Keeps the most recent 80 lines.

**Returns:** `Promise<boolean>` — `true` if compaction ran

#### `commitScribeFiles(allowedPaths, message, repoRoot)`

Stage each path individually with `git add -- <path>` and commit using a message file
(avoids shell-escaping bugs). Never uses broad globs.

**Returns:** `Promise<string | null>` — commit SHA, or `null` if nothing staged

#### `writeHealthReport(opts)`

Write the HEALTH REPORT artifact to `.squad/health/{date}/wave-{N}-{session}.md`.
Sections: wave summary, backlog delta, lineage tree, defects, spawn summaries,
next-wave recommendations.

**Returns:** `Promise<HealthReportResult>` — `{ path, content }`

```typescript
import { writeHealthReport } from '@sabbour/squadboard-sdk/scribe';

const { path } = await writeHealthReport({
  waveNumber: 31,
  sessionId: 'abc12345',
  backlogBefore: { total: 8, done: 3, inProgress: 2, blocked: 0, pending: 3 },
  backlogAfter:  { total: 8, done: 5, inProgress: 1, blocked: 0, pending: 2 },
  spawnSummaries: [{ name: 'kobayashi', plainLanguageSummary: 'SDK docs done.' }],
  nextWaveTodos: [{ id: 'sdk-tests', title: 'Add unit tests', status: 'in_progress' }],
});
console.log('Report at', path);
```

---

### Scribe types

| Type | Description |
|------|-------------|
| `CloseOutOptions` | Options for `closeOut()` |
| `CloseOutResult` | Full result from `closeOut()` |
| `SpawnManifest` | All agents in a single wave/run |
| `SpawnManifestEntry` | One agent's name, summary, and optional commit SHA |
| `HealthReportOptions` | Input data for `writeHealthReport()` |
| `HealthReportResult` | `{ path, content }` returned by `writeHealthReport()` |
| `BacklogSnapshot` | Backlog counts at a point in time |
| `SpawnLineageEntry` | Maps a spawn to the todos it closed |
| `SpawnSummary` | Plain-language summary for one agent |
| `NextWaveTodo` | A carry-over todo (in_progress or blocked) |

---

## Bundle Module

TypeScript types for the Squadboard Bundle format — a portable, self-describing artifact
that captures an entire project configuration.

```typescript
import type {
  SquadboardBundle,
  BundleManifest,
  BundleProject,
  BundleKanban,
  BundleTeamMember,
  BundleCeremony,
  BundleWorkflow,
  BundleAgent,
  BundleSkill,
  BundleTool,
  BundleMcpServer,
  BundleRoutingRule,
  ApplyResult,
} from '@sabbour/squadboard-sdk/bundle';
// or from the root entry:
import type { SquadboardBundle } from '@sabbour/squadboard-sdk';
```

### `SquadboardBundle`

Root wire format. All sections except `manifest` are optional.

```typescript
const bundle: SquadboardBundle = {
  manifest: {
    bundleId: 'my-project',
    name: 'My Project',
    version: '1.0.0',
    description: 'A Squadboard project bundle',
    schemaVersion: 1,
  },
  team: [
    { name: 'Lead', role: 'Coordinator', persistent: true, charter: '# Lead\n...' },
  ],
  kanban: {
    columns: [
      { slug: 'todo', label: 'To Do', order: 0 },
      { slug: 'done', label: 'Done', order: 1 },
    ],
    defaultColumn: 'todo',
  },
};
```

### Bundle types reference

| Type | Description |
|------|-------------|
| `SquadboardBundle` | Root bundle — all sections |
| `BundleManifest` | Bundle identity + schema version |
| `BundleProject` | Project display name, description, settings |
| `BundleKanban` | Kanban columns + default column |
| `BundleKanbanColumn` | One column: slug, label, order, WIP limit |
| `BundleTeamMember` | Agent team member with optional charter |
| `BundleCeremony` | Ceremony: trigger + workflow steps |
| `BundleCeremonyTrigger` | Generic trigger descriptor |
| `BundleCeremonyGithubTrigger` | GitHub webhook trigger (kind: `'github'`) |
| `BundleCeremonyTriggerKind` | Union of allowed trigger kinds |
| `BundleWorkflow` | Standalone workflow definition |
| `BundleWorkflowStep` | Discriminated union of all step types |
| `BundleWorkflowRouteStep` | Route to a named agent |
| `BundleWorkflowAgentRunStep` | Run an agent and wait |
| `BundleWorkflowApproveStep` | Wait for human approval |
| `BundleWorkflowFanOutStep` | Fan-out to parallel/serial sub-branches |
| `BundleWorkflowHandoffStep` | Handoff to another agent (fire-and-forget) |
| `BundleAgent` | Agent definition with optional charter |
| `BundleSkill` | Skill/prompt addendum |
| `BundleTool` | Tool integration + schema |
| `BundleMcpServer` | MCP server connection config |
| `BundleRoutingRule` | Pattern-to-agent routing rule |
| `ApplyResult` | Loader result: applied / skipped / warnings / errors |

---

## Relationship to `@bradygaster/squad-sdk`

These are **two separate packages** for two separate concerns:

| Package | Purpose | Docs |
|---------|---------|------|
| `@bradygaster/squad-sdk` | Squad CLI ecosystem — configuration, routing, resolution | [bradygaster.github.io/squad](https://bradygaster.github.io/squad/docs/reference/sdk/) |
| `@sabbour/squadboard-sdk` | Squadboard-specific primitives — scribe close-out, health reports, bundle types | this repo |

**Rule of thumb:**
- Building Squad tooling or integrating with the Squad CLI? → use `@bradygaster/squad-sdk`
- Building Squadboard integrations, extending agent close-out, or reading/writing bundles? → use `@sabbour/squadboard-sdk`

---

## Development

```bash
pnpm build     # Compile TypeScript → dist/
pnpm test      # Run vitest tests
pnpm typecheck # Type-check without emitting
```
