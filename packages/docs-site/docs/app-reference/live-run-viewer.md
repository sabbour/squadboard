---
title: Live Run Viewer
description: Monitor real-time agent run execution
---

# Live Run Viewer

**Route:** `/projects/:projectId/issues/:issueId/runs/:runId/live`

Watch agent runs execute in real time. See the exact moment an agent thinks, calls tools, and produces output.

## Overview

Live Run Viewer shows a live stream of events as an agent processes a card. Use it to:
- Debug agent behavior
- See tool invocations in real time
- Monitor token usage and cost
- Troubleshoot failures
- Understand agent reasoning

## How to Get Here

From any of these pages, click a run to open Live Run Viewer:
- **Board → Card Detail → Runs tab** — Click a run
- **Now dashboard → Issue Runs** — Click a run
- **Ceremonies → Run history** — Click a run
- **Dashboard → Recent runs** — Click a run

Or navigate directly with the URL above.

## Page Sections

### Header

Shows run context:
- **Issue title** — The card/work item being processed
- **Agent name** — Which agent is running
- **Status badge** — Running, completed, failed, etc.
- **Timestamp** — When run started
- **Close button** — Exit Live Run Viewer

### Metrics Row

Real-time counters (update as run progresses):
- **Elapsed time** — How long run has been executing
- **Input tokens** — Tokens sent to model
- **Output tokens** — Tokens received from model
- **Total tokens** — Input + output
- **Cost** — USD spent on this run so far
- **Turns** — Number of back-and-forth interactions with model

### Connection Status

If run is live:
- Green indicator: "Connected"
- Shows real-time events streaming

If connection lost:
- Yellow indicator: "Reconnecting…"
- Waiting to resume event stream
- Auto-retries every few seconds

If run completed or failed:
- Gray indicator: "Finished"
- Event stream is complete

### Event Stream

Chronological log of everything that happened during the run:

**Event types you'll see:**

1. **Agent started** — Run initialized
2. **Prompt sent** — Full system prompt + user message sent to model
3. **Model response** — Model's reply (streamed, shows as it arrives)
4. **Tool invocation** — Agent called a tool (name, input params shown)
5. **Tool result** — Tool output returned to agent
6. **Agent thinking** — Optional reasoning/thought process
7. **Run completed** — Success with final output
8. **Run failed** — Error occurred; reason shown

Each event shows:
- Timestamp
- Event type (icon)
- Short description
- Full details (expandable)

### Error Recovery Panel

If run failed:
- **Error type** — What went wrong (e.g., "Tool not found", "Model error", "Permission denied")
- **Error message** — Human-readable explanation
- **Remediation** — Suggested fixes (e.g., "Check tool config" or "Re-check authentication")

**Actions:**
- **Retrigger run** — Click to run the same card again with current agent config
- **Retry stream** — Re-attempt to read event log (if connection issue)

### Steer Bar (While Live)

If run is still executing, bottom bar shows:

**Send steering message:**
- Text input field
- Send button
- Used to guide agent (e.g., "Try a different approach" or "Check the error log")

Available only while run is actively executing. After completion, steer bar disappears.

## Actions

**Retrigger run**
- Click "Retrigger" button to run the same card again
- New run will be created; you'll be redirected to new Live Run Viewer

**Retry stream**
- If events stop arriving but run is still processing
- Click "Retry stream" to reconnect to event feed

**Open work item**
- Click "Open work item" breadcrumb
- Jumps to [Board](./board.md) with card detail open

**View run history**
- Click "Runs" link
- Opens [Ceremony Runs](./ceremonies.md#ceremony-runs) or Board card runs history

**Navigate to board**
- Click "Back to board" or project badge
- Returns to [Board](./board.md) view

**Navigate to project**
- Click project name
- Opens [Dashboard](./dashboard.md)

## Tips

**Watch for slow steps** — If any step takes much longer than expected, that's where to investigate. Click to expand and see full context.

**Monitor token usage** — Real-time token counter shows efficiency. High tokens = high cost.

**Tool invocation details** — Expand tool events to see exactly what parameters were passed and what was returned. Useful for debugging.

**Error context** — If run fails, the error panel provides remediation hints. Most common issues are tool configuration or authentication.

**Streaming responses** — Model output streams as it's generated; you see it in real time as LLM produces tokens.

## Troubleshooting

**"Reconnecting…" banner is stuck**
- Run may have timed out or server connection dropped
- Click "Retry stream" to attempt reconnection
- If still stuck, close and refresh the page

**Events seem incomplete**
- WebSocket may have dropped mid-run
- Scroll to end of event log to see latest events
- Close and reopen to refresh

**Metrics not updating**
- Stale data; refresh the page
- If run is complete, metrics show final totals

**Retrigger button disabled**
- Only enabled after run completes or fails
- While run is executing, retrigger is not available

## Related

- [Board](./board.md) — Manage cards and open runs
- [Costs](./costs.md) — See aggregated costs across runs
- [Agents](./agents.md) — View/configure agent that's running
- [Ceremonies](./ceremonies.md) — View ceremony/workflow runs
- [Dashboard](./dashboard.md) — See run metrics aggregated
