# Decision: Keyser dead client code cleanup (2026-05-20)

**Status:** DELIVERED

## Deleted

1. `packages/client/src/api/ralph-monitor.ts`
   - Verified zero client consumers.
   - Broader `packages/` search showed only server-side Ralph monitor code plus the Heartbeat sweep label.

2. `packages/client/src/realtime/useOptimisticIssue.ts`
   - Verified zero imports/usages in client code.

3. `packages/client/src/pages/LiveSession.tsx`
   - Verified no importers and no router entry in `packages/client/src/App.tsx`.

4. `packages/client/src/pages/StarterDetail.tsx`
   - Verified no importers and no router entry in `packages/client/src/App.tsx`.

## Skipped

1. `packages/client/src/api/workflows.ts`
   - **Kept.** Still imported by `packages/client/src/components/board/CardDetail.tsx` (`useWorkflowRun`, `useStartWorkflow`). Deprecated, but not dead.

## Verification

- `pnpm --filter @sabbour/squadboard-client build` ✅
- `pnpm --filter @sabbour/squadboard-client test -- --run` ⚠️ still has unrelated baseline failures in `src/components/runs/RunButton.test.tsx` caused by `pickDefaultConsultAgent` reading `a.role.toLowerCase()` from undefined.
