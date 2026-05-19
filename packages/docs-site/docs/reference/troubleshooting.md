---
title: Troubleshooting
description: Common runtime, coordinator, MCP, and automation issues.
---

# Troubleshooting

## MCP tools need a project ID

Set `SQUADBOARD_DEFAULT_PROJECT_ID` in the MCP config environment or pass `projectId` in the tool call.

## The coordinator does not dispatch

Check:

- `COORDINATOR_DISPATCH_ENABLED`
- project agents are active
- parent issues are not blocking
- the issue is not too thin
- routing log entries for deterministic skip or ambiguity

## Ralph is idle

Ralph must be enabled for the project. If enabled, inspect the monitor status route and audit records to see the last decision and next candidate.

## Worktree cleanup did not delete a branch

Cleanup is intentionally conservative. It only removes safe worktrees and safe `squad/*` branches when policy allows.
