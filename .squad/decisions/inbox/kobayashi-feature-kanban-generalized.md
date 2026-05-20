# Kobayashi — Feature Kanban generalized

- **Date:** 2026-05-20T04:16:33.702-07:00
- **Status:** Proposed implementation contract
- **Owner:** Kobayashi

## Decision

The visible built-in Project Template catalog is curated to four selectable project types: Content Creation, Open Source, Research Spike, and Feature Kanban.

Feature Kanban replaces the old domain-specific feature app with a generic product/PM workflow. Its canonical id is `feature-kanban`, and it must not carry AKS, Azure, Kubernetes, Microsoft-internal, or internal-tool assumptions.

## Rationale

Users need a lightweight set of broadly useful project starters. Feature Kanban should support customer research, PRD creation, prototype creation, feature naming, release-note/disclosure writing, and feature documentation without binding the workflow to any single product domain.

## Implementation contract

- Keep generalized skills bundled with Feature Kanban so they are reusable and installable with the template.
- Wire ceremonies and agent-run prompts to invoke those skills by key.
- Do not include provider-specific tools or MCP servers in Feature Kanban.
- Keep Content Creation intentionally short and obvious.
