---
title: Inbox
description: Review and manage captured items awaiting action
---

# Inbox

**Routes:** `/inbox` (global) or `/projects/:id/inbox` (project-scoped)

Review all items captured for action. Items flow through statuses: Captured → Formulated → Published → Discarded. Use Inbox to batch-review and route work.

## Overview

Inbox collects items waiting for action. Unlike the Board (which is push-driven from the Ready column), Inbox is pull-driven—you review captured items and decide where they belong.

Items are grouped by status so you can see what's at each stage of the workflow.

## Status Sections

### Captured
Items that have been captured but not yet formulated (prepared for the board). Shows only basic context.

**Metadata shown:**
- Item title
- Suggested project (if available)
- Suggested column (if available)
- Confidence score (for AI-suggested routing)
- Time captured

### Formulated
Items that have been prepared (context extracted, ready to move to the board). Shows more detail than Captured.

### Published
Items that have been moved to the board. Informational; you can view them here, but active work happens on the Board.

### Discarded
Items that have been explicitly discarded. Kept for audit trail.

## Actions

**Open in Conjure**
- Click the "Open in Conjure" button on any item
- Opens the Consult chat interface with the item's context pre-loaded
- Use this to brainstorm, refine, or discuss the item before moving it to the board

**View published item**
- Click "View on board" for published items
- Navigates to the Board with that card open in the detail drawer

**Discard item**
- Click the discard icon on any Captured or Formulated item
- Moves it to the Discarded section
- Non-destructive; you can review discarded items later

**Back to Projects**
- Click the breadcrumb or back button to return to Project Picker

## Scoping

**Global Inbox** (Route: `/inbox`)
- Shows items captured across all projects
- Useful for batch review across the organization

**Project Inbox** (Route: `/projects/:id/inbox`)
- Shows items captured within this specific project only
- Narrower scope for focused review within one project context

## Related

- [Consult](./consult.md) — Chat interface for item context and brainstorming
- [Board](./board.md) — View published items and active work
- [Ceremonies](./ceremonies.md) — Automate capture and formulation with workflows
