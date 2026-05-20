---
title: MCP Servers
description: Configure Model Context Protocol servers for tool integrations
---

# MCP Servers

**Route:** `/projects/:id/mcp-servers`

Project-scoped registry of MCP (Model Context Protocol) servers. MCP servers provide tools agents can invoke.

## Overview

MCP servers are external transports that expose capabilities to agents. Each server is defined by:
- **Transport** — how to connect (`http` or `stdio`)
- **Endpoint** — URL or command to invoke
- **Headers** — authentication or configuration (write-only)
- **Status** — enabled or disabled

An MCP server exposes a set of tools. Agents route to tools, which are backed by MCP servers.

## Server List

Grid or list view of all MCP servers configured:
- Server name
- Transport type (HTTP / stdio)
- Endpoint (URL or command name)
- Status (enabled/disabled)
- Provenance badge (built-in, custom, etc.)

Click any server to view or test.

## Sections

### Available MCP Servers
Shows all servers registered in this project. Each card summarizes transport and endpoint.

### Empty State
If no servers configured, shows explainer and "Create MCP Server" button.

## Actions

### Create MCP Server

**New server:**
- Click "Create MCP server" button
- Enter server name (unique in project)
- Choose transport:
  - **HTTP** — RESTful endpoint; provide URL
  - **Stdio** — Command-line tool; provide command and arguments
- Enter endpoint (URL for HTTP, command for stdio)
- Add optional headers (auth tokens, API keys, etc.)
- Test connection
- Save

**Headers are write-only:**
- Secrets entered here are stored securely
- Never echoed back in GET requests
- Only visible when editing

### Edit MCP Server

Click existing server:
- Modify name, transport, endpoint
- Update headers (full replace; can't read previous values)
- Test connection
- Save or delete

**Warning banner appears when updating headers** — reminds you that editing overwrites the full header array.

### Delete MCP Server

Click delete icon to remove server permanently. **Warning:** Tools that depend on this server will fail; ensure no tools reference it first.

### Test MCP Server

Click "Test" button to verify server is reachable and responsive:
- For HTTP: sends a test request to the endpoint
- For stdio: attempts to spawn the command
- Shows success/failure status
- Displays error message if connection fails

## MCP Server Detail

When viewing a server:
- **Name** — Server title
- **Transport** — HTTP or stdio
- **Endpoint** — URL or command
- **Status** — Enabled/disabled toggle
- **Tools** — List of tools provided by this server
- **Last tested** — When the connection was last verified
- **Test result** — Success or error from last test

**Actions:**
- Test connection
- Enable/disable server
- Edit configuration
- View tools powered by this server

## Configuration

**Name validation:**
- Must be unique within project
- Max 128 characters

**Transport options:**

**HTTP:**
- Full URL to MCP server endpoint
- Supports HTTP/HTTPS
- Port and path included in URL
- Example: `https://mcp.example.com/api/tools`

**Stdio:**
- Command name or full path to executable
- Arguments passed as separate fields
- Environment variables supported
- Example: `node /path/to/mcp-server.js --env production`

**Headers:**
- Key-value pairs (e.g., `Authorization: Bearer TOKEN`)
- Useful for API keys, authentication, custom config
- **Write-only** — values not returned in GET responses
- Can set multiple headers

## Import MCP Servers

**From JSON file:**
- Click "Import MCP servers" button
- Upload `.json` file with server definitions
- Format: array of server objects with name, transport, endpoint, headers
- Existing servers not replaced (merged)

## Related

- [Tools](./tools.md) — Tools provided by MCP servers
- [Agents](./agents.md) — Agents invoke tools (which use MCP servers)
- [Settings](./settings.md) — Global MCP configuration
