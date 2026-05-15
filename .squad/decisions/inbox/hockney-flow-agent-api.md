# Flow Agent API — Decision Record
**Author:** Hockney  
**Date:** 2026-05-15  
**Status:** Shipped (Batch A + B committed)

---

## Endpoint Contracts (verbatim — Keyser builds against these)

### `GET /api/projects/:id/flow/agents`
Returns the agent-instance graph for visualisation.

```
Response: { ok: true, data: FlowAgentsResponse }

FlowAgentsResponse {
  agents: Array<{
    agentId: string          // agents.id (UUID)
    name: string
    role: string
    instances: Array<{
      instanceId: string     // workflow_run.id | issue_run.id | live_session.id | consult_session.id
      instanceKind: 'workflow_run' | 'issue_run' | 'live_session' | 'consult_session'
      status: 'active' | 'idle' | 'completed' | 'failed' | 'pending'
      currentStep?: { stepId: string; label: string; startedAt: string }
      currentIssue?: { issueId: string; title: string }
      startedAt: string      // ISO 8601
      lastHeartbeatAt?: string
      endedAt?: string
      model?: string
    }>
  }>
}
```

Every non-retired agent appears in the response regardless of whether it has
active instances. `instances: []` means idle/undeployed — client should
visually de-emphasise those cards.

### `GET /api/projects/:id/flow/lineage`
Returns the directed-edge set for the lineage graph.

```
Response: { ok: true, data: FlowLineageResponse }

FlowLineageResponse {
  edges: Array<{
    fromInstanceId: string
    toInstanceId: string
    relation: 'fan_out' | 'split' | 'consult' | 'handoff' | 'spawn'
    createdAt: string
    triggerStepId?: string   // set when sourced from handoff_context
  }>
}
```

### `GET /api/projects/:id/flow/graph`
Combined — use this as the primary client endpoint (single round-trip).

```
Response: { ok: true, data: { agents: FlowAgent[], edges: FlowLineageEdge[] } }
```

Internally calls `getFlowAgents()` + `getFlowLineage()` concurrently via
`Promise.all`. If you need refresh on a heartbeat, poll this one.

---

## Instance Attribution Logic

| Source table | Attributed to agent via |
|---|---|
| `workflow_runs` | Current step's `issue_runs.agent_id` if a step is running; fallback to `issues.assignee_id`; excluded if neither resolves |
| `issue_runs` | `issue_runs.agent_id` — but only **standalone** runs (not linked to a `step_run`) |
| `live_sessions` | `live_sessions.agent_id` (only rows where `agent_id IS NOT NULL`) |
| `consult_sessions` | `consult_sessions.agent_id` (mode='agent' only) |

**Why issue_runs linked to step_runs are excluded from the issue_run bucket:**
An issue_run that IS a workflow step is already represented as the `currentStep`
of its parent `workflow_run` instance. Showing it twice would duplicate the card.

---

## Data Gaps

1. **`workflow_runs` with no step agent and no issue assignee** — excluded
   silently. This can happen if a workflow_run was created before an agent was
   assigned. It will appear once the routing step resolves. Document as known
   gap in the UI with "Unassigned" placeholder.

2. **`consult_sessions` (mode='model')** — excluded. These sessions have no
   `agentId` (they talk directly to a model). They cannot appear on an
   agent-centric flow page. If the team later wants to show them, they need a
   "model instance" entity type.

3. **`issue_run → issue_run` lineage** — no schema support. A direct handoff
   between two standalone issue_runs (without a workflow_run) has no FK chain.
   Current edges only cover: issue_links (fan_out/handoff), workflow_run
   parent_workflow_run_id, and consult_session forked_from_session_id.

4. **`workflow_run → consult_session` cross-source edges** — no FK. A consult
   session doesn't store which workflow_run spawned it (if any). Would require
   a new `triggered_by_run_id` column on `consult_sessions`. Documented as
   Phase 13 gap.

5. **`parentInstanceId` in `flow.instance.started` for issue_runs** — not
   emitted. The issue_run ↔ step_run relationship is inverse (step_run stores
   issueRunId), so looking it up at emit time adds a query inside the hot
   heartbeat path. Defer until Fenster needs the visual connection.

---

## WebSocket Events

All four events are routed through the existing project event bus
(`emitFlowEvent` / `emitFlowHeartbeat`). Clients subscribe to the project
room the same way they subscribe to `run.*` events.

| Event | Payload | Throttle |
|---|---|---|
| `flow.instance.started` | `{ instanceId, agentId, kind }` | none |
| `flow.instance.heartbeat` | `{ instanceId, status }` | 1/s per instanceId (in-memory Map in EventBus) |
| `flow.instance.ended` | `{ instanceId, status }` | none |
| `flow.lineage.edge.created` | `{ fromInstanceId, toInstanceId, relation, createdAt }` | none |

Emit hooks live in:
- `engine/workflow-runner.ts` — workflow_run lifecycle
- `engine/stepper.ts` — issue_run lifecycle + 30 s heartbeat
- `engine/fan-out.ts` — lineage edge on fan_out completion
- `sdk/consult-stream.ts` — consult_session lifecycle

---

## Performance Posture

- **Active instances**: always included (no cap).
- **Completed/failed instances**: trailing 24 h window, 50 rows per source
  type (7 sources → theoretical max ~350 rows per response before grouping).
- **No pagination** for v1 — the cap keeps payloads reasonable for projects
  with <200 issues/runs.
- If a project grows past ~500 active runs, add `LIMIT` to the active CTEs
  and expose a `?since=<ISO>` cursor. Flag this to Keyser before Phase 14.

---

## Commit SHAs

- **Batch A** (endpoints + service): `ce01a382`
- **Batch B** (WS events): `9a9fb8a3`
