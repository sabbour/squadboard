# MCP Installation & Configuration

Squadboard exposes 10 tools via **Model Context Protocol (MCP)** over stdio for VS Code and GitHub Copilot CLI, or over HTTP for embedded use.

---

## Quick Start

### GitHub Copilot CLI

Add to `~/.copilot/mcp-config.json`:

```json
{
  "mcpServers": {
    "squadboard": {
      "command": "node",
      "args": ["/absolute/path/to/packages/cli/dist/index.js", "mcp"],
      "env": {
        "SQUADBOARD_SQUAD_STORAGE_PROVIDER": "postgresql"
      }
    }
  }
}
```

Replace `/absolute/path/to` with the full path to your Squadboard repository.

Restart Copilot CLI. Squadboard tools are now available to agents.

You can also generate the repo-local config:

```bash
squadboard init --write-mcp-config
```

That config makes Copilot CLI plus `squad.agent.md` use Squadboard as the broker for PostgreSQL-backed Squad state. Add `--squad-storage fs` only when you want filesystem `.squad/` fallback.

### VS Code

Install the [MCP extension](https://marketplace.visualstudio.com/items?itemName=cline.cline) for VS Code.

Add to `.vscode/mcp.json` (project-level, commit to repo):

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

Reload VS Code. Squadboard tools appear in the assistant sidebar.

---

## Available Tools (10)

| Tool | Purpose | Requires `projectId`? |
|------|---------|----------------------|
| `list_projects` | List all projects with resolved `.squad/` paths | No |
| `list_issues` | List board cards, filter by status (backlog, todo, in_progress, in_review, done) | Yes |
| `create_issue` | Create a new card on the board | Yes |
| `update_issue` | Update card title, body, status, assignee, or labels | No (issue-scoped) |
| `run_agent` | Trigger an agent run on a card | Yes (auto-picks first active agent if omitted) |
| `get_run_status` | Get status, output, and cost of a completed run | No (run-scoped) |
| `list_agents` | List agents in a project; filter by status (active, disabled, retired, all) | Yes |
| `list_inbox` | List Conjure inbox items (quick-capture queue), filter by status or project | Yes |
| `capture` | Drop a freeform prompt into Squadboard; routes via intent classifier | Yes |
| `slash_command` | Execute a `/squadboard` slash command (alias for command-line interface) | No |
| `get_routing` | Return `.squad/routing.md` file (project-routing metadata) | Yes |

**Note:** Project-scoped tools accept `projectId` in args OR via `x-project-id` HTTP header (HTTP transport only). For stdio (Copilot CLI, VS Code), pass `projectId` in args.

---

## Authentication

### Stdio Transport (Copilot CLI, VS Code)

No authentication required. The MCP server runs as a subprocess of your CLI/editor, with full access to the local `.squad/` directory and embedded Postgres.

### HTTP Transport (Embedded)

The HTTP MCP endpoint lives at `POST /mcp` on the Squadboard server (default `localhost:3000`).

**Authentication methods:**
- **Run-scoped JWT:** Included in request header (`Authorization: Bearer <jwt>`). Generated on session init.
- **Service account:** Long-lived token for CI/daemon use (set `SQUADBOARD_SERVICE_ACCOUNT_TOKEN` env var; available at `GET /mcp/health` endpoint).

No token required for localhost development. Production deployments should enable HTTPS + token auth.

---

## Configuration Examples

### Set Project ID in Config

To avoid passing `projectId` in every tool call, set the default project via `SQUADBOARD_DEFAULT_PROJECT_ID`:

```bash
# Shell env var (Copilot CLI will inherit)
export SQUADBOARD_DEFAULT_PROJECT_ID="550e8400-e29b-41d4-a716-446655440000"

# Or in ~/.copilot/mcp-config.json (env section)
{
  "mcpServers": {
    "squadboard": {
      "command": "node",
      "args": ["/path/to/packages/cli/dist/index.js", "mcp"],
      "env": {
        "SQUADBOARD_SQUAD_STORAGE_PROVIDER": "postgresql",
        "SQUADBOARD_DEFAULT_PROJECT_ID": "550e8400-e29b-41d4-a716-446655440000"
      }
    }
  }
}
```

Then `list_issues` works without explicit `projectId`:

```bash
cd /path/to/your/squadboard/project
gh copilot run "list all cards in in_progress status"
# Uses SQUADBOARD_DEFAULT_PROJECT_ID automatically
```

Discover your project ID:

```bash
npx @sabbour/squadboard list-projects
# Output: [{ id: "550e8400...", name: "My Project", squadPath: "/home/you/.squad" }]
```

### Multi-Project Setup

If you work with multiple projects, use the project slug or path:

```bash
gh copilot run "create a card in project 'my-product' titled 'Fix login bug'"
# The capture tool's router infers the project from the name
```

Or explicitly provide project ID on the command:

```bash
gh copilot run "list_issues --projectId 550e8400-e29b-41d4-a716-446655440000"
```

---

## Tools Reference

### `list_projects`

List all Squadboard projects.

**Arguments:** None

**Example response:**
```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "Squadboard Core",
    "squadPath": "/home/user/work/squadboard/.squad"
  }
]
```

---

### `list_issues`

List cards on the board, optionally filtered by status.

**Arguments:**
- `projectId` (string, required if no default set)
- `status` (string, optional) — `backlog`, `todo`, `in_progress`, `in_review`, `done`

**Example:**
```bash
gh copilot run "list_issues --projectId abc123 --status in_progress"
```

**Response:**
```json
[
  {
    "id": "issue-uuid-1",
    "title": "Fix login timeout",
    "status": "in_progress",
    "assignee": "alice",
    "createdAt": "2026-05-15T10:30:00Z"
  }
]
```

---

### `create_issue`

Create a new card.

**Arguments:**
- `projectId` (string, required if no default set)
- `title` (string, required)
- `body` (string, optional) — Markdown description
- `labels` (array of strings, optional)
- `idempotencyKey` (string, optional) — Safe to replay; partial dedup

**Example:**
```bash
gh copilot run "create_issue --projectId abc123 --title 'Investigate spike in error rate' --body 'Last 2 hours: 10x increase. Check DB migrations.'"
```

---

### `run_agent`

Trigger an agent run on a card.

**Arguments:**
- `issueId` (string, required)
- `agentId` (string, optional) — Auto-picks first active agent in project if omitted

**Example:**
```bash
gh copilot run "run_agent --issueId issue-uuid-1 --agentId agent-uuid-1"
```

**Response:**
```json
{
  "runId": "run-uuid-1",
  "issueId": "issue-uuid-1",
  "agentId": "agent-uuid-1",
  "status": "queued"
}
```

---

### `get_run_status`

Get status, output, and cost of a completed run.

**Arguments:**
- `runId` (string, required)

**Example:**
```bash
gh copilot run "get_run_status --runId run-uuid-1"
```

**Response:**
```json
{
  "id": "run-uuid-1",
  "status": "completed",
  "output": "Fix applied. PR #42 opened.",
  "cost": {
    "usd": 0.15,
    "tokens": 1500
  },
  "completedAt": "2026-05-15T11:45:00Z"
}
```

---

### `list_agents`

List agents in a project.

**Arguments:**
- `projectId` (string, required if no default set)
- `status` (string, optional) — `active` (default), `disabled`, `retired`, or `all`

**Example:**
```bash
gh copilot run "list_agents --projectId abc123"
```

**Response:**
```json
[
  {
    "id": "agent-uuid-1",
    "name": "Alice (reviewer)",
    "status": "active",
    "charter": "Review code for correctness and style."
  }
]
```

---

### `capture`

Drop a freeform prompt into Squadboard. Routes via intent classifier.

**Arguments:**
- `prompt` (string, required) — The prose to capture
- `projectId` (string, optional)
- `hint` (string, optional) — Pre-classified intent: `project`, `issue`, `team`, `agent`, `skill`, `tool`
- `useLlm` (boolean, optional) — If false, rule-based classification only
- `idempotencyKey` (string, optional) — Dedup key
- `createdBy` (string, optional) — Provenance tag (default `user`)

**Examples:**

Close an existing card:
```bash
gh copilot run "capture --prompt 'done: Fixed login timeout (sha=abc123)'"
```

Create a new card:
```bash
gh copilot run "capture --prompt 'Add dark mode support' --hint issue"
```

Capture a directive (auto-routed to inbox):
```bash
gh copilot run "capture --prompt 'RFC: Migrate to TypeScript' --createdBy copilot-cli"
```

**Response (if issue intent):**
```json
{
  "type": "issue",
  "issueId": "new-issue-uuid",
  "created": true
}
```

**Response (if non-issue intent):**
```json
{
  "type": "team",
  "draft": "Hire agent with expertise in hiring, onboarding, team dynamics.",
  "routing": "Suggest to squad lead; no auto-create"
}
```

---

### `slash_command`

Execute a `/squadboard` slash command.

**Arguments:**
- `command` (string, required) — Full command string, e.g., `/squadboard list --project my-project`

**Example:**
```bash
gh copilot run "slash_command --command '/squadboard list --status in_progress'"
```

---

## Troubleshooting

### "MCP server not connecting"

**Check:**
1. Is Squadboard running? `pnpm run dev` starts the server on `localhost:3000`.
2. Is the path in your config correct? Verify with `ls packages/cli/dist/index.js`.
3. Restart your CLI or editor after updating the config.

**For Copilot CLI:**
```bash
~/.copilot/mcp-config.json  # Full absolute path required
```

**For VS Code:**
```bash
.vscode/mcp.json  # Relative path OK (resolved from workspace root)
```

---

### "Tools not appearing"

1. Check MCP server startup: `node packages/cli/dist/index.js mcp` should start without errors.
2. List available tools: `gh copilot run "mcp health"` (or equivalent in VS Code).
3. Verify `squadboard` server is registered: Look for `"squadboard"` in your config's `mcpServers` (Copilot) or `servers` (VS Code).

---

### "Auth failures / 401 responses"

1. Stdio transport: No auth needed. If error occurs, check local Squadboard server logs: `~/.squadboard/server.log`.
2. HTTP transport: Verify `Authorization` header includes valid JWT or service account token.
3. Check token expiry: Run-scoped JWTs are short-lived (~1h). Refresh the session.

---

### "Project not found" error

1. Run `squadboard list-projects` to discover project IDs.
2. Set `SQUADBOARD_DEFAULT_PROJECT_ID` env var, or pass `--projectId` explicitly.
3. Verify the `.squad/` directory exists and is readable at the project path.

---

## Links

- **[Squadboard README](../../README.md)** — Setup, CLI, GitHub integration
- **[MCP Standard](https://modelcontextprotocol.io)** — Official MCP specification
- **[Copilot CLI Documentation](https://docs.github.com/en/copilot)** — Copilot CLI overview
- **[Concepts: Ceremonies & Workflows](../concepts/ceremonies.md)** — Understanding ceremony structure for MCP calls
