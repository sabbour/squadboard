# Demo 3 — Squad Onboarding

> **Status:** 🔴 Not started  
> **Layer:** Foundation  
> **Estimated session:** ~7 minutes to run through

## What this demo shows

Discover Squad agents from your `.squad/agents/` directory, hire (assign) an agent to the project, edit agent config inline, and disable an agent without deleting it.

## Prerequisites

- Demo 1 complete
- `npx @sabbour/squadboard up` running
- At least one Squad agent script in `.squad/agents/` (e.g., `.squad/agents/researcher.md`)

## Run it

```bash
# Step 1: Navigate to the Agents tab in Squadboard
# Click on Settings → Agents

# Step 2: Click "Discover Agents"
# Squadboard scans `.squad/agents/` and lists all agents with their charters

# Step 3: Hire an agent
# Click the "+" button next to an agent to assign it to your project

# Step 4: Edit agent config
# Click the agent name, toggle its status (enabled/disabled), adjust parameters

# Step 5: Disable an agent
# Uncheck the "enabled" checkbox (doesn't delete the `.md` file)
```

## What to observe

- Agents are discovered automatically from `.squad/agents/`
- Agent charters and metadata are parsed and displayed
- You can hire multiple agents to one project
- Disabling an agent removes it from assignments without deletion
- Changes persist to the project's `.squad/` directory

## Known gaps (hacking phase)

> Agent editing UX (inline parameter forms) is TBD. Currently read-only discovery only.

---
*Auto-generated stub. Last updated: 2026-05-14. Update when demo ships.*
