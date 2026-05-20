---
title: What is Squadboard?
description: The 90-second explanation of what Squadboard is and how it fits with Squad CLI.
---

# What is Squadboard?

Squadboard is a local-first workflow board for running multi-agent work.

## The one-line version

You bring a team, capture work as cards, move cards to **Ready**, and watch agents pick them up automatically — all before the work reaches GitHub.

## How it fits with Squad CLI

**Squad CLI** is the brain in your terminal — it orchestrates agents, runs tools, captures decisions. **Squadboard** is the board that shows what the brain is doing. They coexist peacefully:

- Squad CLI runs agents via the command line or as scheduled daemons
- Squadboard is a UI that watches those runs, shows you the board, and lets you move cards
- Both read and write to the same `.squad/` folder
- You can use Squadboard without Squad CLI; you can use Squad CLI without Squadboard. Both are stronger together.

## What you can do with it

- **Capture work** — Turn ideas into cards. Add context, labels, and links.
- **Delegate automatically** — Move a card to Ready, and the right agent picks it up without you clicking a button.
- **Inspect runs** — See which agent took the work, what prompt it got, and what it produced.
- **Approve risky steps** — Some runs need human review before they touch GitHub. Squadboard shows you which ones.
- **Close loops** — Run ceremonies to summarize work, record decisions, and prepare the handoff to the team.

## What it is NOT

- **Not a replacement for Squad CLI.** Squad CLI is still the engine. Squadboard is the dashboard.
- **Not a cloud service.** Everything runs locally. Your data stays on your machine.
- **Not an AI itself.** Squadboard doesn't make decisions. It runs the agents you configure and shows you what they do.

## The data model in 30 seconds

**Cards** live on the board in columns: Backlog → Ready → In Progress → In Review → Done. When you move a card to Ready, Squadboard runs deterministic gates, picks the best **Agent** from your team, and starts an **Agent Run**. The run produces output, which you inspect and approve. Then you close the loop in a **Ceremony**.

## Next steps

- [Quickstart](./quickstart.mdx) — Get running in 10 minutes
- [Key Concepts](./key-concepts.md) — Learn the vocabulary
- [Learning Path](./learning-path.md) — Pick a path through the docs
