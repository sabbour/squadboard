<p align="center">
  <img src="assets/squadboard-horizontal.svg" alt="Squadboard" width="100%" />
</p>

<h1 align="center">Orchestrate AI agents with a local-first workflow board.</h1>

<p align="center">
  <a href="LICENSE">
    <img alt="License" src="https://img.shields.io/badge/license-MIT-blue.svg" />
  </a>
  <a href="#">
    <img alt="Node.js Version" src="https://img.shields.io/badge/node-%3E%3D18-green.svg" />
  </a>
  <a href="#">
    <img alt="Self-Hosted" src="https://img.shields.io/badge/deployment-self--hosted-orange.svg" />
  </a>
</p>

---

## What is Squadboard?

Running multiple Squad agents today means tracking work in terminal logs, Notion, or GitHub Issues and keeping them manually in sync. Handoffs are text-matched and sometimes miss. Parallel fan-outs silently drop children. Engine crashes lose in-flight state.

Squadboard gives you a kanban board for visibility, a deterministic workflow engine for reliable orchestration, and a live ops view for real-time awareness — all local-first by default, with GitHub at the seams when you ship.

## Quick start

```bash
npx @sabbour/squadboard init
npx @sabbour/squadboard up
```

Open http://localhost:3000, create your first project, discover your Squad agents, and run your first workflow.

## What you get

- **Kanban board** — drag-drop cards, comment, filter, bulk-edit, no tab-switching
- **Deterministic workflows** — YAML-defined steps, versioned, atomic, recoverable from crashes
- **Agent management** — discover and hire agents from `.squad/`, enable/disable, edit inline
- **Isolated workspaces** — each run owns its own directory; parallel agents never collide
- **Peer review + approvals** — N-of-M quorum, 4-verb cycle, threaded audit trail
- **Fan-out and subtrees** — split tasks atomically; pause/resume whole branches
- **Live ops view** — real-time active runs, cost per run, activity feed via WebSocket
- **Dashboards** — agent leaderboard, cost burn, workflow funnel, burndown — all from your data

## Who it's for

Solo developers running one agent and needing a better run history. Small teams sharing `.squad/` workflows and needing gates (peer review, approvals) without reinventing them in prompts. Agent builders who want workflows as first-class versioned artifacts — auditable, demonstrable, composable.

If you have one agent and one task at a time, `squad chat` is the right tool. The moment you have N agents, M tasks, K handoffs — that's Squadboard.

## Architecture

Single Node.js process running Express v5. The browser (React 19 SPA) talks HTTP + WebSocket to the engine. The engine owns Postgres (embedded locally, hosted in cloud). Agent runs execute as `runWorker` subprocesses — each owns its workspace, writes heartbeats directly to the DB, and emits final output via MCP. The dispatcher ticks every ~5s; the stepper claims work via `FOR UPDATE SKIP LOCKED` and is the sole spawner.

**Five non-negotiable engine invariants** ensure durability, determinism, and crash-recovery:

1. `agent_run` is the only step that does LLM work. Peer review, tier-3 routing, and split desugar to `issue_runs` rows with distinct `kind` values.
2. Single-spawner discipline. The stepper alone spawns runs; the dispatcher only ticks, sweeps, and wakes.
3. Lease (90s TTL) + heartbeat (30s) is the authoritative liveness signal.
4. Output schema validation happens at session end — after `sendAndWait` returns, before `recordRunCompletion`.
5. `fan_out` and `split` materialize full child `workflow_runs` rows in one atomic six-step transaction.

[Full topology and implementation details →](docs/prd.md#7-architecture-at-a-glance)

## Tech stack

- **Runtime:** Node.js + Express v5
- **Database:** Postgres (embedded locally, hosted in cloud) + Drizzle ORM
- **Frontend:** React 19 + Vite (SPA)
- **Real-time:** WebSocket with project-scoped reconnect cursor
- **Agent runtime:** Squad SDK (`SquadClient`, `CharterCompiler`, `HookPipeline`, `CostTracker`, `EventBus`)
- **VCS seam:** GitHub API (contents, PRs, checks, issues, webhooks)
- **License:** MIT

## Documentation

- **[Product Requirements Document](docs/prd.md)** — what Squadboard is, who it's for, the 15-demo roadmap, success criteria, and the five engine invariants
- **[Docs + Guides](docs/README.md)** — getting started, workflow syntax, architecture deep-dive, troubleshooting

For implementation details (schema, dispatcher/stepper internals, GitHub adapter, reliability discipline, user journeys), see the deep design document linked from the PRD.

## Status

**Hacking phase, pre-1.0.** We're building from the PRD down to 15 demoable vertical slices. Expect breaking changes. No cloud yet — self-hosted on your machine or your infrastructure.

This is **local git only** during hacking phase. PR workflow resumes on launch.

## License

MIT

---

<img src="assets/squadboard.svg" alt="" width="56" align="left" hspace="12" />

Built by McManus, Hockney, Kobayashi, Keyser, Verbal, Fenster, Kujan, and Redfoot.
