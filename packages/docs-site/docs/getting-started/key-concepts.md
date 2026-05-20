---
title: Key Concepts
description: The 10 terms you need to understand before Squadboard makes sense.
---

# Key Concepts

These are the core concepts you'll encounter. No jargon, just the vocabulary.

## Board

The kanban board you see on the home page. It has five columns: **Backlog** (ideas), **Ready** (waiting for an agent), **In Progress** (agent is working), **In Review** (needs approval), and **Done** (complete). The board is the visible surface of Squadboard.

## Card (or Issue)

A unit of work on the board. You create a card with a title (the outcome you want) and a body (the context). Cards live in one column at a time and move as work progresses. Every card can have an agent run attached to it.

## Ready Column — The Magic Trigger

The moment you drag a card into **Ready**, Squadboard wakes up. It runs deterministic routing rules, picks the best agent from your team, and starts an agent run. **This is the only step that triggers execution.** There is no separate play button.

## Agent Run

The execution of an agent on a specific card. An agent run has a prompt (with context about the card, your team, and the work), a model output, and any tool calls the agent made. You can inspect the run to see exactly what happened and approve it before it reaches GitHub.

## Ceremony

A workflow that closes out work and records decisions. The most common ceremony is **launch-review**, which summarizes the agent runs you just produced and records the handoff. Ceremonies are how Squadboard captures decision memory into `.squad/decisions/inbox/`.

## Workflow

A sequence of steps that runs deterministically: route → agent_run → approve → close. Workflows are designed to be auditable and repeatable. You design workflows to match your team's process.

## Squad (Upstream)

The Squad CLI tool that Squadboard coexists with. Squad is the orchestrator in your terminal; Squadboard is the board view. They share the same `.squad/` folder and work together.

## MCP (Model Context Protocol)

A protocol that lets you connect Squadboard to other tools like Copilot CLI, VS Code, or custom clients. MCP lets those tools read and write to your board and runs in real time. It's optional — Squadboard works fine without it.

## Storage Provider

Where Squadboard stores data. Two options: **PGlite** (local, zero-config), or **PostgreSQL** (cloud-ready). The storage provider controls both how the board persists and how agents access routing rules. You choose based on your scale and preference.

## Scribe

The part of Squadboard that captures directives (decisions, discussions, approvals) into `.squad/decisions/inbox/`. When a ceremony closes out work, the scribe records what happened so your team has a durable log.

## Next steps

- [What is Squadboard?](./what-is-squadboard.md) — Broader context
- [Quickstart](./quickstart.mdx) — See these concepts in action
- [Board and Runs](../user-guide/board-and-runs.mdx) — Deep dive on board lifecycle
