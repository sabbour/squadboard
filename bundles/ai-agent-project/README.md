# AI Agent Project

A Squadboard project template for end-to-end AI agent development.

## What's included

| | |
|---|---|
| **Kanban** | Research → Build → Eval → Done |
| **Agents** | AgentArchitect · PromptEngineer · SafetyReviewer · Evaluator |
| **Ceremonies** | Eval Loop · Safety Review · Prompt Iteration |
| **Skills** | Prompt Engineering · Eval Framework |

## Sync ownership

> **Squadboard DB is the source of truth** for all project state (issues, agents, ceremonies).
> The `.squad/` directory on disk is a *projection* — a read-friendly copy that the CLI writes.
> To push hand-edited disk files back into the DB, run `squad sync` from the project directory.
> The SDK does **not** live-mirror filesystem changes automatically.

## Quick start

1. Apply this template from the Squadboard Apps page or via the CLI:
   ```
   squad bundle apply ./bundles/ai-agent-project/squad-bundle.json
   ```
2. Run Init Mode to re-cast agents with your agent's name and specific capabilities.
3. Add your golden eval dataset to the project and link it from the first issue.
4. Move your first capability card to **Build** — the Eval Loop triggers when it reaches **Eval**.

## Kanban philosophy

| Column | Purpose |
|---|---|
| **Research** | Spike work, literature review, capability scoping |
| **Build** | Active implementation (WIP limit: 3) |
| **Eval** | Automated + human evaluation gate |
| **Done** | Capability shipped and baseline committed |

## Ceremony overview

| Ceremony | Trigger | Purpose |
|---|---|---|
| **Eval Loop** | Issue enters Eval column | Run eval suite → human gate → update baseline |
| **Safety Review** | `safety` label applied | Adversarial testing → safety sign-off |
| **Prompt Iteration** | `prompt` label applied | Author variant → eval → architect approval |

## Routing rules

| Label | Agent | Reason |
|---|---|---|
| `safety` | SafetyReviewer | Safety issues routed first |
| `prompt` | PromptEngineer | Prompt work to the specialist |
| `eval` | Evaluator | Eval tasks to the evaluator |
| `architecture` | AgentArchitect | Design decisions to architect |
| *(anything else)* | AgentArchitect | Architect triages unknowns |
