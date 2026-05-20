# Open Source Project

A Squadboard project template for community-driven open source software.

## What's included

| | |
|---|---|
| **Kanban** | Triage → Backlog → In Progress → In Review → Done |
| **Agents** | Maintainer · Contributor · Reviewer · Triage |
| **Ceremonies** | PR Review · Issue Triage · Release Cut |
| **Skills** | Semantic Versioning · OSS Contribution workflow |

## Sync ownership

> **Squadboard DB is the source of truth** for all project state (issues, agents, ceremonies).
> The `.squad/` directory on disk is a *projection* — a read-friendly copy that the CLI writes.
> To push hand-edited disk files back into the DB, run `squad sync` from the project directory.
> The SDK does **not** live-mirror filesystem changes automatically.

## Quick start

1. Apply this template from the Squadboard Apps page or via the CLI:
   ```
   squad bundle apply ./bundles/open-source-project/squad-bundle.json
   ```
2. Run Init Mode on the project to re-cast agents with project-specific names and charters.
3. Connect your GitHub repository in Project → Settings → GitHub Sync.
4. Triage your first issues — they'll land in the **Triage** column automatically.

## Ceremony overview

| Ceremony | Trigger | Purpose |
|---|---|---|
| **Issue Triage** | Issue enters Triage column | Classify, label, and route incoming issues |
| **PR Review** | Issue enters In Review column | Reviewer gate → Maintainer merge approval |
| **Release Cut** | Manual | Changelog → SemVer proposal → Maintainer sign-off |

## Routing rules

| Label | Agent | Reason |
|---|---|---|
| `bug` | Triage | All bugs triaged first |
| `enhancement` | Maintainer | Scope before assigning |
| `good-first-issue` | Contributor | Direct to contributor |
| `review` | Reviewer | Code review queue |
| *(anything else)* | Maintainer | Maintainer triages unknowns |
