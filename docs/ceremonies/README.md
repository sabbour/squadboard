# Squadboard Ceremonies — Documentation

Ceremonies are reusable, declarative workflows in Squadboard that run when a trigger fires (GitHub event, manual run, scheduled cron, or agent signal).

## Quick start

- See [lifecycle.md](./lifecycle.md) for the full spec → authoring → execution flow.
- See [yaml-reference.md](./yaml-reference.md) for the `.workflow.yaml` schema.
- See [triggers.md](./triggers.md) for the four trigger types and their filters.
- See [authoring.md](./authoring.md) for visual editor vs YAML authoring.

## Built-in ceremonies (auto-seeded on new project)

- **design-review** — triggers on PRs touching design.md
- **retrospective** — manual weekly wave summary
- **retro-enforcement** — retrospective + rule enforcement sweep

## Origin badges (provenance)

Every ceremony has an origin: `built-in`, `user-created`, `conjure-llm`, or `yaml-import`.
See [authoring.md#origin-badges](./authoring.md#origin-badges) for what each means and how they are derived.

## For more context

- Read [docs/concepts/ceremonies.md](../concepts/ceremonies.md) for the high-level mental model and workflow step catalogue.
- Read [.squad/research/ceremonies-md-vs-runtime.md](../../.squad/research/ceremonies-md-vs-runtime.md) for the relationship between human-readable ceremony specs and the runtime layer.
