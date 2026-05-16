# Ceremony Triggers

A trigger defines **when** a ceremony runs. Squadboard supports four trigger types, each with distinct configuration and dispatch mechanisms.

## Overview

| Trigger Type | When It Fires | Configuration | Example |
|--------------|---------------|---------------|---------|
| `github-event` | GitHub event matches (webhook) | event type, optional filters | PR opened matching a label |
| `manual` | User clicks "Run" button | none | on-demand team review |
| `cron` | Schedule fires (heartbeat sweep) | cron expression | 9 AM every Monday |
| `agent-signal` | Agent emits a lifecycle event | event type (limited today) | another agent finishes |

## github-event

Fires when a GitHub webhook event matches the configured event type and filters.

### Events Supported

- `pull_request` — PR opened, closed, reopened, edited, synchronize (commit push), labeled, unlabeled
- `push` — code pushed to a branch
- `issues` — issue opened, closed, edited, labeled, unlabeled
- `issue_comment` — comment added to an issue or PR

### Filters Available

- **labels** — list of label name patterns (glob or substring); PR/issue must have at least one matching label
- **paths** — list of file path patterns (glob); PR changes must touch at least one matching path

**Coming in W29+:** CER-5 will expand filters to include:
- `review_state` — wait for PR review status (changes requested, approved, dismissed)
- `branch` — branch name patterns
- `author` — author username patterns

### YAML Schema

```yaml
spec:
  trigger:
    type: github-event
    event: pull_request           # required
    filters:                       # optional
      labels:
        - design/*
        - review-needed
      paths:
        - docs/design.md
        - packages/ui/**/*.tsx
```

### Dispatch Mechanism

1. GitHub webhook POSTs an event to Squadboard (configured in the project's GitHub App settings).
2. `ceremony-dispatcher.ts` routes the event to all ceremonies with `trigger.type = github-event`.
3. For each matching ceremony, the dispatcher checks:
   - Does `event` match? (e.g., is it a `pull_request` event?)
   - Do `filters.labels` match? (if present, does PR have a matching label?)
   - Do `filters.paths` match? (if present, does PR touch a matching file?)
4. If all conditions pass, spawn a `workflowRun`.

### Idempotency

GitHub deliveries are deduplicated via the `ceremony_github_fires` table:

```sql
CREATE TABLE ceremony_github_fires (
  ceremony_slug TEXT,
  github_delivery_id TEXT,
  PRIMARY KEY (ceremony_slug, github_delivery_id)
);
```

This ensures that if GitHub retries a delivery, the ceremony runs only once.

### Example: Design Review on PR

```yaml
apiVersion: squad.io/v1
kind: Ceremony
metadata:
  name: design-review
  displayName: Design Review Gate
  description: Auto-triggers when a PR modifies design.md
spec:
  trigger:
    type: github-event
    event: pull_request
    filters:
      paths:
        - docs/design.md
  steps:
    - id: review
      kind: agent_run
      agent: designer
      prompt: "Review the design changes for consistency, accessibility, and brand alignment."
    - id: approve
      kind: peer_review
      reviewers: 1
      timeout: 3600
```

## manual

Fires when a user clicks the **Run** button in the UI, or calls the REST API endpoint.

### Configuration

Manual triggers have no configuration:

```yaml
spec:
  trigger:
    type: manual
```

### Invocation

- **UI:** Click **Run** button on the ceremony card.
- **API:** `POST /api/projects/{projectId}/ceremonies/{ceremonyId}/run` (optional body: `{ context: {...} }`)

### No Dispatch Conditions

Manual triggers always fire immediately when invoked. There is no filtering or deduplication.

### Example: On-Demand Review

```yaml
apiVersion: squad.io/v1
kind: Ceremony
metadata:
  name: on-demand-review
  displayName: Request Review
  description: Manual trigger for ad-hoc expert review
spec:
  trigger:
    type: manual
  steps:
    - id: gather-context
      kind: agent_run
      agent: analyzer
      prompt: "Summarize the issue and list open questions."
    - id: wait-expert
      kind: peer_review
      reviewers: 1
      timeout: 7200
```

## cron

Fires on a schedule via heartbeat sweep. The ceremony engine checks every 5–10 seconds if any ceremony's next fire time has arrived.

### Schedule Format

Cron expressions follow **5-field standard** (not 6-field):

```
minute hour day-of-month month day-of-week
   0     9        *         *       1           ← 9 AM every Monday
```

Common examples:
- `0 9 * * 1` — 9 AM every Monday
- `0 0 1 * *` — midnight on the 1st of every month
- `*/5 * * * *` — every 5 minutes
- `0 8-17 * * MON-FRI` — every hour 8 AM–5 PM, weekdays only

### Timezone

Cron schedules are interpreted in **UTC by default**. To specify a timezone, use:

```yaml
spec:
  trigger:
    type: cron
    schedule: "0 9 * * 1"
    timezone: "America/Los_Angeles"   # optional; defaults to UTC
```

### YAML Schema

```yaml
spec:
  trigger:
    type: cron
    schedule: "0 9 * * 1"
    timezone: America/Los_Angeles
```

### Dispatch Mechanism

1. `ceremony-scheduler.ts` runs a periodic heartbeat (every 5–10 seconds).
2. For each ceremony with `trigger.type = cron`, the scheduler:
   - Reads `ceremonySchedules` row (cron expression, last fire time, next fire time)
   - Computes next fire time using `cron-parser` library
   - If `now() >= nextFireAt`, spawn a `workflowRun`
   - Update `nextFireAt` for the next occurrence
3. Use `ceremony-scheduler.previewNextFireTimes()` to preview upcoming fire times.

### Example: Weekly Retrospective

```yaml
apiVersion: squad.io/v1
kind: Ceremony
metadata:
  name: weekly-retro
  displayName: Weekly Retrospective
  description: Runs every Monday at 5 PM PT
spec:
  trigger:
    type: cron
    schedule: "0 17 * * MON"
    timezone: America/Los_Angeles
  steps:
    - id: async-input
      kind: wait_timer
      duration: 300
    - id: compile-notes
      kind: agent_run
      agent: scribe
      prompt: "Compile async feedback into a retro summary."
```

## agent-signal

Fires when another agent emits a signal on a lifecycle event. Support is currently limited; CER-6 expands this in W29.

### Event Types

**Today:**
- `workflow_run_completed` — fires when another ceremony's run finishes
- (Other event types reserved for future expansion)

**Coming in W29+ (CER-6):**
- `agent_available` — when an agent becomes available (e.g., after being busy)
- `agent_error` — when an agent fails (configurable retry/escalation)
- `threshold_crossed` — custom metrics exceed a threshold
- And others

### YAML Schema

```yaml
spec:
  trigger:
    type: agent-signal
    # No fields today; reserved for event type, filters in CER-6
```

### Dispatch Mechanism

1. An agent or ceremony step emits a signal (e.g., via `emit_signal` step or MCP tool).
2. `ceremony-dispatcher.ts` listens to the signal bus.
3. For each ceremony with `trigger.type = agent-signal`, check if the signal matches (filter by event type).
4. If match, spawn a `workflowRun`.

### Example: Escalation on Timeout

```yaml
apiVersion: squad.io/v1
kind: Ceremony
metadata:
  name: escalate-on-timeout
  displayName: Escalation Handler
  description: Runs when an agent takes too long on a task
spec:
  trigger:
    type: agent-signal
    # Filter config coming in W29+ (CER-6)
  steps:
    - id: notify-lead
      kind: agent_run
      agent: notifier
      prompt: "Alert the tech lead that the previous step exceeded timeout."
```

## agent-signal — Standardized signal names

**Added in W29 CER-6.** The following signal names are the official taxonomy for lifecycle signals emitted by squadboard components. Ceremonies subscribe to a signal by setting `trigger.signalName` in their YAML.

| Signal name | When it fires | Typical emitter |
|-------------|---------------|-----------------|
| `before-batch` | Before a batch of `issue_run`s is spawned (e.g. pickup-todos sweep) | batch coordinator, pickup-todos caller |
| `after-batch` | After the batch of `issue_run`s has started | batch coordinator, pickup-todos caller |
| `before-run` | Before a single `issue_run` starts | run dispatcher |
| `after-run` | After a single `issue_run` completes (any terminal status) | run dispatcher |
| `on-issue-entry` | When an issue enters a new column | column-transition handler |

**Design rules:**
- **Caller is responsible for emitting** — call `emitSignal()` from `ceremony-signal-emitter.ts` at the right moment.
- **Emission is fire-and-forget** — `emitSignal` returns an `EmitResult` but callers may ignore it.
- **Custom signal names** — any `string` is accepted; the table above is advisory, not exhaustive.
- **Ordering** — `before-*` signals are typically awaited before the triggering action; `after-*` signals are emitted after and may be fire-and-forget depending on caller preference.

### YAML schema (CER-6)

```yaml
spec:
  trigger:
    type: agent-signal
    signalName: before-batch     # required for CER-6 emitter matching
```

### Emitter API

```typescript
import { emitSignal } from 'packages/server/src/services/ceremony-signal-emitter.js';

// Before spawning a batch:
const result = await emitSignal({
  projectId,
  signalName: 'before-batch',
  contextPayload: { batchSize: issueIds.length },
  anchorIssueId: issueIds[0],   // optional; resolved automatically if omitted
});
// result: { fired: N, skipped: M, errors: K, workflowRunIds: [...] }
```

## Trigger Composition and Limits

Each ceremony has **exactly one trigger**. You cannot combine triggers (e.g., "run on manual OR when label is added") — use separate ceremonies for distinct triggers, or use a single `github-event` trigger with multiple labels in `filters.labels`.

### Best Practices

- **Use specific filters:** Avoid broad GitHub event listeners that fire on every PR. Use `filters.labels` or `filters.paths` to narrow scope.
- **Set realistic schedules:** Cron ceremonies run at fixed times; consider team timezone and meeting cadence.
- **Document why:** Add a description explaining the trigger's purpose (e.g., "Runs on PRs modifying design.md to ensure design reviews").
- **Avoid tight loops:** Cron schedules with very short intervals (e.g., `*/1 * * * *`) may overload the scheduler. Use `*/5` (5 minutes) as a minimum.

---

**Further reading:**
- [Lifecycle.md](./lifecycle.md#execution) for how triggers are dispatched and runs are spawned
- [YAML Reference](./yaml-reference.md) for the complete schema of trigger fields
