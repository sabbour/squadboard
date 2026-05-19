---
title: Copilot CLI + Squad coexistence
description: How Squadboard coexists with Copilot CLI and upstream Squad through deterministic orchestration.
---

# Copilot CLI + Squad coexistence

Coexistence means Squadboard should preserve the useful parts of the current Copilot CLI + [Squad](https://github.com/bradygaster/squad) driver loop while moving long-lived state into a product surface. The right agent still gets context, work is still routed consistently, directives are still captured, close-out still runs, and project state remains inspectable after the chat session ends.

Squadboard does **not** try to clone every chat interaction byte-for-byte. It moves durable control flow into the server while keeping the LLM where it helps most: interpreting ambiguity.

## Architecture model

1. **Deterministic preflight** owns data plumbing, dependencies, availability, lockouts, circuit breakers, and thin-issue checks.
2. **Bounded LLM judgment** handles semantic ambiguity, charter interpretation, role fit, and summarization.
3. **Deterministic post-processing** validates schema, enforces confidence floors, normalizes decisions, and writes audit output.
4. **Durable orchestration** owns sweeps, GitHub events, Scribe close-out, worktree cleanup, health reporting, and UI controls.

## What Squadboard mirrors from Squad

| Squad driver behavior | Squadboard deterministic equivalent |
| --- | --- |
| Read `.squad/` team conventions | Sync project agents, charters, routing, ceremonies, and skills from project state |
| Decide who should work | Build shared coordinator input, apply deterministic prefilters, then use bounded LLM routing only for ambiguity |
| Spawn an agent with context | Build a spawn prompt with charter, team root, requester, workspace mode/path, history, decisions, skills, MCP context, and validation expectations |
| Capture coordinator directives | Write idempotent entries to the project inbox and `.squad/decisions/inbox/` |
| Run Scribe close-out | Use the server Scribe close-out service from daemon/coordinator lifecycle signals |
| Keep working through Ralph | Use opt-in Ralph monitor decisions and audit records rather than silent background action |

## Coordinator input

The shared coordinator input builder includes:

- issue labels and priority
- `issue_links` parent lineage and blocked parent state
- project rules and routing configuration
- agent charter expertise, cached keywords, and focus areas
- recent run and availability state

Deterministic prefilters cover named-agent requests, blocked parents, human-only operations, all-agents-busy ambiguity, backlog no-match gates, thin issues, and circuit-breaker skip decisions.

## Human-only operations

A human-only operation is work the coordinator must not assign to an agent automatically because it touches high-trust project controls. Current examples include publishing authentication changes, code signing, billing configuration, and organization-level secret rotation. Squadboard leaves those cards queued with a visible skip reason so a project owner can decide what to do next.

## Current alpha limits

- Ralph can recommend and log follow-up actions for GitHub issues and PRs that were not created by Ready-column pickup. It does not automatically merge PRs or apply fixes yet; those actions still require explicit human approval.
- When two agents look similarly qualified, Squadboard records the selected agent and rationale in routing history so reviewers can audit why the assignment happened.

See [Squad integration](./squad-integration.mdx) for the boundary between upstream Squad and Squadboard.
