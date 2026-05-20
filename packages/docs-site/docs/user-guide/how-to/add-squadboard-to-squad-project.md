---
title: How to add Squadboard to a Squad project
description: Bring Squadboard into an existing Squad CLI project and keep both tools working together.
---

# How to add Squadboard to an existing Squad project

You have a Squad CLI project with `.squad/` already. Here's how to add Squadboard without breaking anything.

## Before you start

Squadboard is additive. Your `.squad/` folder stays the source of truth. Squadboard reads it, writes to a shared database, and can coexist peacefully with Squad CLI.

## Step 1: Install and start Squadboard

Follow [Installation](../../getting-started/installation.md):

```bash
git clone https://github.com/sabbour/squadboard.git
cd squadboard
pnpm install
pnpm run dev
```

Open `http://localhost:5173`. Squadboard is now running.

## Step 2: Create a project in Squadboard

Click **Projects** → **New Project**. Point it at your Squad repository folder. When you click **Create**, Squadboard will:

1. Read your existing `.squad/` folder
2. Import your team, agents, and workflows
3. Create a durable board state (either PGlite locally or PostgreSQL)

Your `.squad/` folder is unchanged.

## Step 3: Confirm your team

Go to **Agents**. You should see your Squad team roster. If the roles look right, you're ready. If a role is missing or unclear, click **Cast Team** and accept the proposal.

Squadboard uses these roles to route work automatically. Garbage in, garbage out — five minutes fixing roles here saves bad assignments later.

## Step 4: Connect MCP (optional but recommended)

If you use Copilot CLI or VS Code, connect Squadboard's MCP server so those tools can read/write the board:

In your Copilot CLI or IDE config, add the Squadboard MCP server and pass:
```
SQUADBOARD_DEFAULT_PROJECT_ID=<your-project-id>
```

You can find the project ID in Squadboard under **Configuration** → **Copy Project ID**.

See [MCP Integration](../../user-guide/mcp.mdx) for full details.

## Step 5: Create a card and move it to Ready

Go to **Board**. Create a test card:

```
Title: Test Squadboard pickup

Body:
This is a test card to confirm the board can route to agents.
Link any successful output when done.
```

Drag it to **Ready**. Squadboard will pick an agent and run. You now have a durable board that coexists with Squad CLI.

## What happens next

- **Your `.squad/` folder keeps working** — Squad CLI reads and writes it; so does Squadboard. No conflicts.
- **Runs get recorded** — Every agent run on the board is stored durably, not lost when the chat session ends.
- **You can close loops** — Use Ceremonies to summarize work and record decisions in `.squad/decisions/inbox/`.

## Next steps

- [Squad Integration](../../user-guide/squad-integration.mdx) — Deep dive on how Squadboard and Squad coexist
- [Quickstart](../../getting-started/quickstart.mdx) — Full workflow walkthrough
- [Key Concepts](../../getting-started/key-concepts.md) — Understand board, cards, and runs
