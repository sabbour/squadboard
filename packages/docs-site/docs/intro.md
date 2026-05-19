---
id: intro
slug: /
title: Squadboard documentation
description: Start here for installation, quick links, and a map of the Squadboard docs.
---

# Squadboard documentation

Squadboard is a local-first workflow board for running multi-agent work with deterministic orchestration. It gives a [Squad](https://github.com/bradygaster/squad)-style team a durable board, auditable routing, real-time run visibility, and coexistence surfaces for Copilot CLI workflows.

The product shape is simple: bring in a team, delegate Ready work, approve risky steps, and watch the inner loop happen before the work needs to reach GitHub.

## Install

```bash
git clone https://github.com/sabbour/squadboard.git
cd squadboard
pnpm install
pnpm run dev
```

Open `http://localhost:5173` for the app. The backend runs on `http://localhost:3000`.

## What is Squadboard?

Squadboard is not just a kanban board and not just an agent runner. It is the system of record for multi-agent work:

- Cards, labels, parent links, and run history live in a local database.
- Ready-column pickup lets agents start work before a GitHub issue or PR exists.
- Deterministic prefilters own concrete routing decisions before an LLM is asked for semantic judgment.
- Agents run with a rich spawn prompt: charter, team root, requester, workspace, skills, MCP context, and validation expectations.
- Scribe close-out, directive capture, ceremonies, worktree cleanup, and Ralph-style monitoring are auditable server actions.

## Quick links

| Topic | Where to start |
| --- | --- |
| Install locally | [Installation](./getting-started/installation.md) |
| Run the first loop | [Quickstart](./getting-started/quickstart.mdx) |
| Pick a path through the docs | [Learning Path](./getting-started/learning-path.md) |
| Browse product capabilities | [Features](./features/overview.mdx) |
| Configure projects and runtime | [Configuration](./user-guide/configuration.mdx) |
| Use with Copilot CLI + Squad | [Copilot CLI + Squad coexistence](./user-guide/copilot-squad-coexistence.md) |
| Understand upstream Squad | [Squad Integration](./user-guide/squad-integration.mdx) |
| Understand PostgreSQL StorageProvider | [Storage Provider Alignment](./user-guide/storage-provider.mdx) |
| Map tools and hooks | [Squad Tools and Hooks](./user-guide/squad-tools-hooks.mdx) |
| Import Squad Apps and templates | [Squad Apps](./user-guide/squad-apps.mdx) |
| Use ceremonies and workflows | [Ceremonies and Workflows](./user-guide/ceremonies-workflows.md) |
| Connect MCP clients | [MCP Integration](./user-guide/mcp.mdx) |
| Sync with GitHub | [GitHub Integration](./user-guide/github.md) |
| See the architecture | [Architecture](./developer-guide/architecture.md) |
| Troubleshoot | [Troubleshooting](./reference/troubleshooting.md) |

## Feature areas

The [Features](./features/overview.mdx) section has subsections for core orchestration, automation, integrations, and operations:

- **Durable workflow engine** - lease and heartbeat liveness, deterministic stepper, retries, fan-out, branches, waits, approvals, and output validation.
- **Copilot CLI + Squad coexistence** - shared coordinator input, deterministic preflight rules, circuit-breaker visibility, confidence post-processing, and LLM fallback only for ambiguity.
- **Agent workspace isolation** - scratch, directory, or git worktree strategies keep parallel work from colliding.
- **Scribe and directive memory** - capture directives into `.squad/decisions/inbox/` and run close-out through daemon/coordinator lifecycle automation.
- **Opt-in Ralph monitor** - prioritize untriaged issues, member-label pickup, assigned work, CI/review states, approved PRs, and drafts.
- **MCP surface** - expose board, run, capture, routing, and project operations to Copilot CLI, VS Code, and HTTP clients.
- **Squad Apps and imports** - package teams, ceremonies, skills, MCP config, routing, and seed issues into portable project artifacts.

## For LLMs and coding agents

Machine-readable entry points are generated before every docs build:

- `/docs/llms.txt` - curated index of doc pages and descriptions.
- `/docs/llms-full.txt` - all docs pages concatenated into one markdown file.
