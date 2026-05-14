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

## Getting Started

### Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** ≥ 20.0.0 ([download](https://nodejs.org))
- **pnpm** ≥ 8.0.0
  ```bash
  npm install -g pnpm
  ```

No external Postgres needed — Squadboard runs an embedded Postgres instance locally at `~/.squadboard/data` on macOS, Windows, and Linux (including linux/arm64). The embedded binary ships with all required shared libraries.

> **Optional override:** Set `DATABASE_URL=postgresql://user:pass@host:port/squadboard` to use an external Postgres instance instead of the embedded one (useful for CI or production deployments).

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/you/foo
   cd foo
   ```

2. Install dependencies:
   ```bash
   pnpm install
   ```

### Initialize & Run

**Option A: Start the full app (backend + frontend)**

```bash
pnpm run dev
```

This starts:
- Backend (Express + WebSocket) on http://localhost:3000
- Frontend (React + Vite) on http://localhost:5173
- Embedded Postgres on localhost:54321 (auto-managed, no setup needed)

Open http://localhost:5173 in your browser.

**Option B: Start components separately**

Backend:
```bash
pnpm --filter @squadboard/server dev
```

Frontend (in another terminal):
```bash
pnpm --filter @squadboard/client dev
```

### First Run: Initialize Squadboard

The first time you start, Squadboard:
- Creates `~/.squadboard/data` directory
- Spins up embedded Postgres
- Seeds the schema (projects, runs, workflows, agents)

No additional init command needed — the server does this automatically on startup.

### CLI Reference

Use the Squadboard CLI to launch the server or integrate with AI agents:

```bash
# Start the server and open the UI (equivalent to `pnpm run dev`)
squadboard init

# Start the MCP server (stdio transport for VS Code and GitHub Copilot CLI)
squadboard mcp
```

Or use `npx` directly:
```bash
npx @sabbour/squadboard init
npx @sabbour/squadboard mcp
```

### MCP Integration

Squadboard exposes tools via Model Context Protocol (MCP) over stdio. Connect from either VS Code (with MCP extension) or GitHub Copilot CLI.

#### Visual Studio Code

1. Install the [MCP extension](https://marketplace.visualstudio.com/items?itemName=cline.cline) for VS Code.

2. Add Squadboard to `.vscode/mcp.json` (project-level, commit to repo):
   ```json
   {
     "servers": {
       "squadboard": {
         "type": "stdio",
         "command": "node",
         "args": ["packages/cli/dist/index.js", "mcp"]
       }
     }
   }
   ```
   > Adjust the path to `packages/cli/dist/index.js` relative to your workspace root.

3. Reload VS Code. Squadboard tools are now available in the assistant.

#### GitHub Copilot CLI

1. Add Squadboard to `~/.copilot/mcp-config.json`:
   ```json
   {
     "mcpServers": {
       "squadboard": {
         "command": "node",
         "args": ["path/to/packages/cli/dist/index.js", "mcp"]
       }
     }
   }
   ```
   > Replace `path/to/packages/cli/dist/index.js` with the absolute path to your Squadboard repository.

2. Restart the GitHub Copilot CLI. Squadboard tools are now available to agents.

### GitHub Sync (Optional)

Connect a GitHub repository to sync issues and PRs:

1. In the Squadboard UI, go to **Project Settings** > **GitHub**
2. Paste a GitHub personal access token (with `repo` scope)
3. Enter the repo owner and name

Or via API:
```bash
curl -X PUT http://localhost:3000/api/projects/{projectId}/github \
  -H "Content-Type: application/json" \
  -d '{"token":"ghp_xxxxx", "owner":"your-org", "repo":"your-repo"}'
```

### Build for Production

```bash
pnpm build
```

This compiles TypeScript and builds the React frontend. Output:
- Backend: `packages/server/dist/index.js`
- Frontend: `packages/client/dist/`

Start the production build:
```bash
pnpm start
```

### Database Studio (Development)

Inspect or edit the database schema:
```bash
pnpm --filter @squadboard/server db:studio
```

Opens Drizzle Studio on http://localhost:3001.

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
