# Squadboard Documentation

Find everything you need in <30 seconds.

## Getting Started

New to Squadboard? Start here:

- **[Getting Started with Squadboard (for Squad users)](./setup/getting-started-from-squad.md)** — Add Squadboard to your Squad CLI workflow without changing anything. Zero-config local board or cloud PostgreSQL.
- **[MCP Installation & Configuration](./setup/mcp-install.md)** — Wire Squadboard MCP into Copilot CLI or VS Code. Storage providers, project discovery, and troubleshooting.

## API Reference

Integrate with Squadboard programmatically:

- **[REST API Reference](./api-reference.md)** — 129 endpoints across Projects, Agents, Issues, Runs, Workflows, Ceremonies, and more
- **[WebSocket Protocol](./websocket-protocol.md)** — Real-time events, presence, consult (chat), 15-min buffer replay, and heartbeat

## Ceremonies & Workflows

Design and run workflow automations:

- **[Ceremonies](./ceremonies/)** — Authoring guide, lifecycle, triggers, and YAML schema reference
- **[Concepts: Ceremonies & Workflows](./concepts/ceremonies.md)** — Mental model for triggers, steps, and multi-user coordination

## Core Concepts

Understand Squadboard's design:

- **[Dogfood Loop](./concepts/dogfood-loop.md)** — How directives, routing, agent runs, GitHub events, and Scribe closeout feed the next wave
- **[Squad Apps & Templates](./concepts/squad-apps-and-templates.md)** — Squad Apps implementation map and comparison with project/team/workflow templates

## Product Documentation

Internal reference for the Squadboard team:

- **[Product Requirements Document (PRD)](./prd.md)** — Executive vision, user personas, and success metrics
- **[Feature Inventory](./features.md)** — Current features, driver-parity surfaces, and known limits
- **[Features (detailed)](./features/)** — Individual feature specs and acceptance criteria
- **[Bugs (open)](./bugs/)** — Known issues, reproduction steps, and severity
- **[Chores (tasks)](./chores/)** — Housekeeping, refactors, dependency updates, and tooling
- **[Demos](./demos/)** — Demo scripts and acceptance notes for vertical slices
- **[Review Policy](./review-policy.md)** — Code review and PR guidelines

## Specification

Deep technical dives:

- **[SquadApp Spec](./squadapp-spec.md)** — SquadApp manifest, plugin system, and integration patterns
- **[Cross-Surface Squad Sync Contract](./setup/cross-surface-squad-sync-contract.md)** — Data flow and sync guarantees between Squadboard and Squad CLI
- **[Cross-Surface Sync Implementation Plan](./setup/cross-surface-sync-implementation-plan.md)** — Detailed implementation roadmap

## Release & Quality

Before shipping:

- **[Release Readiness](./RELEASE-READINESS.md)** — Pre-release validation, publishing steps, and rollback procedures
- **[Acceptance Criteria](./acceptance-criteria.md)** — Feature sign-off checklist

