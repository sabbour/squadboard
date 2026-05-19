---
title: FAQ
description: Frequently asked questions about Squadboard.
---

# FAQ

## Is Squadboard a replacement for Copilot CLI or Squad?

No. Squadboard is the durable orchestration layer. Copilot CLI and upstream [Squad](https://github.com/bradygaster/squad) can still be the interactive driver surface.

## How does Squadboard coexist with Copilot CLI and Squad?

Squadboard keeps Copilot CLI and upstream [Squad](https://github.com/bradygaster/squad) useful as interactive driver surfaces, while Squadboard stores the durable state: cards, routing decisions, run history, imported `.squad/` context, ceremonies, MCP tools, and audit records.

## Is Squadboard production-ready?

No. Squadboard is alpha software. Expect breaking changes, incomplete flows, and areas that still need validation. Keep human review in the loop.

## Is Ralph enabled by default?

No. Ralph monitor is opt-in per project.

## Does Ralph require GitHub?

No. Squadboard's Ralph-equivalent monitor is board-first. It looks at cards in the Ready semantic column and can dispatch assigned work there. GitHub signals such as CI failures, review feedback, and draft PRs are additional inputs when GitHub sync is configured.

## Is visual ceremony design done?

Not fully. The visual designer covers common linear flows, route/agent/approval steps, and fan-out child authoring. Advanced branching, dynamic fan-out, nested retry wrappers, and unusual external wait-event patterns still require YAML review in the alpha.

## Can Squadboard be a Squad StorageProvider through PostgreSQL?

Yes. Squadboard now defaults to a **PostgreSQL-backed StorageProvider adapter** that stores Squad state (agents, decisions, skills, etc.) in the same PostgreSQL database that Squadboard uses for product state. Multiple compatible processes can share the same database when pointing to the same PostgreSQL instance.

**Quick start:**
```bash
pnpm run dev
```

This uses the embedded PostgreSQL database (PGlite) by default—no external setup needed. Squadboard will import any existing `.squad/` files into the database on startup (one-time import).

**Using the CLI:**
```bash
squadboard start --squad-storage postgresql
# or use the alias:
squadboard start --postgresql-storage
```

**Filesystem fallback:**
```bash
pnpm run dev:fs
squadboard start --squad-storage fs
```

**Configure Copilot CLI / `squad.agent.md` through MCP:**
```bash
squadboard init --write-mcp-config
```

This writes a `.copilot/mcp-config.json` entry that starts `squadboard mcp` with PostgreSQL-backed Squad state. Stock Copilot CLI and `squad.agent.md` should use the Squadboard MCP bridge for shared state unless the upstream CLI has a documented direct PostgreSQL provider configuration.

**For shared multi-process setup with external PostgreSQL:**
```bash
DATABASE_URL=postgresql://user:password@host:port/squadboard pnpm run dev
```

**Important boundary:** Squad CLI or Copilot CLI agents configured to use PostgreSQL can see the shared state **only if they point to the same `DATABASE_URL`** and have a compatible StorageProvider implementation. External agents using filesystem `.squad/` files cannot directly access the database without an explicit configuration change or MCP bridge. 

If external agents need to see state, you must explicitly export it back to `.squad/` files in Git, or route them through Squadboard's MCP bridge.

**Configuration options:**
- **Squadboard + Squad/Copilot (direct DB):** Both point to `DATABASE_URL` and use a compatible, documented upstream PostgreSQL StorageProvider config. The Squad SDK supports provider injection, but a separate CLI must expose a config surface before Squadboard can force it.
- **Squadboard + stock Copilot CLI (MCP mode):** Copilot CLI calls Squadboard MCP tools instead of direct DB access (no upstream StorageProvider needed). This is the **portable choice**.

See [Storage provider — Configuration recipes](../user-guide/storage-provider.mdx#configuration-recipes-for-shared-storage) for concrete examples.

## Are Squadboard MCP tools registered as Squad tools?

Today they are MCP tools exposed by Squadboard. When embedding them into upstream Squad, they should be registered as a `squadboard` tool bundle so Squad's hook pipeline can apply policy before write tools run.

## Does every directive become a board card?

No. Issue-like directives can become cards. Decision or memory directives can be captured into `.squad/decisions/inbox/`.

## What are Squad Apps?

Squad Apps are installable project packages. They can include project metadata, board columns, team members, ceremonies, workflows, skills, tools, MCP server recipes, routing rules, seed issues, and README content.

## Where do docs live?

The Docusaurus docs site lives in `packages/docs-site`. The repository also contains internal planning and product docs under the root `docs/` directory.

## How are LLM docs generated?

`pnpm --filter @sabbour/squadboard-docs generate:llms` scans the Docusaurus docs and writes `static/llms.txt` plus `static/llms-full.txt`.
