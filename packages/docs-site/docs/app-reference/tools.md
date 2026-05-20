---
title: Tools
description: External tool registry for agent integrations
---

# Tools

**Route:** `/projects/:id/tools`

Project-scoped catalog of external tools and integrations. Tools are MCP-backed capabilities agents can invoke.

## Overview

Tools are how agents interact with external systems. Each tool maps to a command, API, or integration. Tools are project-scoped; define tools your agents need for this project.

Tools are grouped by category.

## Tool List

Grid or list view of all tools in your project:
- Tool name
- Category
- Brief description
- MCP server backing it (if available)
- Enabled/disabled status

Click any tool to view or edit.

## Sections

### Available Tools
Shows all tools registered in this project. Grouped by category for easy browsing.

### Empty State
If no tools yet, shows explainer and action buttons.

## Actions

### Create Tool

**New tool:**
- Click "Create tool" or "+" button
- Enter tool name
- Choose category
- Select or create MCP server backend
- Write tool description
- Save

Tool name must be unique within the project. Names use snake_case or kebab-case.

### Edit Tool

Click existing tool:
- Modify name, category, description
- Update MCP server backing
- Save or delete

**Delete tool:**
- Click delete icon to remove tool permanently
- Agents can no longer invoke this tool

### Import Tools

**From JSON file:**
- Click "Import tools" button
- Upload `.json` file with tool definitions
- File format: array of tool objects with name, category, description, mcpServer, etc.
- Tools are merged (existing tools not replaced)

### Formulate Tool

Use inline AI to create tools from prose:
- Click "Formulate" button
- Describe what the tool should do
- AI generates a tool definition draft
- Review, customize (name, category, MCP server), and save

## Tool Detail

When viewing a tool:
- **Name** — Tool title
- **Category** — Classification
- **Description** — What it does
- **MCP Server** — Which MCP server provides this tool
- **Status** — Enabled/disabled

**Actions on detail:**
- Edit tool settings
- Test tool (if MCP server reachable)
- Delete tool
- View usage (which agents use it)

## Configuration

**Name validation:**
- snake_case or kebab-case required
- No spaces or special characters
- Unique within project
- Max 128 characters

**Category:**
- Freeform text
- Suggested categories: API, Database, Filesystem, Communication, etc.

**MCP Server:**
- Select from available MCP servers in [MCP Servers](./mcp-servers.md)
- Tool description should explain what the MCP server endpoint provides

## Import Status

After importing tools:
- Success/error banner shows
- Count of tools imported
- Any skipped (duplicates, validation errors)
- Error messages if import failed

## Related

- [MCP Servers](./mcp-servers.md) — Configure MCP backends for tools
- [Agents](./agents.md) — Assign tools to agent capability set
- [Skills](./skills.md) — Skills vs. Tools (complementary approaches)
