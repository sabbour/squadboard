<p align="center">
  <img src="assets/squadboard-horizontal.svg" alt="Squadboard" width="100%" />
</p>

<h1 align="center">Orchestrate AI agents with a local-first workflow board.</h1>

<p align="center">
  <a href="LICENSE">
    <img alt="License" src="https://img.shields.io/badge/license-MIT-blue.svg" />
  </a>
  <a href="#">
    <img alt="Node.js Version" src="https://img.shields.io/badge/node-%3E%3D20-green.svg" />
  </a>
  <a href="#">
    <img alt="Self-Hosted" src="https://img.shields.io/badge/deployment-self--hosted-orange.svg" />
  </a>
  <a href="#">
    <img alt="Project Status" src="https://img.shields.io/badge/status-pre--alpha-purple.svg" />
  </a>
</p>

---

## What It Is

Squadboard is a workflow engine and kanban board for running multi-agent ceremonies on issues. It can act as the durable driver for Copilot CLI + Squad-style work: deterministic routing and lifecycle state stay in the server, while LLMs handle ambiguity inside bounded prompts.

It runs locally by default, syncs to GitHub when you ship, and stores everything in a PGlite-backed Postgres-compatible database (no external setup).

> **Pre-alpha software warning:** Squadboard is pre-alpha, under active development, and not recommended for production or unattended operation. Expect breaking changes, incomplete flows, and sharp edges. Keep human review in the loop for code changes, GitHub writes, and any workflow that affects shared repositories.

## Who It's For

Developers tired of pasting context between Copilot, GitHub Issues, and a kanban. Teams sharing a `.squad/` directory who need workflow gates (peer review, approvals) without inventing them in agent prompts. Agent builders shipping workflows as first-class versioned artifacts—auditable, demonstrable, composable. If you have one agent and one task at a time, `squad chat` is fine. The moment you have N agents, M tasks, K handoffs—use Squadboard.

## Relationship to Squad

Squadboard is designed to work with the upstream **[Squad agent](https://github.com/bradygaster/squad)**. Squad provides the Copilot CLI driver and agent conventions; Squadboard provides the durable board, deterministic orchestration, audit trail, templates, and UI around that workflow.

The intended split is:

- **Squad (`bradygaster/squad`)** remains the interactive agent/driver experience and source of the `.squad/` team conventions.
- **Squadboard (`sabbour/squadboard`)** mirrors those outcomes in a local-first control plane: board cards, coordinator decisions, runs, ceremonies, Scribe close-out, GitHub sync, and MCP tools.
- **MCP integration** lets Copilot CLI and compatible clients send directives into Squadboard so ambiguous instructions can become durable cards, decisions, and auditable runs.

## Typical Workflows

Pick your starting point:

- **🚀 [Getting Started](packages/docs-site/docs/getting-started/)** — Clone, install, and run Squadboard locally in 5 minutes.
- **📦 [Create a Squad App](packages/docs-site/docs/user-guide/squad-apps.mdx)** — Build, test, and publish a reusable workflow template.
- **📤 [Publishing & Release Checklist](docs/RELEASE-READINESS.md)** — Pre-flight validation before shipping to npm or GitHub.

For more details, see the **[full documentation](packages/docs-site/docs/)**.

---

## Getting Started

### Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** ≥ 20.0.0 ([download](https://nodejs.org))
- **pnpm** ≥ 8.0.0
  ```bash
  npm install -g pnpm
  ```

No external Postgres needed — Squadboard uses packaged PGlite locally on macOS, Windows, and Linux (including linux/arm64).

> **Optional override:** Set `DATABASE_URL=postgresql://user:pass@host:port/squadboard` to use an external Postgres instance instead of packaged PGlite (useful for CI or production deployments).

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/sabbour/squadboard
   cd squadboard
   ```

2. Install dependencies:
   ```bash
   pnpm install
   ```

### Initialize & Run

**Option A: Start all services (backend + frontend + docs)**

```bash
npm start
# or: pnpm start
```

This starts:
- Backend (Express + WebSocket) on http://localhost:3000
- Frontend (React + Vite) on http://localhost:5173
- Docs (Docusaurus) on http://localhost:3002
- PGlite-backed local database (auto-managed, no setup needed)
- PostgreSQL-backed Squad state by default; existing `.squad/` files are imported once into an empty DB-backed project

Open http://localhost:5173 in your browser. Docs are available at http://localhost:3002.

**Explicit PostgreSQL launch**

The root startup scripts already use the PostgreSQL provider. Use the explicit script when you want launch intent to be obvious in docs, terminals, or automation:

```bash
pnpm run dev:postgresql
```

Squadboard will:
- Use packaged PGlite automatically (`@electric-sql/pglite`)
- Import any existing `.squad/` files into the database on startup (one-time)
- Store all future Squad state in PostgreSQL alongside Squadboard product state

**Standalone server with PostgreSQL:**

```bash
pnpm --filter @sabbour/squadboard dev:postgresql
```

**Using CLI directly:**

```bash
squadboard start --squad-storage postgresql
# or
squadboard start --postgresql-storage  # alias
```

**Filesystem fallback:**

```bash
pnpm run dev:fs
squadboard start --squad-storage fs
```

Use this when you intentionally want Squad state to stay in repository `.squad/` files.

Squad Sync status is project-aware: registered CLI/Copilot-first projects remain labeled as filesystem-authoritative unless they have a persisted PostgreSQL authority mode or imported `squad_storage` rows. The process storage provider is a runtime default, not proof that every project is database-authoritative.

**Override with an external PostgreSQL instance:**

If you need to share Squad state across machines (multi-process, multi-agent), point `DATABASE_URL` to your external instance:

```bash
DATABASE_URL=postgresql://user:password@host:port/squadboard pnpm run dev
```

See [Storage provider — Configuration recipes](packages/docs-site/docs/user-guide/storage-provider.mdx#configuration-recipes-for-shared-storage) for more scenarios and external agent compatibility guidance.

**Configure Copilot CLI / `squad.agent.md` to use Squadboard as the broker:**

```bash
squadboard init --write-mcp-config
# or inspect the config first
squadboard init --print-mcp-config
```

This writes/prints a `.copilot/mcp-config.json` entry that starts `squadboard mcp` with `SQUADBOARD_SQUAD_STORAGE_PROVIDER=postgresql`. Stock Copilot CLI and `squad.agent.md` should use the Squadboard MCP tools for shared state; direct database access from upstream Squad CLI requires compatible upstream StorageProvider support.

**Option B: Start components separately**

Backend:
```bash
pnpm --filter @sabbour/squadboard dev
```

Frontend (in another terminal):
```bash
pnpm --filter @sabbour/squadboard-client dev
```

Docs (in another terminal):
```bash
pnpm docs:dev
```

### First Run: 60-Second Click-Through

1. **Create a project** — Click "New Project" on the dashboard. Squadboard scans `.squad/` for agents and ceremonies.
2. **Throw a card on the board** — Type a title (e.g., "Fix login timeout") and move it into the `ready` column when the team should pick it up.
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

### Copilot CLI + Squad Coexistence

Squadboard now has the server-side pieces needed to mirror the current Copilot CLI + [Squad](https://github.com/bradygaster/squad) driver loop:

- **Coordinator coexistence:** shared input builder, deterministic prefilters, visible circuit-breaker skips, and bounded LLM routing for semantic ambiguity.
- **Spawn fidelity:** server-spawned agents receive charter, team root, requester, workspace mode/path, history/decision-reading instructions, assigned skills, MCP context, drop-box guidance, and validation expectations.
- **Directive and Scribe loop:** directives can be captured into `.squad/decisions/inbox/`; daemon and coordinator close-out converge on the Scribe close-out service.
- **Opt-in Ralph monitor:** autonomous work monitoring is disabled by default and can audit/prioritize untriaged work, member labels, assigned pickup, CI/review states, approved PRs, and drafts.
- **Lifecycle coverage:** setup scaffolds `.squad/` state, ceremonies expose lifecycle/worktree metadata, and project, virtual Copilot, and human agent origins are visible.

Current GitHub automation limit: Ralph can record and recommend next actions for GitHub work that was not started from Ready-column pickup, such as CI failures or review feedback. It does not merge PRs or apply fixes automatically without an explicit human approval policy.

### Cross-Surface Squad Sync — Squadboard and CLI/Copilot are Interchangeable

**Core promise:** You can start a Squad project in Squadboard's web UI, then continue work in Copilot CLI/VS Code without losing state. Or start in CLI/Copilot and later add Squadboard to the same project. Both surfaces are peer clients reading/writing the same authoritative Squad state.

#### Storage Modes and Authority

Every project uses one of two storage modes, set at creation:

- **PostgreSQL mode (default):** Squad state lives in Squadboard's database. Both Squadboard and CLI/Copilot access it via Squadboard's MCP broker or API. Filesystem `.squad/` files are regenerated projections. This is the recommended mode for teams and multi-surface use.
- **Filesystem mode (opt-in):** Squad state lives in repository `.squad/` files. Squadboard reads them for advisory display. CLI/Copilot work directly with files. This is the recommended mode for solo developers and full Git control.

Configure at startup:
```bash
pnpm run dev:postgresql  # PostgreSQL mode (default)
pnpm run dev:fs          # Filesystem mode (opt-in)

# Or per-project
squadboard start --squad-storage postgresql
squadboard start --squad-storage fs
```

#### Path 1: Squadboard-First

1. **Create in Squadboard UI** — Click "New Project" → project is created in PostgreSQL mode.
2. **Squadboard bootstraps** — Seeds team roster, ceremonies defaults (Simple Review, Bug Fix, RFC, Spike, Pair Programming), routing rules, and agent files.
3. **Repair client projections** — Settings → **Squad Sync** shows missing ceremony defaults and missing `.github/agents/squad.agent.md` with one-click repair actions.
4. **Open in Copilot CLI** — Configure MCP (see "MCP Integration" above). Copilot CLI uses the generated Squad agent file plus Squadboard's MCP/API broker to share the same Squad state.
5. **Write code, run ceremonies** — Teams use both surfaces interchangeably. There is one active authority and no implicit background two-way mirror.

#### Path 2: CLI-First

1. **Start with CLI/Copilot** — Use `squad.agent.md` and the Squad CLI as normal. `.squad/` files are created locally on your machine.
2. **Add Squadboard later** — Register or initialize the repo in Squadboard. The sync status endpoint reports whether filesystem or PostgreSQL storage is the active authority.
3. **Choose your mode** — Keep filesystem mode, where `.squad/` is the live authority, or use PostgreSQL mode, where clients write through Squadboard's MCP/API broker.
4. **Open in Copilot CLI** — Use the generated `.github/agents/squad.agent.md` projection. Now both surfaces point at the same authoritative state.

#### Checking Sync Health and Repairing

When Squadboard and CLI/Copilot are out of sync (e.g., missing ceremony defaults, stale agent files, or diverged state), you can check and repair:

**Check Status:**
```bash
curl http://localhost:3000/api/projects/{projectId}/squad-sync/status
```

Returns a detailed report:
- Current storage mode and authority
- Bootstrap status (completed, partial, missing)
- Drift detection across surfaces
- Repair actions available

**Repair Missing Artifacts:**
```bash
curl -X POST http://localhost:3000/api/projects/{projectId}/squad-sync/repair \
  -H "Content-Type: application/json" \
  -d '{"actions": ["seed-ceremony-defaults", "generate-github-agent"], "dryRun": false}'
```

Repair actions include:
- `seed-ceremony-defaults` — Replace an empty/default-only `.squad/ceremonies.md` with seeded ceremony defaults
- `generate-github-agent` — Recreate `.github/agents/squad.agent.md` for Copilot CLI/VS Code
- `project-squad-to-fs` — Explicitly project database-backed Squad state to `.squad/` files when PostgreSQL is authoritative

**UI Sync Panel:**
Project Settings → **Squad Sync** shows:
- Active storage mode and authority
- Bootstrap health and drift status
- One-click repair buttons per issue
- Required and recommended projection artifacts

#### Why This Matters

Before cross-surface sync, teams faced a choice:
- Use Squadboard, lose CLI/Copilot (no `.github/agents/squad.agent.md`)
- Use CLI/Copilot, lose Squadboard (unclear if filesystem owned state or database)
- Juggle both but risk data loss on mode switch

Now: **choose your starting point, make the active authority explicit, and use repair/export actions when you intentionally hand state between surfaces.**

### Test Coverage Inventory

Run the automated suite with `pnpm test:e2e`. The Playwright config starts the Squadboard API and Vite client through `webServer`; tests no longer assume a backend is already running.

| Layer | Command | Coverage |
| --- | --- | --- |
| Server Vitest | `pnpm --filter @sabbour/squadboard exec vitest run src/sdk/sync-ownership.test.ts src/__tests__/squad-sync-authority.test.ts src/__tests__/squad-sync-route.test.ts src/__tests__/squad-sync-status-route.test.ts` | Storage authority, bootstrap artifacts, repair actions, status/repair route envelopes, filesystem-authoritative safety. |
| Client Vitest | `pnpm --filter @sabbour/squadboard-client test -- src/components/settings/__tests__/SquadSyncStatusPanel.test.tsx` | Settings → Squad Sync normalization, labels, repair buttons, and unavailable status handling. |
| Playwright E2E | `pnpm test:e2e` | Full-stack launch, onboarding, kanban smoke paths, navigation, agents, templates, WebSocket connectivity, team portability, consult send guards, disabled-agent guards, loading pattern, cast team, jump-into-session, docs scenarios, Squad Sync status/repair/projection paths, and deterministic Copilot CLI command-runner coverage. |
| Live gated E2E | `SQUADBOARD_E2E_LIVE_COPILOT=1 pnpm test:e2e -- 13-copilot-cli-launch.spec.ts` | Launches a real authenticated Copilot CLI from a repaired test project and asks Squad. This is opt-in because CI may not have Copilot CLI auth/network access. |

### Build for Production

```bash
pnpm build
```

This compiles TypeScript and builds the React frontend. Output:
- Backend: `packages/server/dist/index.js`
- Frontend: `packages/client/dist/`
- Docs site: `packages/docs-site/build/`

Run the built CLI entry point when you need the previous root `start` behavior:
```bash
pnpm run cli:start
```

### Documentation Site

The Docusaurus docs site lives in `packages/docs-site` and is mounted under
`/docs/` to match the public docs URL shape.

```bash
pnpm docs:dev
pnpm docs:build
pnpm docs:serve
```

The docs build generates `llms.txt` and `llms-full.txt` for LLM/code-agent
ingestion. The docs dev and serve commands bind to http://localhost:3002 so the backend keeps port 3000.

### Dogfood Mode — Auto-capture Directives

When running Squadboard under GitHub Copilot CLI with [Squad](https://github.com/bradygaster/squad) as the coordinator,
implementation directives can be captured into Squadboard's project inbox and
the `.squad/decisions/inbox/` memory drop box. This closes the dogfood loop:
directives → decisions → board cards → runs → Scribe close-out.

**Setup:**
1. Ensure your `.copilot/mcp-config.json` points to this repo's MCP server
2. Set `SQUADBOARD_DEFAULT_PROJECT_ID` to your project UUID (use `list_projects`
   to discover it)
3. Reference `.squad/dogfood.md` for the full coordinator playbook

See [Dogfood Playbook](.squad/dogfood.md) and [MCP tool reference](packages/server/src/mcp/README.md)
for details on the `capture` tool and when the coordinator calls it.

### Cost Tracking — GitHub AI Credits

Squadboard tracks cost in two models:
- **USD:** Token-based pricing estimates.
- **GitHub AI Credits:** Usage-based Copilot billing display derived from the USD estimate (`1 credit = $0.01`). GitHub no longer bills individual plans by premium requests.

Switch models via:
```bash
# Set globally
export SQUADBOARD_COST_MODEL=ai_credits

# Or per-project via the API (see next section)
curl -X PATCH http://localhost:3000/api/projects/{projectId} \
  -H "Content-Type: application/json" \
  -d '{"costModel": "ai_credits"}'
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
pnpm --filter @sabbour/squadboard db:studio
```

Opens Drizzle Studio on http://localhost:3001.

## Concepts at a Glance

- **[Ceremonies](docs/concepts/ceremonies.md)** — Named triggered processes (e.g., "Review on demand", "Auto-fix on bug label"). You author them; the engine runs them.
- **[Workflows](docs/concepts/ceremonies.md#workflow-step-catalogue)** — Ordered steps inside ceremonies (agent_run, peer_review, approve, fan_out, route, retry, branch, wait_event, wait_timer, github_pr, etc.).
- **[Projects](docs/prd.md#projects)** — Isolated workspaces. Each project owns a kanban board, team of agents, ceremony templates, and GitHub sync settings.
- **[Agents & Skills](docs/prd.md#agents)** — Project agents in `.squad/agents/`, virtual Copilot/system members, human collaborators, and reusable skill addenda injected into runs.
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
- Copilot CLI + Squad coexistence prefilters and audited routing decisions

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
- GitHub App or PAT auth, activity sync, and Ralph monitor decision auditing

### Reliability
- Periodic backup + restore CLI/UI
- 6-invariant safety checks
- Packaged PGlite storage for local use; external PostgreSQL when state must be shared across processes

### Real-time UI
- Live run drawer (WebSocket push from engine)
- Activity feed, optimistic UI
- Reconnect cursor (resume after network drop)

### SDK + MCP
- `@sabbour/squadboard-sdk` (SquadClient, CharterCompiler, CostTracker, EventBus)
- 10 MCP tools (stdio for Copilot CLI / VS Code; HTTP for embedding)
- Daemon mode for coordinator
- Scribe close-out and directive capture primitives for the dogfood loop

### Conjure (Quick-Capture)
- Freeform prompt router with intent classifier
- Auto-capture from Copilot CLI directives
- Done-prefix to close cards
- Fail-open directive capture into durable decision inbox files

---

## Squad Integration

Squadboard integrates with the upstream **[Squad agent](https://github.com/bradygaster/squad)** for hands-off multi-agent orchestration.

When running Squad under Copilot CLI with Squadboard's coordinator extension enabled:
- Implementation directives can capture to Squadboard's inbox and decision-memory drop box
- Agent hand-offs resolve to board cards
- Ceremony runs are visible in real-time
- Close-out triggers automatic card completion

Setup: Enable the Squadboard coordinator fragment in `~/.squad/extensions/coordinator/squadboard.md` (auto-installed on `npm install`), and set `SQUADBOARD_DEFAULT_PROJECT_ID` env var.

See [Coordinator Extension Guide](docs/plugins/squad-coordinator-extensions.md) and [Dogfood Playbook](.squad/dogfood.md) for details.

---

## Responsible AI Stance

Squadboard is built around bounded AI assistance, not unchecked automation.

- **Human accountability:** Agents can propose and execute work, but project-impacting changes should remain reviewable by people through board state, approvals, GitHub review, and audit logs.
- **Deterministic guardrails:** The server owns dependency gates, circuit breakers, availability, schema validation, routing logs, and close-out state. LLMs are reserved for ambiguity, summarization, and semantic role fit.
- **Least privilege:** GitHub tokens, MCP tools, worktree cleanup, and external integrations should be scoped narrowly. Prefer GitHub Apps over broad PATs when possible.
- **Transparency:** Agent prompts, decisions, generated artifacts, and run events should be inspectable so teams can understand why work moved.
- **Local-first privacy:** Squadboard stores project data locally by default. External model, GitHub, and MCP calls are opt-in integration boundaries that should be configured intentionally.
- **Pre-alpha caution:** Do not use Squadboard for regulated, safety-critical, confidential, or unattended production workflows without your own review, security assessment, and operational controls.

---

## Links

- **[Product Requirements Document](docs/prd.md)** — Full vision, roadmap, 15-demo plan, success criteria, engine invariants
- **[Concepts: Ceremonies & Workflows](docs/concepts/ceremonies.md)** — Ceremony types, workflow steps, custom YAML, trigger configuration
- **[Feature List](docs/features.md)** — Complete breakdown of workflow engine, bundles, ceremonies, GitHub integration, SDK+MCP, and roadmap
- **[MCP Install & Configuration](docs/setup/mcp-install.md)** — Setup for Copilot CLI, VS Code, and embedded HTTP
- **[Upstream Squad Agent](https://github.com/bradygaster/squad)** — Copilot CLI driver and `.squad/` team conventions Squadboard is designed to complement
- **[Dogfood Playbook](.squad/dogfood.md)** — Using Squadboard to run Squadboard (auto-capture + close-out loop)
- **[GitHub Repository](https://github.com/sabbour/squadboard)** — Source code
- **[MIT License](LICENSE)**

---

## Status

**Pre-alpha / hacking phase.** Squadboard is experimental software. Expect breaking changes, missing polish, and behavior that still needs validation. No cloud yet — self-hosted on your machine or your infrastructure.

This is **local git only** during hacking phase. PR workflow resumes on launch.

## License

MIT

---

<img src="assets/squadboard.svg" alt="" width="56" align="left" hspace="12" />

Built by McManus, Hockney, Kobayashi, Keyser, Verbal, Fenster, Kujan, and Redfoot.
