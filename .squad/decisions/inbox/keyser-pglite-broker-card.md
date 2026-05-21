# Decision: Show MCP Broker Setup Card in PGlite Mode

**Date:** 2026-05-21T00:05:18-07:00  
**Author:** Keyser (Frontend Dev)  
**Requested by:** Ahmed

## Context

`BrokerSetupCard` only rendered for PostgreSQL manual-bridge mode. New projects using the default local/PGlite path never saw MCP setup guidance, even though Copilot CLI still benefits from a project-local `.copilot/mcp-config.json` bridge.

## Decision

Render a second, lighter broker setup card whenever Squad Sync reports a non-PostgreSQL mode, while keeping the existing PostgreSQL manual-bridge card unchanged.

## Rationale

- **Mutually exclusive UX** keeps one clear next step on screen at a time.
- **Lighter fallback for PGlite** avoids showing PostgreSQL env vars that do not apply to local mode.
- **Reuse the existing repair action** so the primary button stays aligned with backend MCP-config generation.
- **No extra configured-state gate** was added because the current status payload does not expose a dedicated “MCP config already present” signal.

## Files changed

- `packages/client/src/components/settings/SquadSyncStatusPanel.tsx`
- `packages/client/src/components/settings/__tests__/SquadSyncStatusPanel.test.tsx`
