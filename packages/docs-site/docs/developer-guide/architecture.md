---
title: Architecture
description: The main services, data flow, user sequences, and invariants behind Squadboard.
---

# Architecture

Squadboard is a local-first control plane for multi-agent work. It complements upstream [Squad](https://github.com/bradygaster/squad): Squad remains the Copilot CLI driver and `.squad/` convention source, while Squadboard persists board state, decisions, runs, ceremonies, imports, and audit records.

## Topology

```mermaid
flowchart LR
  User[User / PM / Engineer] --> UI[React + Vite UI]
  Copilot[Copilot CLI + Squad] --> MCP[Squadboard MCP server]
  UI --> API[Express API + WebSocket]
  MCP --> API
  API --> DB[(Embedded Postgres-compatible store)]
  API --> FS[Project .squad/ directory]
  API --> SDK[Squad SDK bridge]
  API --> GitHub[GitHub API]
  SDK --> Agents[Project agents]
```

## Compared with upstream Squad architecture

Upstream Squad is chat-first: the coordinator reads a request, spawns agents, agents read `.squad/` memory, Scribe merges decisions, and Ralph watches work. Squadboard keeps those concepts but moves the durable control plane into the server and UI.

| Upstream Squad component | Squadboard counterpart |
| --- | --- |
| Coordinator routing engine | Deterministic prefilters plus bounded LLM coordinator decisions |
| Agents with charters and memory | Project agents imported from or mirrored to `.squad/`, spawned through the server bridge |
| `.squad/` memory | Shared repository files plus PostgreSQL-backed board/run/audit state |
| Scribe | Shared close-out service and directive capture into `.squad/decisions/inbox/` |
| Ralph | Opt-in Ready-column monitor plus GitHub follow-up signals when sync is configured |
| GitHub issue board | Local semantic board first; GitHub sync is optional |

The key difference is timing. Squadboard supports the multi-agent inner loop before GitHub: capture, shape, route, run, review, and approve can all happen locally before a PR or GitHub issue exists.

## Inner-loop sequence

```mermaid
sequenceDiagram
  autonumber
  actor User
  participant UI as Squadboard UI / MCP
  participant Board as Local board
  participant Coord as Coordinator gates
  participant SDK as SquadClient bridge
  participant Agent as Agent session
  participant Review as Review / ceremony
  participant GitHub as Optional GitHub sync

  User->>UI: Capture ambiguous work
  UI->>Board: Create or shape card
  User->>Board: Move card to Ready
  Board->>Coord: Evaluate ready pickup
  Coord->>SDK: Start eligible agent run
  SDK->>Agent: Spawn with charter, memory, skills, tools, MCP context
  Agent-->>Board: Stream output and artifacts
  Board->>Review: Approve, request changes, or close out
  Review-->>GitHub: Open/sync when shipping policy says so
```

## Coordinator sequence

```mermaid
sequenceDiagram
  actor User
  participant Board as Squadboard UI or MCP
  participant API as Server API
  participant Coord as Coordinator
  participant LLM as Bounded LLM
  participant Agent as Project Agent

  User->>Board: Create card or capture directive
  Board->>API: Persist issue / inbox item
  API->>Coord: Build coordinator input
  Coord->>Coord: Apply deterministic prefilters
  alt Concrete routing case
    Coord-->>API: Dispatch or skip decision
  else Ambiguous role fit
    Coord->>LLM: Ask for schema-bound decision
    LLM-->>Coord: Validated decision
  end
  API->>Agent: Spawn with charter, workspace, skills, MCP context
  Agent-->>API: Run events and result
  API-->>Board: Live status and close-out metadata
```

## Import sequence

```mermaid
sequenceDiagram
  actor User
  participant UI as Templates / Import UI
  participant API as Template routes
  participant Loader as Bundle loader
  participant FS as .squad/ project files
  participant DB as Database

  User->>UI: Apply built-in bundle or upload template JSON
  UI->>API: POST apply/import
  API->>Loader: Validate schema and normalize artifacts
  Loader->>FS: Write agents, ceremonies, skills, MCP config
  Loader->>DB: Create project, board, issues, templates
  API-->>UI: Return project/import result
```

## Engine invariants

1. `agent_run` is the LLM execution boundary.
2. The stepper is the sole spawner.
3. Lease and heartbeat are authoritative liveness.
4. Output validation happens after session completion and before recording.
5. Fan-out materializes child workflow state atomically.

## Important services

| Service | Purpose |
| --- | --- |
| `coordinator/input-builder.ts` | Build normalized routing input |
| `coordinator/prefilters.ts` | Deterministic routing gates |
| `services/coordinator-routing-log.ts` | Persist non-dispatch decisions |
| `sdk/spawn-prompt.ts` | Build Copilot CLI + Squad coexistence prompt context |
| `services/directive-capture.ts` | Write decision inbox capture |
| `services/scribe-closeout.ts` | Run close-out and expose metadata |
| `services/ralph-monitor.ts` | Opt-in autonomous work monitor |
| `services/bundle-loader.ts` | Apply bundles, templates, and Squad App-derived project artifacts |
| `services/worktree-lifecycle.ts` | Track and clean safe worktrees |

## Audit invariant

Every automated coordinator action should produce an audit event or decision record with source, source detail, input hash or idempotency key, result, and reason.
