---
title: Current alpha limits
description: Current alpha constraints and feature areas that remain intentionally future work.
---

# Current alpha limits

The current alpha focuses on Copilot CLI + Squad coexistence, durable orchestration, and local-first operation. Some capabilities are intentionally constrained until the product has more dogfood evidence and clearer policy controls.

## Current limits

- Ralph can recommend and log follow-up actions for GitHub issues and PRs that were not created by Ready-column pickup. It does not automatically merge PRs or apply fixes yet; those actions still require explicit human approval.
- When two agents look similarly qualified, Squadboard records the selected agent and rationale in routing history so reviewers can audit why the assignment happened.
- Visual workflow editing covers common linear and fan-out authoring, while advanced branching still falls back to YAML.

## Future areas

- Advanced fan-out patterns and dynamic child counts.
- External webhook listener for `wait_event` callbacks.
- Cost-tracking dashboards and burndown charts.
- Agent leaderboard and performance views.
- Cloud backup targets and audit log export.
- Multi-tenant RBAC.
