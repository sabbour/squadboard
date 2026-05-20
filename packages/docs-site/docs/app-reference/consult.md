---
title: Consult
description: Chat workspace for queries, brainstorming, and context exploration
---

# Consult

**Routes:** `/consult/new`, `/consult/:sessionId` (global) or `/projects/:id/consult/new`, `/projects/:id/consult/:sessionId` (project-scoped)

Open-ended conversation workspace. Chat with agents or models to explore context, brainstorm, refine problems, or answer questions—without creating a formal workflow or card on the board.

## Overview

Consult is where you think out loud. Start a new conversation, chat with an agent or model, and the full conversation history is saved. You can pick up where you left off anytime.

Each session has a project scope (global or specific project), agent/model selection, and full message history with streaming output.

## New Session

**Create a new conversation:**
- Click "New Conversation"
- Optionally start with prefilled context:
  - From an issue on the board (`?prefill=issue:ISSUE_ID`)
  - From a ceremony/workflow (`?prefill=ceremony:CEREMONY_ID`)
  - From raw text (`?prefill=text:YOUR TEXT`)
- Optional session name (defaults to first message preview)

**Choose execution mode:**
- **Agent mode** — Delegate to a project agent; picks an available model
- **Model mode** — Direct chat with a model; choose model from dropdown

**Agent routing:**
If in agent mode, optional agent dropdown narrows to that agent only. Otherwise, Squadboard routes to best-fit agent based on query.

**Optional overrides:**
- Override model selection (pick a different model than agent default)
- Set explicit system prompt context

## Session View

### Messages
Chat interface with alternating user/assistant bubbles. Streaming responses show live as they're generated.

User messages show send time. Assistant messages show model name, token count, and cost.

### Context Panel
Right sidebar (optional) shows current execution context:
- Selected agent
- Selected model
- Project scope
- Token budget remaining

### Actions

**Send message**
- Type query in message input
- Press Enter or click Send
- Streaming response appears immediately

**Retry**
- If a message fails, click Retry on that message to resend

**Edit message**
- Click edit icon on your message to revise and resend

**End session**
- Click "End conversation" to mark session as complete
- Session is archived; you can still read history

**Rename session**
- Click on session name to rename (for easier reference)

**Delete session**
- Click delete icon to remove session permanently

## Session List (Left Sidebar)

Previous sessions are listed on the left. Click any session to resume where you left off.

Sessions are organized by:
- Most recent first
- Grouped by project (global vs. specific project)

## Proposal Workflow

Agents can suggest concrete actions (e.g., "Move this card to Ready"). When a proposal appears in chat:

**Actions:**
- **Accept proposal** — Execute the suggested action
- **Discard proposal** — Decline and continue chatting

Accepted proposals trigger the action (e.g., card moves, workflow runs).

## Scoping

**Global Consult** (Route: `/consult/new`)
- Not tied to any project
- Access all global agents or any available model
- Useful for cross-project exploration or general queries

**Project Consult** (Route: `/projects/:id/consult/new`)
- Tied to specific project
- Access project agents and project-scoped context
- Prefilled with project context when appropriate

## Related

- [Board](./board.md) — Formal work and card management
- [Agents](./agents.md) — View available agents and routing
- [Inbox](./inbox.md) — Capture items from Consult conversations
