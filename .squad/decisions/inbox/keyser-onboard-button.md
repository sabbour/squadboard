# Decision: Single Connect to Squadboard CTA + Reconciliation Status

**Date:** 2026-05-21T09:48:51-07:00  
**Author:** Keyser (Frontend Dev)  
**Requested by:** Ahmed

## Context

`SquadSyncStatusPanel` originally exposed multiple targeted setup/repair actions. The desired UX is now a single onboarding path backed by a backend-provided reconciliation signal that tells users whether MCP config, ceremonies, and agent instructions are still in sync.

## Decision

Replace the visible repair-action UI with one `Connect to Squadboard` CTA that always calls `onboard-to-squadboard`. Pair it with a reconciliation status card that:

- shows **“Squadboard is connected”** when the project is connected and in sync,
- shows **“Configuration drift detected”** with specific missing items when the project is connected but out of sync,
- shows a prominent **Connect to Squadboard** CTA only when the project is not connected,
- shows **Re-run setup** plus a muted **Disconnect from Squadboard** action when the project is connected but drifted,
- shows only the muted **Disconnect from Squadboard** action when the project is connected and healthy,
- relies on the existing status refresh path instead of adding a dedicated polling loop.

## Rationale

- **One obvious action** removes setup ambiguity and avoids making users choose among low-level repairs.
- **Backend-owned reconciliation** lets the UI speak in user terms instead of inferring state from scattered artifacts.
- **Drift-specific guidance** makes recovery obvious: users see exactly what is missing, then click one button to restore it.
- **Separate disconnect control** acknowledges that users may want to remove MCP linkage without deleting ceremonies or history.
- **No extra polling logic** keeps the frontend aligned with the backend-owned status lifecycle.

## Files changed

- `packages/client/src/api/squad.ts`
- `packages/client/src/components/settings/SquadSyncStatusPanel.tsx`
- `packages/client/src/components/settings/__tests__/SquadSyncStatusPanel.test.tsx`
