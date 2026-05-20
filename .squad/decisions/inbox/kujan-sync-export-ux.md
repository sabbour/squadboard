# Kujan — Sync export UX regression gate

**Date:** 2026-05-20T04:16:33.702-07:00  
**Status:** Rejected until focused regressions pass  
**Owner for production revision:** Keyser

## Decision

Do not ship the current sync status export UX until `SquadSyncStatusPanel.test.tsx` passes the two new regressions:

1. The no-live-filesystem-mirror warning must avoid provider/env-var/internal broker jargon and expose clear user-facing actions.
2. An unchanged/up-to-date Preview Export dry run must summarize the no-op and must not dump every unchanged `.squad` path or raw `already_up_to_date` status.

## Evidence

Focused command run:

```bash
pnpm --filter @sabbour/squadboard-client test -- --run src/components/settings/__tests__/SquadSyncStatusPanel.test.tsx
```

Result: 2 failed, 5 passed. The failing assertions reproduce the bug report: the panel still renders `SQUADBOARD_SQUAD_STORAGE_PROVIDER`, MCP/API broker wording, explicit-bridge copy, and the Preview Export modal still lists unchanged paths with raw `already_up_to_date`.
