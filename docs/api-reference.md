# Squadboard API Reference

Base URL: `http://localhost:3000` (local) or your deployed server.

**Authentication:** All endpoints require `Authorization: Bearer <token>` header unless marked 🔓 (public).

**JWT Token:** Must contain `projectId` claim for project-scoped endpoints. Generated via `/api/auth` or environment token.

---

## Table of Contents

- [Activity](#activity)
- [Agents](#agents)
- [Analytics](#analytics)
- [Casting](#casting)
- [Columns](#columns)
- [Conjure (Smart Create)](#conjure-smart-create)
- [Costs](#costs)
- [GitHub Sync](#github-sync)
- [Health & System](#health--system)
- [Heartbeat](#heartbeat)
- [Inbox](#inbox)
- [Issues](#issues)
- [Labels](#labels)
- [Models](#models)
- [Projects](#projects)
- [Portability](#portability)
- [Presence](#presence)
- [Review Policies](#review-policies)
- [Roles](#roles)
- [Routing](#routing)
- [Sessions](#sessions)
- [Skills & Tools](#skills--tools)
- [Squad](#squad)
- [Templates](#templates)
- [WebSocket](#websocket)

---

## Activity

Stream live events across all projects (requires global subscribe).

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/activity/now` | Stream all active events |

---

## Agents

Manage agents within a project.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/projects/:projectId/agents` | List all agents in project |
| `POST` | `/api/projects/:projectId/agents` | Create new agent |
| `POST` | `/api/projects/:projectId/agents/formulate` | AI formulate agent from description |
| `POST` | `/api/projects/:projectId/agents/team/formulate` | Formulate team of agents |
| `POST` | `/api/projects/:projectId/agents/hire-team/propose` | Propose team hiring plan |
| `POST` | `/api/projects/:projectId/agents/hire-team/confirm` | Confirm team hiring |
| `GET` | `/api/projects/:projectId/agents/:id` | Get agent details |
| `PATCH` | `/api/projects/:projectId/agents/:id` | Update agent |
| `DELETE` | `/api/projects/:projectId/agents/:id` | Delete agent |
| `GET` | `/api/projects/:projectId/agents/:id/charter` | Get agent charter/instructions |
| `PATCH` | `/api/projects/:projectId/agents/:id/charter` | Update agent charter |

**Agent Skills & Tools:**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/projects/:projectId/agents/:agentId/skills` | List agent skills |
| `POST` | `/api/projects/:projectId/agents/:agentId/skills` | Assign skill to agent |
| `DELETE` | `/api/projects/:projectId/agents/:agentId/skills/:skillId` | Remove skill from agent |
| `GET` | `/api/projects/:projectId/agents/:agentId/tools` | List agent tools |
| `POST` | `/api/projects/:projectId/agents/:agentId/tools` | Add tool to agent |
| `GET` | `/api/projects/:projectId/agents/:agentId/mcp-servers` | List agent MCP servers |
| `POST` | `/api/projects/:projectId/agents/:agentId/mcp-servers` | Configure MCP server |

---

## Analytics

Project metrics and insights.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/projects/:projectId/analytics/overview` | Project metrics overview |
| `GET` | `/api/projects/:projectId/analytics/throughput` | Issue completion throughput |
| `GET` | `/api/projects/:projectId/analytics/agents` | Agent performance metrics |
| `GET` | `/api/projects/:projectId/analytics/workflows` | Workflow execution stats |

---

## Casting

Universe/model selection for agents.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/casting/universes` | List available LLM universes |
| `POST` | `/api/projects/:projectId/cast` | Cast/assign universe to agent |

---

## Columns

Kanban board column metadata and operations.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/projects/:projectId/columns` | List all columns with metadata |
| `POST` | `/api/projects/:projectId/columns` | Create new column |
| `POST` | `/api/projects/:projectId/columns/reset` | Reset columns to defaults |
| `PATCH` | `/api/projects/:projectId/columns/reorder` | Reorder columns |
| `PATCH` | `/api/projects/:projectId/columns/:columnId` | Update column metadata (title, semantic) |
| `DELETE` | `/api/projects/:projectId/columns/:columnId` | Delete column |

---

## Conjure (Smart Create)

Intelligent issue creation and classification.

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/conjure/classify` | Classify issue text (returns type, title, description) |

---

## Costs

Project costs and budget tracking.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/projects/:projectId/costs` | Get project cost metrics |
| `GET` | `/api/projects/:projectId/costs/budget` | Get current budget limit |
| `PUT` | `/api/projects/:projectId/costs/budget` | Set budget limit |

---

## GitHub Sync

GitHub repository integration and synchronization.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/projects/:projectId/github` | Get GitHub sync config |
| `PUT` | `/api/projects/:projectId/github` | Configure GitHub sync |
| `DELETE` | `/api/projects/:projectId/github` | Disable GitHub sync |
| `POST` | `/api/projects/:projectId/github/sync` | Trigger manual sync |
| `GET` | `/api/projects/:projectId/github/activity` | Get GitHub sync activity log |
| `GET` | `/api/projects/:projectId/github/log` | Get detailed sync logs |
| `POST` | `/api/projects/:projectId/github/webhook` | GitHub webhook receiver (30 day retention) |

---

## Health & System

Server status and system information.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | 🔓 Server health status |
| `GET` | `/api/system/config` | System configuration |

---

## Heartbeat

Background sweep registry and heartbeat status.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/heartbeat` | Get heartbeat status |
| `GET` | `/api/heartbeat/status` | Detailed sweep status |
| `GET` | `/api/heartbeat/sweeps` | List all registered sweeps |
| `POST` | `/api/heartbeat/sweeps/:id/run` | Trigger sweep manually |
| `PATCH` | `/api/heartbeat/sweeps/:id` | Update sweep configuration |

---

## Inbox

Issue inbox and triage.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/inbox` | Get inbox items across projects |

---

## Issues

Core issue management.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/projects/:projectId/issues` | List project issues |
| `POST` | `/api/projects/:projectId/issues` | Create issue |
| `POST` | `/api/projects/:projectId/issues/formulate` | AI formulate issue from description |
| `POST` | `/api/projects/:projectId/issues/bulk` | Bulk create issues |
| `GET` | `/api/projects/:projectId/issues/:id` | Get issue details |
| `PATCH` | `/api/projects/:projectId/issues/:id` | Update issue (title, description) |
| `DELETE` | `/api/projects/:projectId/issues/:id` | Delete issue |
| `PATCH` | `/api/projects/:projectId/issues/:id/move` | Move issue to column |
| `PATCH` | `/api/projects/:projectId/issues/:id/labels` | Update issue labels |

**Issue Runs:**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/projects/:projectId/issues/:issueId/runs` | List issue runs |
| `POST` | `/api/projects/:projectId/issues/:issueId/runs` | Start new run |

**Issue Workflows:**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/projects/:projectId/issues/:issueId/workflow` | Get workflow state |
| `POST` | `/api/projects/:projectId/issues/:issueId/workflow` | Advance workflow |

**Issue Flow:**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/projects/:projectId/issues/:issueId/flow` | Get issue flow visualization |

---

## Labels

Issue labels and tagging.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/projects/:projectId/labels` | List project labels |
| `POST` | `/api/projects/:projectId/labels` | Create label |
| `PATCH` | `/api/projects/:projectId/labels/:id` | Update label |
| `DELETE` | `/api/projects/:projectId/labels/:id` | Delete label |

---

## Models

LLM model registry and configurations.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/models` | List available LLM models |
| `POST` | `/api/models` | Register custom model |

---

## Projects

Core project management.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/projects` | List all projects |
| `POST` | `/api/projects` | Create project |
| `GET` | `/api/projects/:projectId` | Get project details |
| `PATCH` | `/api/projects/:projectId` | Update project |
| `DELETE` | `/api/projects/:projectId` | Delete project |

**Project Flow:**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/projects/:projectId/flow` | Get project flow visualization |

**Project Deliverables:**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/projects/:projectId/deliverables` | List deliverables |
| `POST` | `/api/projects/:projectId/deliverables` | Create deliverable |

**Project Runs:**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/projects/:projectId/runs` | List project runs |
| `POST` | `/api/projects/:projectId/runs` | Create run |

**Project Routing:**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/projects/:projectId/routing` | Get routing config |
| `POST` | `/api/projects/:projectId/routing` | Configure routing |

**Project Ralph Monitor:**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/projects/:projectId/ralph-monitor` | Get autonomous monitor status |
| `POST` | `/api/projects/:projectId/ralph-monitor` | Configure autonomous monitor |

---

## Portability

Project/team export, import, and templates.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/projects/:projectId` | Export project |
| `POST` | `/api/projects/:projectId` | Import project state |
| `GET` | `/api/projects/:projectId/team` | Export team config |
| `POST` | `/api/projects/:projectId/team` | Import team config |
| `GET` | `/api/templates` | List project templates |
| `POST` | `/api/templates` | Create template from project |
| `GET` | `/api/templates/:id` | Get template details |

---

## Presence

Real-time user presence (also available via WebSocket).

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/projects/:projectId/presence` | Get current presence snapshot |

---

## Review Policies

Code/deliverable review policies.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/projects/:projectId/review-policies` | List review policies |
| `POST` | `/api/projects/:projectId/review-policies` | Create review policy |
| `PATCH` | `/api/projects/:projectId/review-policies/:id` | Update review policy |
| `DELETE` | `/api/projects/:projectId/review-policies/:id` | Delete review policy |

---

## Roles

User roles and permissions.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/roles` | List available roles |
| `POST` | `/api/roles` | Create custom role |

---

## Routing

Smart issue routing to agents/workflows.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/projects/:projectId/routing` | Get routing rules |
| `POST` | `/api/projects/:projectId/routing` | Create routing rule |
| `PATCH` | `/api/projects/:projectId/routing/:id` | Update routing rule |

---

## Sessions

Live multi-agent sessions and conversations.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/projects/:projectId/sessions` | List project sessions |
| `POST` | `/api/projects/:projectId/sessions` | Create session |
| `GET` | `/api/projects/:projectId/sessions/:id` | Get session details |

---

## Skills & Tools

Agent capabilities registry.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/skills/curated` | List curated skills library |
| `POST` | `/api/skills/curated` | Add to curated library |
| `GET` | `/api/projects/:projectId/skills` | List project skills |
| `POST` | `/api/projects/:projectId/skills` | Add skill to project |
| `GET` | `/api/projects/:projectId/tools` | List project tools |
| `POST` | `/api/projects/:projectId/tools` | Add tool to project |

---

## Squad

Team and squad operations.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/squad` | Get squad status |
| `POST` | `/api/squad` | Create squad |
| `PATCH` | `/api/squad` | Update squad |

**Squad Sync:**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/projects/:projectId/squad-sync` | Get squad sync status |
| `POST` | `/api/projects/:projectId/squad-sync` | Sync squad state |

---

## Templates

Workflow and project templates.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/templates` | List all templates |
| `POST` | `/api/templates` | Create template |
| `GET` | `/api/templates/:id` | Get template |
| `PATCH` | `/api/templates/:id` | Update template |
| `DELETE` | `/api/templates/:id` | Delete template |

**Workflow Templates:**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/projects/:projectId/ceremonies/templates` | List workflow templates |
| `POST` | `/api/projects/:projectId/ceremonies/templates` | Create workflow template |

---

## WebSocket

See [WebSocket Protocol](./websocket-protocol.md) for real-time events.

Connection URL: `ws://localhost:3000/api/ws?token=<jwt>`

---

## Common Patterns

### Error Responses

All endpoints return standardized error responses:

```json
{
  "error": "Human readable error message",
  "code": "ERROR_CODE",
  "details": {}
}
```

### Pagination

List endpoints support optional query parameters:

- `limit`: Items per page (default: 100)
- `offset`: Starting position (default: 0)
- `sort`: Sort field and direction, e.g., `createdAt:desc`

### Status Codes

- `200` Success
- `201` Created
- `400` Bad request
- `401` Unauthorized
- `403` Forbidden
- `404` Not found
- `409` Conflict
- `500` Server error
