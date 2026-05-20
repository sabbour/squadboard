# Redfoot Agent History

**Last summarized:** 2026-05-20T13:46:25Z
**Archive:** See `history-archive.md` for full history

## Quick Summary

**Total waves:** 2

## Latest Activity

---

## W31 Wave 3 — API & WebSocket Documentation

**Date:** 2026-05-20T13:46:25.412-07:00  
**Status:** Completed ✅

### Deliverables

Documented 129 REST API endpoints and WebSocket protocol from code audit:

1. **REST API Reference** (`docs/api-reference.md` — 375 lines)
   - 24 resource groups (Projects, Agents, Issues, Runs, Workflows, etc.)
   - Base URL, auth, path parameters documented
   - Endpoint grouping by semantic domain, not file-by-file
   - Audience: API consumers, integration developers

2. **WebSocket Protocol** (`docs/websocket-protocol.md` — 467 lines)
   - Connection, auth, heartbeat (15s ping/pong)
   - 4 client→server message types: subscribe, unsubscribe, presence.cursor, resubscribe
   - 50+ server→client events: issue lifecycle, run execution, presence, consult (chat), comments
   - Reconnection & replay strategy (15-min buffer for consult rooms)
   - Comparison to REST API (polling vs. push)
   - Audience: real-time UI developers, dashboard builders

3. **README links** (`README.md`)
   - Added "Documentation" section with API + WebSocket links
   - Positioned after "Getting Started" and before "Dogfood Mode"

### Metrics

- **Total:** 842 lines of developer-facing docs
- **Endpoints grouped:** 129 unique REST endpoints (from 41 route files)
- **WebSocket message types:** 50+ event types documented with payloads
- **Commit:** 238939d13

### Design Decisions

- **Grouping by resource, not route files:** Endpoints organized by semantic domain (Projects, Agents, etc.), not alphabetically by route file — easier to scan and find related endpoints.
- **Only document, don't invent:** Extracted endpoint paths and descriptions from actual code; no aspirational endpoints or made-up message types.
- **WebSocket priority:** Emphasized real-time events over REST equivalents; included heartbeat, reconnection, and buffer replay patterns teams actually use.
- **Minimal scope:** No SDK examples, no setup instructions (those live in getting-started); focus on raw protocol + endpoint reference.

### Learnings

1. **129 endpoints were undocumented** — no prior API reference existed; developers had to trace code or trial-and-error.
2. **Presence & consult are WebSocket-only** — REST `/api/projects/:id/presence` is snapshot-only; real-time requires WebSocket.
3. **Consult rooms use special naming** — `consult:<sessionId>` rooms maintain 15-min event buffers; `resubscribe` replays from `lastSeq`.
4. **Route mounting in index.ts is the source of truth** — 41 route files import, mounted in one place; extracting from code is faster than guessing.

---

## W31 Wave 2 — Package Documentation

**Date:** 2026-05-20T13:26:25.229-07:00  
**Status:** Completed ✅

### Deliverables

Wrote READMEs for all 3 published npm packages (previously undocumented):

1. **@sabbour/squadboard-cli** (122 lines)
   - CLI entry point; two modes (init, mcp); storage options
   - Audience: npm installers, MCP host users

2. **@sabbour/squadboard-sdk** (94 lines)
   - Library SDK for ceremonies and bundle schemas
   - Main API: `squadboard.scribe.closeOut()`, fine-grained imports
   - Audience: SDK consumers, ceremony integrations

3. **@sabbour/squadboard** (169 lines)
   - Main server package combining kanban, workflows, ceremonies, agents, MCP
   - Audience: MCP consumers, self-hosters, local development

### Metrics

- Total: 385 lines of documentation
- Average: 128 lines per package
- All marked pre-alpha with appropriate caveats
- Minimal scope: only documented what's actually exposed

### Design Decisions

- No aspirational content; only current surf


## Wave 3 — API Documentation Complete (2026-05-20T20:52:37Z)

### Delivery
- docs/api-reference.md — 129 REST endpoints, 24 resource groups (~375 lines)
- docs/websocket-protocol.md — Full WebSocket protocol, 50+ event types (~467 lines)
- README.md — Documentation section added with links

### Key Decisions
- Organized API by resource domain (not route files)
- Extract-only: no aspirational endpoints
- WebSocket priority for real-time features
- Minimal scope: reference only, not tutorials

### Commits
238939d13 — Created docs/api-reference.md, docs/websocket-protocol.md
457524b6c — Updated README.md with Documentation section

### Status
✓ Complete — all endpoints documented, WebSocket protocol specified, README linked
