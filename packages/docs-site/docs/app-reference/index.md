---
title: App Reference
description: Complete reference guide to every page and feature in the Squadboard UI
---

# App Reference

Every page in Squadboard, every tab, every action. This section covers the entire user interface so you can find what you're looking for.

## Navigation Model

Squadboard has two main layers:

**Global pages** (top-left navigation)
- **Project Picker** — Your entry point. Create projects, connect to existing `.squad/` folders, or browse templates.
- **Now** — Global live dashboard. All active sessions, runs, and workflows across every project you have.
- **Inbox** — Review all captured items waiting for action, regardless of project.
- **Apps** — Browse and install Squadboard Apps (pre-built Squad workspaces).
- **Consult** — Workspace for conversations at the global level.
- **Diagnostics** — System health checks.
- **Heartbeat** — View automation sweepers and scheduling across all projects.

**Per-project pages** (accessed from a project board)
- **Dashboard** — Project health snapshot. Throughput, agent stats, workflow performance.
- **Board** — Kanban board with 5 columns (Backlog → Ready → In Progress → In Review → Done). Real-time collaboration.
- **Flow** — Project-wide agent lineage and issue swimlanes.
- **Inbox** — Project-scoped items awaiting action.
- **Agents** — Team roster, routing log, team portability.
- **Skills** — Project skill registry. Browse, create, edit.
- **Tools** — External tool catalog. MCP-backed, editable.
- **MCP Servers** — Registry of connected MCP transports.
- **Consult** — Project-scoped conversation workspace.
- **Costs** — Month-to-date LLM spend.
- **Ceremonies** — Automation workflows. Create, run, review, audit.
- **Templates** — Import/export ceremony, team, and project templates.
- **Settings** — Configuration hub. 10 sections covering everything from display prefs to GitHub integration.
- **Diagnostics** — Project health checks.
- **Heartbeat** — Project-scoped automation sweepers.

## Pages by Category

### Getting Started
- [Project Picker](./project-picker.md) — Create or connect projects
- [Apps](./apps.md) — Browse and install Squad Apps

### Global Dashboards
- [Now](./now.md) — Live activity across all projects
- [Inbox](./inbox.md) — Captured items awaiting action

### Conversation & Automation
- [Consult](./consult.md) — Chat workspace for queries and brainstorming
- [Ceremonies](./ceremonies.md) — Workflows, automation rules, run history

### Project Workspace
- [Dashboard](./dashboard.md) — Project health and metrics
- [Board](./board.md) — Kanban board and card detail drawer
- [Flow](./flow.md) — Agent lineage and issue swimlanes

### Team & Configuration
- [Agents](./agents.md) — Team roster and routing
- [Skills](./skills.md) — Skill registry
- [Tools](./tools.md) — Tool catalog
- [MCP Servers](./mcp-servers.md) — MCP server registry
- [Templates](./templates.md) — Import/export templates
- [Settings](./settings.md) — Project configuration

### Observability
- [Costs](./costs.md) — LLM spend tracking
- [Diagnostics & Heartbeat](./diagnostics-heartbeat.md) — Health checks and automation sweepers

### Deep Dives
- [Live Run Viewer](./live-run-viewer.md) — Real-time run monitoring

## URL Reference

All routes shown below are accessible after login.

### Global routes
- `/` — Project Picker
- `/now` — Now dashboard
- `/inbox` — Global Inbox
- `/apps` — Apps browser
- `/consult/new` — New global conversation
- `/consult/:sessionId` — Continue conversation
- `/diagnostics` — Global diagnostics
- `/heartbeat` — Global heartbeat

### Per-project routes (`/projects/:id/...`)
- `dashboard` — Dashboard
- `board` — Board
- `flow` — Flow (Agents / Issues tabs)
- `inbox` — Project Inbox
- `agents` — Agents (Agents / Routing tabs)
- `skills` — Skills
- `tools` — Tools
- `mcp-servers` — MCP Servers
- `consult/new` — New project conversation
- `consult/:sessionId` — Continue conversation
- `costs` — Costs
- `ceremonies` — Ceremony list
- `ceremonies/new` — Create ceremony
- `ceremonies/:id` — Edit ceremony
- `ceremonies/:id/runs` — Ceremony run history
- `ceremonies/review` — Review drafts
- `ceremonies/audit` — Audit trail
- `ceremonies/templates` — Templates (3 tabs)
- `settings` — Settings (10 sections)
- `diagnostics` — Project diagnostics
- `heartbeat` — Project heartbeat
- `issues/:issueId/runs/:runId/live` — Live run viewer

## Tips for Navigation

**Deep linking**: Many pages accept URL parameters to pre-load content:
- Board: `?openIssue=ISSUE_ID&tab=OVERVIEW|RUNS|OUTPUTS|FLOW`
- Settings: `?section=SECTION_NAME`
- Templates: `?tab=ceremonies|teams|projects`
- CeremonyEditor: `?template=TEMPLATE_ID`

**Realtime features**: Board, Now, and Consult update live as activity happens. Changes from other team members appear immediately.

**Filtering**: Most list pages (Board, Agents, Skills, etc.) support search and category/label filters. Check each page for available filter options.

**Keyboard shortcuts**: Card detail drawer closes with Escape. Most dialogs respond to keyboard navigation with arrow keys and Enter.
