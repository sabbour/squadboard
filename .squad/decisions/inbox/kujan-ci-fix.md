# Kujan CI fix — run Vitest on every PR

- **Timestamp:** 2026-05-20T12:51:52.451-07:00
- **Owner:** Kujan
- **Scope:** GitHub Actions CI gate for tests and types
- **Status:** Landed locally; expected to fail on existing red suites until product fixes land

## What changed

Updated `.github/workflows/ci.yml` so the `npm-packages` job now does the following in order:

1. `pnpm install --frozen-lockfile`
2. `pnpm run npm:build`
3. **Type check workspace packages**
   - `pnpm --filter @sabbour/squadboard-client typecheck`
   - `pnpm --filter @sabbour/squadboard-sdk typecheck`
   - `pnpm --filter @sabbour/squadboard exec tsc --noEmit`
   - `pnpm --filter @sabbour/squadboard-cli exec tsc --noEmit`
4. **Run Vitest suites**
   - `pnpm --filter @sabbour/squadboard-sdk test`
   - `pnpm --filter @sabbour/squadboard-client test`
   - `pnpm --filter @sabbour/squadboard test -- --run`
5. `pnpm run npm:publish:dry-run`

Both new CI gates use `timeout-minutes: 10`.

## Baseline state before the CI edit

- Root `pnpm test` is not a valid gate because the monorepo root has **no** `test` script.
- `pnpm -r test` immediately exposed existing failures:
  - `packages/client`: `RunButton.test.tsx` fails and throws `TypeError: Cannot read properties of undefined (reading 'toLowerCase')` in `src/components/agents/agent-origin.ts`.
  - `packages/server`: Vitest is red in `src/__tests__/ceremonies-list-route.test.ts` and `src/__tests__/pglite-issue-run-events-catalog-repair.test.ts`.
- Type baseline:
  - `packages/client` typecheck: pass
  - `packages/squadboard-sdk` typecheck: pass
  - `packages/server` `tsc --noEmit`: fail in `src/engine/workflow-runner.ts`
  - `packages/cli` `tsc --noEmit`: pass

## Post-change validation

Reran the exact commands wired into CI. Results are unchanged from baseline, which is the point of the fix: CI now detects the existing red state instead of ignoring it.

- `@sabbour/squadboard-sdk` tests: pass
- `@sabbour/squadboard-client` tests: fail reproducibly
- `@sabbour/squadboard` tests: fail reproducibly
- Client + SDK typecheck: pass
- Server `tsc --noEmit`: fail reproducibly
- CLI `tsc --noEmit`: pass

## QA conclusion

This workflow now enforces the invariant the audit called out: broken Vitest suites and broken TypeScript types are PR blockers. The remaining work is product-side: fix the already-red client/server tests and the server type errors.
