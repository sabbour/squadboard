---
title: Agents
description: Team roster, routing configuration, and team portability
---

# Agents

**Route:** `/projects/:id/agents`

Manage your team of agents. View the roster, configure routing, test routing logic, and manage team portability (export/import/save as template).

## Overview

Agents tab shows your team roster. Routing tab shows routing history, stats, and a test panel.

## Agents Tab

### Team Roster
Grid view of all agents in your project team:
- Agent name
- Role/type
- Skills (brief)
- Status (active/inactive)
- Last activity
- Agent avatar or icon

### Agent Detail Panel
Click any agent to open detail view:
- Full profile: name, description, backstory
- Skills list (what it can do)
- Tools it has access to
- Model preference
- Performance stats (runs, success rate)

**Actions on agent:**
- **Edit agent** — Modify name, description, or config
- **Delete agent** — Remove from team (archived)

### Add Agent to Team
**Hire Agent button:**
- Pre-built agent gallery (if available)
- Agent name and role
- Skills selection
- Model preference
- Custom backstory/system prompt

**Actions:**
- Search pre-built agents by name or skill
- Add selected agent to team

### Team Portability

**Export team**
- Click "Export team" button
- Downloads team roster as `.json` file
- Includes all agent configs (name, skills, backstory, etc.)
- Portable: can import into another project

**Import team**
- Click "Import team" button
- Upload previously exported `.json` file
- Replaces current team roster with imported team
- **Warning:** Existing team is overwritten; confirm before importing

**Save team as template**
- Click "Save as template" button
- Team becomes a reusable template in [Templates](./templates.md)
- Can apply this template to other projects later
- Named for easy reference

## Routing Tab

### Casting (Testing)
**Cast team or agent** — Test how an issue would be routed given a prompt:
- Enter test prompt or issue title
- Choose cast mode: full team routing vs. specific agent
- See which agent(s) would handle this work

**Dev-only test panel:**
- Detailed routing diagnostics (debugging info, classifier scores)
- Only visible in development mode; not in production

### Routing Stats
Aggregated routing metrics:
- Total issues routed
- Success rate by agent
- Average routing latency
- Routing tier breakdown

Shows confidence distribution: high/medium/low confidence routing decisions.

### Routing Log
Chronological log of all routing decisions. Shows per decision:
- Issue ID and title
- Selected agent
- Confidence score
- Reasoning/context
- Timestamp

**Actions:**
- Filter by agent or result
- Click to see full routing context
- Retry/re-evaluate specific routes (dev-only)

### Refresh Keywords
Update agent skill keywords and descriptions. Used by router to match issues to agents.

**Actions:**
- Click "Refresh keywords" to recompute routing model
- Takes a few seconds; routing log updates afterward

## Actions

### Agent Management

**Edit agent**
- Click agent card
- Modify name, description, backstory, skills, model
- Save changes

**Delete agent**
- Click delete icon on agent card
- Agent is archived (soft deleted); can be restored

**Add agent**
- Click "Hire Agent" button
- Search and select from available agents
- Add to team

### Team Portability

**Export**
- Click "Export team" button to download `.json`

**Import**
- Click "Import team" button to upload `.json`
- Replaces current team (confirm before proceeding)

**Save template**
- Click "Save team as template" button
- Team becomes reusable template

### Routing Testing

**Cast team**
- Enter prompt in test panel
- Click "Cast team" to see routing decision
- Shows selected agent and confidence

**Cast agent**
- Select specific agent from dropdown
- Click "Cast agent" to test single-agent routing
- Shows if agent would accept this work

**Refresh keywords**
- Click "Refresh keywords" button
- Recomputes router skill-matching model

## Related

- [Skills](./skills.md) — Define skills agents can use
- [Tools](./tools.md) — External tools agents can invoke
- [Board](./board.md) — See agents in action routing cards
- [Ceremonies](./ceremonies.md) — Configure workflow-specific routing
- [Flow](./flow.md) — Visualize agent lineage and dependencies
