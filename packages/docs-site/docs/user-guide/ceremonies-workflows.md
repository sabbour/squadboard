---
title: Ceremonies and workflows
description: Author, trigger, run, automate close-out, and audit ceremonies.
---

# Ceremonies and workflows

## Mental model

A ceremony is a named process. A workflow is the step graph that runs inside it.

```text
Ceremony
  trigger: explicit run, cron, GitHub event, or agent signal
  workflow: versioned steps
  metadata: owner, status, origin
```

## Trigger types

| Trigger | Use |
| --- | --- |
| `manual` | User explicitly runs a ceremony |
| `cron` | Scheduled recurring work |
| `github-event` | GitHub issue, PR, push, or comment event |
| `agent-signal` | Lifecycle event such as before/after batch |

## Step kinds

Common workflow steps include:

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

## Visual designer status

The visual ceremony designer covers common authoring flows: linear steps, route-to-agent runs, approval gates, and adding child steps under fan-out nodes. It is not fully done for every workflow shape. Advanced branching, dynamic fan-out counts, nested retry wrappers, and complex external `wait_event` callbacks still require YAML review.

The safe authoring loop is:

1. Draft or import the ceremony.
2. Use the visual designer for common changes.
3. Inspect the generated YAML before deploying.
4. Test with non-production cards before enabling schedules or automation.

## Automated close-out

Scribe close-out is triggered by daemon and coordinator lifecycle paths rather than a separate user button. Close-out responses can include:

- current run ID
- worktree path
- branch
- started and ended timestamps
- close-out report path
- health path
- cleanup status

## YAML

Ceremonies can be exported and imported as canonical YAML. Keep executable ceremony YAML in `.squad/ceremonies/` when you want it versioned with the project.
