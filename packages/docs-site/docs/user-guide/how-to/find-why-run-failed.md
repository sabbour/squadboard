---
title: How to debug a failed run
description: Find out why an agent run failed and what to check first.
---

# How to debug a failed run

An agent run failed. Here's what to check, in order.

## Step 1: Open the run details

Click the card in **In Progress** or **In Review**. The right panel shows the agent run. Look at the **Status** badge:

- **Failed** → Run crashed or hit an error
- **Completed but blocked** → Run finished but needs approval
- **Completed** → Run succeeded (you can still review it)

If the status is **Failed**, continue to step 2.

## Step 2: Check the error message

Scroll down in the run panel. Look for:

- **Model output** — What the model generated (may contain error messages)
- **Tool calls** — Any tools the agent tried to run (check if any failed)
- **Logs** — Execution logs showing where things went wrong

Common causes:
- **Tool not found** — The agent tried to call a tool that isn't available. Check [Built-in Tools](../user-guide/built-ins.mdx).
- **Model error** — The model hit a rate limit or timeout. Wait a few minutes and try again.
- **Permission denied** — The agent doesn't have access to the resource. Check [Security](../user-guide/security.md).
- **Malformed output** — The agent's output didn't match the validation schema. Check the prompt in step 3.

## Step 3: Check the prompt context

In the run panel, find **Prompt received by agent**. This shows:

- **Charter** — The agent's role and instructions
- **Team root** — The repository path
- **Card context** — The card title and body
- **Available tools** — What tools the agent could call

If the prompt is wrong (missing context, wrong team root, outdated charter), fix the issue in **Agents** or **Configuration** and create a new card to retry.

## Step 4: Retry or escalate

- **Retry the work** — Create a new card with the same body and move it to Ready. The system will improve its assignment logic.
- **Fix the agent** — Update the agent's charter or skills in **Agents**, then retry.
- **Manual fallback** — If repeated failures suggest the agent isn't right for the work, do the work manually and mark the card **Done**. Then post in [GitHub Discussions](https://github.com/sabbour/squadboard/discussions) so the team can improve the routing.

## Next steps

- [Key Concepts](../getting-started/key-concepts.md) — Understand agent runs and ceremonies
- [Board and Runs](../user-guide/board-and-runs.mdx) — Full lifecycle of runs
- [Troubleshooting](../reference/troubleshooting.md) — General troubleshooting
