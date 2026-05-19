---
title: Contributing docs
description: How to edit and validate the Docusaurus docs site.
---

# Contributing docs

## Edit docs

Docs site pages live in `packages/docs-site/docs`.

Use this command for local development:

```bash
pnpm docs:dev
```

## Build docs

```bash
pnpm docs:build
```

The build runs `scripts/generate-llms.mjs` first, then Docusaurus.

## LLM entry points

Generated files live under `packages/docs-site/static`:

- `llms.txt`
- `llms-full.txt`

Do not edit generated files by hand. Edit the docs pages and rerun the generator.

## Writing style

- Prefer task-oriented pages over architecture essays.
- State defaults and safety boundaries.
- Keep limitations explicit.
- Link to the nearest runnable command when possible.
- Avoid copying external docs. Use external docs only as information-architecture references.

## Validation checklist

```bash
pnpm docs:build
git diff --check
```
