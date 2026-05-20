# Kujan test fixes — 2026-05-20

## What was broken

1. **RunButton client regression**
   - `pickDefaultConsultAgent()` and `isBackgroundAgent()` assumed `agent.role` was always a string.
   - The RunButton test fixture supplied an active agent without `role`, which caused `a.role.toLowerCase()` to throw before the mutation fired.

2. **ceremonies-list-route regression test drift**
   - The route now performs a `projects.path` lookup before fetching workflow rows.
   - The test's mocked DB queue still assumed the older query order, so ceremony rows were consumed by the wrong select and the route appeared to return no ceremonies.

3. **PGlite catalog-repair timeout**
   - The repair test exercises real file-backed PGlite reopen + catalog mutation behavior.
   - On current CI-like load it completes in ~20–23s, which exceeds Vitest's default 5s timeout even though the behavior is correct.

4. **execute-agent-run-events partial mock drift**
   - `bridge.ts` now checks `err instanceof AgentRunTimeoutError`.
   - The test mocked `createAgentSession` only, so full-suite validation failed once those tests ran.

## What was fixed

- Hardened agent-role normalization in `packages/client/src/components/agents/agent-origin.ts` so missing/null roles are treated as empty strings.
- Updated `packages/server/src/__tests__/ceremonies-list-route.test.ts` to:
  - include `projects.path` in the mocked schema
  - queue the project lookup before workflow rows
- Added explicit per-test timeout budgets to:
  - `packages/client/src/components/runs/RunButton.test.tsx` (`20_000ms`)
  - `packages/server/src/__tests__/pglite-issue-run-events-catalog-repair.test.ts` (`30_000ms`)
- Added the missing `AgentRunTimeoutError` export to `packages/server/src/__tests__/execute-agent-run-events.test.ts`.

## Systemic patterns observed

- **Mock drift is a recurring CI breaker.** Tests that mock low-level modules (`db`, `sdk/squad-client`, route wiring) need to track new queries/exports or they silently go stale.
- **Real-storage tests need explicit timeout budgets.** File-backed PGlite repair/reopen tests are too slow for the generic 5s default.
- **UI helper code should be defensive around historical data.** Agent fixtures and older rows may omit optional-looking fields even if the latest TypeScript interface says otherwise.
- **Full-suite validation matters.** Fixing the three named blockers exposed one more stale mock that focused runs would not have caught.
