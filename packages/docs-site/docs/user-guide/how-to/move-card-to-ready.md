---
title: How to trigger an agent run
description: Move a card to Ready and watch Squadboard pick it up automatically.
---

# How to trigger an agent run in 3 steps

The most common action in Squadboard: create a card, move it to Ready, and let an agent take it.

## Step 1: Create a card on the Board

Open your project and go to **Board**. Click **Create issue** and fill in:

- **Title:** The concrete outcome you want. Example: "Write an onboarding guide for new users"
- **Body:** Context about why this matters and what evidence to link when done. Example:
  ```
  New users don't understand how Squadboard relates to Squad CLI.
  Write a short guide explaining both and link it in the docs when done.
  ```

Click **Save**. The card lands in **Backlog**.

## Step 2: Move the card to Ready

Drag the card from **Backlog** into **Ready**. This is the trigger.

When the card enters Ready:
1. Squadboard runs deterministic routing gates
2. Picks the best agent from your team roster
3. Starts an agent run
4. The card moves into **In Progress** (you don't drag it; the system does)

No separate play button. The column move is the execution trigger.

## Step 3: Inspect the run

Click the card. The right panel shows the agent run:

- Which agent picked it up
- The prompt it received
- The model's output
- Any tool calls it made

If the wrong agent was assigned, don't override it by hand. Instead, fix the role or charter in **Agents** (the assignment logic will improve next time).

## Next steps

- [Key Concepts](../../getting-started/key-concepts.md) — Understand Ready column and agent runs
- [Quickstart](../../getting-started/quickstart.mdx) — Full workflow walkthrough
- [Board and Runs](../../user-guide/board-and-runs.mdx) — Deep dive on pickup and run lifecycle
