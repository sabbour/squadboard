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

## What It Is

Squadboard is a workflow engine and kanban board for running multi-agent ceremonies on issues. It pairs with the upstream Squad agent for hands-off ops, providing durable orchestration, deterministic replay, and real-time visibility into parallel agent runs—all without leaving the browser.

It runs locally by default, syncs to GitHub when you ship, and stores everything in an embedded Postgres database (no external setup).

## Who It's For

Developers tired of pasting context between Copilot, GitHub Issues, and a kanban. Teams sharing a `.squad/` directory who need workflow gates (peer review, approvals) without inventing them in agent prompts. Agent builders shipping workflows as first-class versioned artifacts—auditable, demonstrable, composable. If you have one agent and one task at a time, `squad chat` is fine. The moment you have N agents, M tasks, K handoffs—use Squadboard.

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

### First Run: 60-Second Click-Through

1. **Create a project** — Click "New Project" on the dashboard. Squadboard scans `.squad/` for agents and ceremonies.
2. **Throw a card on the board** — Type a title (e.g., "Fix login timeout") and drag it into the `todo` column.
3. **Hit "Run Simple Review ceremony"** — Click the card, then "Run". The run drawer populates live with agent output. Watch the WS event feed.
4. **See results** — Agent finishes, ceremony awaits approval. Click approve → card moves to done, run closes.

That's the loop. Scale to N agents, M tasks, K handoffs—all with deterministic replay and crash recovery.

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

Connect a GitHub repository to sync issues and PRs. Two authentication methods are supported.

#### Option A — Personal Access Token (PAT)

1. In the Squadboard UI, go to **Project Settings** > **GitHub**
2. Paste a GitHub personal access token (with `repo` scope)
3. Enter the repo owner and name

Or via API:
```bash
curl -X PUT http://localhost:3000/api/projects/{projectId}/github \
  -H "Content-Type: application/json" \
  -d '{"authType":"pat","token":"ghp_xxxxx","owner":"your-org","repo":"your-repo"}'
```

> **Backward compatible:** requests without `authType` are treated as PAT.

#### Option B — GitHub App

GitHub Apps are recommended for fine-grained permissions and higher rate limits.

1. [Create a GitHub App](https://docs.github.com/en/apps/creating-github-apps) with **Issues: Read & Write** permissions.
2. Install the App on your repository and note the **App ID** and **Installation ID**.
3. Download the private key (`.pem`) from the App settings page.
4. Convert the key from PKCS#1 to PKCS#8 (required by the `jose` RS256 JWT library):
   ```bash
   openssl pkcs8 -topk8 -nocrypt -in github-app.pem -out github-app-pkcs8.pem
   ```
5. Configure via API:
   ```bash
   curl -X PUT http://localhost:3000/api/projects/{projectId}/github \
     -H "Content-Type: application/json" \
     -d '{
       "authType": "app",
       "appId": "123456",
       "installationId": "78901234",
       "privateKey": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----",
       "owner": "your-org",
       "repo": "your-repo"
     }'
   ```

> **Security note:** The private key is stored in plaintext during the hacking phase. Use a secrets manager (Vault, AWS Secrets Manager) in production.

#### GET response

`GET /api/projects/:id/github` returns:
- `authType`: `"pat"` or `"app"`
- PAT: `githubToken` (redacted — last 4 chars visible)
- App: `appId`, `installationId` — **`privateKey` is never returned**

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

### Dogfood Mode — Auto-capture Directives (Wave 10)

When running Squadboard under GitHub Copilot CLI with Squad as the coordinator,
every implementation directive is automatically captured into Squadboard's own
project inbox. This closes the dogfood loop: directives → decisions → board
cards → runs → completion tracking.

**Setup:**
1. Ensure your `.copilot/mcp-config.json` points to this repo's MCP server
2. Set `SQUADBOARD_DEFAULT_PROJECT_ID` to your project UUID (use `list_projects`
   to discover it)
3. Reference `.squad/dogfood.md` for the full coordinator playbook

See [Dogfood Playbook](.squad/dogfood.md) and [MCP tool reference](packages/server/src/mcp/README.md)
for details on the `capture` tool and when the coordinator calls it.

### Cost Tracking — GitHub Copilot Premium-Request Multipliers (Wave 10)

Squadboard tracks cost in two models:
- **Legacy (USD):** Token-based pricing (Anthropic / OpenAI public rates)
- **GitHub Copilot multipliers:** Premium-request equivalent (1 premium request ≈ 10,000 tokens)

Switch models via:
```bash
# Set globally
export SQUADBOARD_COST_MODEL=gh_multipliers

# Or per-project via the API (see next section)
curl -X PATCH http://localhost:3000/api/projects/{projectId} \
  -H "Content-Type: application/json" \
  -d '{"costModel": "gh_multipliers"}'
```

See `packages/server/src/sdk/cost-tracker.ts` for pricing details.

### Templates — Save & Reuse Workflows (Wave 10)

Save a project, team, or workflow as a reusable template:

```bash
curl -X POST http://localhost:3000/api/projects/{projectId}/save-as-template \
  -H "Content-Type: application/json" \
  -d '{"name": "my-template"}'
```

Templates are stored in `.squad/squadboard/templates/{kind}/{slug}.json` and
versioned alongside your code. Import a template by uploading its JSON via the UI
or the `/api/projects/{projectId}/import-template` endpoint.



### Database Studio (Development)

Inspect or edit the database schema:
```bash
pnpm --filter @squadboard/server db:studio
```

Opens Drizzle Studio on http://localhost:3001.

## Concepts at a Glance

- **[Ceremonies](docs/concepts/ceremonies.md)** — Named triggered processes (e.g., "Review on demand", "Auto-fix on bug label"). You author them; the engine runs them.
- **[Workflows](docs/concepts/ceremonies.md#workflow-step-catalogue)** — Ordered steps inside ceremonies (agent_run, peer_review, approve, fan_out, route, retry, branch, wait_event, wait_timer, github_pr, etc.).
- **[Projects](docs/prd.md#projects)** — Isolated workspaces. Each project owns a kanban board, team of agents, ceremony templates, and GitHub sync settings.
- **[Agents & Skills](docs/prd.md#agents)** — Defined in `.squad/agents/` (as agent.md charter files). Skills are reusable capabilities agents can run.
- **[Bundles](docs/features.md#project-bundles)** — Ship a complete project (board + ceremonies + team + tools + MCP) as a single artifact. 6 built-in templates.
- **[MCP Integration](docs/setup/mcp-install.md)** — 10 tools (list_issues, create_issue, run_agent, capture, etc.) via stdio (Copilot CLI, VS Code) or HTTP.
- **[Squad Integration](docs/prd.md#squad-integration)** — Pair with the upstream [Squad agent](https://github.com/bradygaster/squad) for hands-off multi-agent orchestration. Directives auto-capture to Squadboard inbox.

---

## Features

See **[Complete Feature List](docs/features.md)** for details on all subsystems.

### Workflow Engine
- Durable runs with crash recovery (lease + heartbeat liveness)
- Single-spawner discipline (no race conditions)
- Retry policy, fan-out, branch, wait primitives
- Peer review & human approval gates (N-of-M quorum)
- Five engine invariants ensure determinism and auditability

### Project Bundles
- Universal YAML + JSON schema, versioned
- 6 built-in reference templates
- Bundle CLI (import/export)
- Atomic load (one command)

### Ceremonies
- 5 curated built-ins: Simple Review, Bug Fix, RFC, Spike, Pair-Programming
- Custom YAML (manual, scheduled, or GitHub event triggers)
- Workflow versioning (lock and swap workflows)

### GitHub Integration (W16+)
- Branch convention, PR template, push branch, create PR, card badges
- Phase 2 (W17): comment, merge, Settings panel (in progress)

### Reliability
- Periodic backup + restore CLI/UI
- 6-invariant safety checks
- PGlite (no native binaries)

### Real-time UI
- Live run drawer (WebSocket push from engine)
- Activity feed, optimistic UI
- Reconnect cursor (resume after network drop)

### SDK + MCP
- `@sabbour/squadboard-sdk` (SquadClient, CharterCompiler, CostTracker, EventBus)
- 10 MCP tools (stdio for Copilot CLI / VS Code; HTTP for embedding)
- Daemon mode for coordinator

### Conjure (Quick-Capture)
- Freeform prompt router with intent classifier
- Auto-capture from Copilot CLI directives
- Done-prefix to close cards

---

## Squad Integration

Squadboard integrates with the upstream **[Squad agent](https://github.com/bradygaster/squad)** for hands-off multi-agent orchestration.

When running Squad under Copilot CLI with Squadboard's coordinator extension enabled:
- Every implementation directive auto-captures to Squadboard's inbox
- Agent hand-offs resolve to board cards
- Ceremony runs are visible in real-time
- Close-out triggers automatic card completion

Setup: Enable the Squadboard coordinator fragment in `~/.squad/extensions/coordinator/squadboard.md` (auto-installed on `npm install`), and set `SQUADBOARD_DEFAULT_PROJECT_ID` env var.

See [Coordinator Extension Guide](docs/plugins/squad-coordinator-extensions.md) and [Dogfood Playbook](.squad/dogfood.md) for details.

---

## Links

- **[Product Requirements Document](docs/prd.md)** — Full vision, roadmap, 15-demo plan, success criteria, engine invariants
- **[Concepts: Ceremonies & Workflows](docs/concepts/ceremonies.md)** — Ceremony types, workflow steps, custom YAML, trigger configuration
- **[Feature List](docs/features.md)** — Complete breakdown of workflow engine, bundles, ceremonies, GitHub integration, SDK+MCP, and roadmap
- **[MCP Install & Configuration](docs/setup/mcp-install.md)** — Setup for Copilot CLI, VS Code, and embedded HTTP
- **[Dogfood Playbook](.squad/dogfood.md)** — Using Squadboard to run Squadboard (auto-capture + close-out loop)
- **[GitHub Repository](https://github.com/your/squadboard)** — Source code
- **[MIT License](LICENSE)**

---

## Status

**Hacking phase, pre-1.0.** We're building from the PRD down to 15 demoable vertical slices. Expect breaking changes. No cloud yet — self-hosted on your machine or your infrastructure.

This is **local git only** during hacking phase. PR workflow resumes on launch.

## License

MIT

---

<img src="assets/squadboard.svg" alt="" width="56" align="left" hspace="12" />

Built by McManus, Hockney, Kobayashi, Keyser, Verbal, Fenster, Kujan, and Redfoot.

