# Decision: Promote Onboarding to a Single Primary CTA

**Date:** 2026-05-21T09:48:51-07:00  
**Author:** Keyser (Frontend Dev)  
**Requested by:** Ahmed

## Context

`SquadSyncStatusPanel` already exposed granular repair actions such as MCP broker setup, ceremony seeding, and workflow import/export. That made first-time setup feel procedural even though the intended happy path is a single composite onboarding action.

## Decision

Add a prominent primary `Connect to Squadboard` CTA above the targeted repair list. It calls the new `onboard-to-squadboard` repair action directly, shows inline loading/success/error feedback, and keeps the existing broker card plus individual repair buttons available below for advanced troubleshooting.

## Rationale

- **Primary-first onboarding** gives users one obvious next step instead of three separate setup clicks.
- **Idempotent placement** lets the CTA stay visible for per-project setup without waiting on a richer backend readiness signal.
- **Advanced actions remain discoverable** so targeted repair/export flows are still available when onboarding only partially succeeds or a user wants manual control.
- **Shared mutation path** keeps the CTA aligned with the existing repair endpoint contract.

## Files changed

- `packages/client/src/api/squad.ts`
- `packages/client/src/components/settings/SquadSyncStatusPanel.tsx`
- `packages/client/src/components/settings/__tests__/SquadSyncStatusPanel.test.tsx`
