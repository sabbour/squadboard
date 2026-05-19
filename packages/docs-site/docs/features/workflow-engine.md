---
title: Workflow engine
description: Durable workflow execution, recovery, retries, and step orchestration.
---

# Workflow engine

The workflow engine owns long-running work and keeps it recoverable.

## Durable runs

- Row-locked stepper so only one executor advances a run at a time.
- Lease and heartbeat liveness for crash recovery.
- Workflow state stored in the local database instead of ephemeral prompts.
- Lifecycle metadata for run state, workspace paths, branch names, and cleanup.

## Step catalog

Common step kinds include:

- `agent_run`
- `peer_review`
- `approve`
- `fan_out`
- `branch`
- `route`
- `retry_wrap`
- `wait_event`
- `wait_timer`
- `github_pr`
- `github_pr_wait_merged`

## Safety behavior

Retries, waits, fan-out, and approvals are deterministic engine behavior. Agents can suggest what should happen next, but the server records and validates the transition.
