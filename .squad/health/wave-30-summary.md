# Wave 30 — Close-Out Summary

**Coordinator:** asabbour (Copilot CLI session `4fa34ed1-d2fd-4363-8668-f63188a1cfe3`)
**Wave window:** 2026-05-16 (single-day wave, 3 batches)
**Wave verdict:** GREEN — main is clean, all tests pass, all dispatchable W30 todos closed.

---

## Headline

W30 was a **research-heavy wave** that combined targeted code fixes (reliability, security, dead-code removal) with five strategic SDK/Squadboard parity reports that feed W31-W34 planning. The mini-coordinator stack from W29 held up across 3 dispatch batches with zero file-conflict incidents.

The wave also exposed a sonnet-research-task reliability pattern (Kobayashi 2x, Hockney 1x CAPIError timeouts with no staged artifact). The Coordinator wrote two of the W30 reports manually after timeouts rather than retrying, saving ~80 min per attempt. This is now an established protocol.

## Code shipped (1 batch of cleanup + 1 batch of fixes)

| Lane | Owner | Result | Commit |
|------|-------|--------|--------|
| Dead-code: `routes/dashboard.ts` | Keaton | DELETED | `df3d551b3` |
| Dead-code: `EmptyBoard.tsx` | Keaton | DELETED | `4f042c3c6` |
| Dead-code: `board/CommentComposer.tsx` | Keaton | DELETED | `270b09c6a` |
| Dead-code: legacy `workflows/*` | Keaton | DELETED | `8baa874cf` |
| Dead-code: `scripts/pglite-spike.ts` | Keaton | DELETED | `13ae9cb6b` |
| M3: `unhandledRejection` + `uncaughtException` handlers | Verbal | 17 tests | `2f53f171f` |
| M2: AbortController timeout on `dispatchBatchViaCoordinator` | Hockney | new `CoordinatorTimeoutError` | `844829354` |
| BUG-1: wire `resolveCoordinatorModelChain` into retry | Coordinator | hotfix | `c4cb690ce` |
| C-4: prompt-injection mitigation (3-vector) | Keyser | 18 tests | `8d4942b4c` |
| C-1+C-3: opt-in HTTP auth + CSRF middleware | Keyser | 13 tests | `b0bc5eca6` |
| Vitest hygiene (silencer + dist exclude) | Coordinator | 1217 tests green | `4255c8820` |

## Research / docs shipped (W30 batch 2 + batch 3)

| Report | Author | Path | Commit |
|--------|--------|------|--------|
| Scribe close-out flow (SDK + Squadboard) | Verbal | `.squad/reports/wave-30-sdk-scribe-flow.md` | `8740d84fd` |
| Squad CLI vs SDK + Squadboard parity | Hockney | `.squad/reports/wave-30-cli-parity.md` | `cee813548` |
| `squad.agent.md` rules / Coordinator / SDK / Squadboard | Coordinator | `.squad/reports/wave-30-squad-agent-md-rules.md` | `39870b777` |
| SDK logs / orchestration-log generation | Coordinator (after Kobayashi failure) | `.squad/reports/wave-30-sdk-logs-orchlogs.md` | `354d7c9c1` |
| Add Project / Suggest Setup UX revisit | Verbal | `.squad/reports/wave-30-add-project-suggest-setup.md` | `f85e4e651` |
| Dogfooding architecture audit | Keaton | `.squad/reports/wave-30-dogfooding-architecture.md` | `a354d2905` |
| App / Bundle / Template / Plugin glossary | Coordinator (after Hockney failure) | `.squad/reports/wave-30-app-bundle-template-plugin.md` | `8f6117e65` |

## Health (test + typecheck status)

- **Typecheck:** all 4 workspaces clean (`pnpm -r typecheck` → 0 errors).
- **Tests:**
  - Server: 74 files / 1043 tests pass (+13 from Keyser auth+CSRF)
  - SDK: 2 files / 24 tests
  - Client: 15 files / 150 tests
  - **Total: 1217 tests, zero failures, 4 skipped**
- **Branch:** clean working tree on `main` after every commit.

## Top-3 findings to act on in W31

1. **Coordinator never calls `capture()`** in live sessions despite server plumbing being ready (Keaton dogfooding audit). The entire dogfood loop is decorative. Top fix: mandatory `capture({prompt, hint:'issue'})` call in `squad.agent.md` after writing each directive. → `w31-dogfood-capture-spec-fix` queued.
2. **Sonnet research-task CAPIError pattern.** 2x Kobayashi + 1x Hockney timed out (~80 min each, no staged artifact). Established protocol: after 1 sonnet failure on research, go manual. Saved ~150 min this wave.
3. **App / Bundle / Template / Plugin term drift.** 4 overloaded terms across ~960 file references. Migration plan in glossary report (15 renames, 6 PRs, 3-5 days work). Affects W34 `sabbour/squadboard-bundles` repo split.

## Open questions for Brady (escalations — cannot dispatch)

1. `w30-brady-open-questions-keaton` — 8 architecture questions from Keaton dogfooding report §7.
2. 5 open questions from Verbal Add Project / Suggest report.
3. 5 open questions from Coordinator glossary report (Squad App naming, folder name, deprecation strategy, Saved-Template naming, Plugin marketplace home).
4. 4 follow-ups from Keyser auth/CSRF (full RBAC, CORS preflight, auth-failure rate-limit, token rotation).

## W31 launch (highest-leverage from reports)

- `w31-pickup-todos-data-plumbing-bugs` (Hockney sonnet — `pickup-todos.ts`)
- `w31-coordinator-deterministic-prefilter` (Jude sonnet — `coordinator/prefilter.ts` NEW)
- `w31-circuit-breaker-pre-dispatch` (Verbal sonnet — move circuit-breaker before sweep tick)
- `w31-sdk-directive-capture-inbox` (Kobayashi sonnet — SDK API addition)
- `w31-dogfood-capture-spec-fix` (any — `squad.agent.md` spec change, low risk)

## SQL todo state at close

- W30: 13 done / 1 pending (`w30-brady-open-questions-keaton`, Brady-only).
- W31: 14 pending.
- Total: ~263 done / 53 pending / 0 in-progress.

## Hygiene reminders that worked

- File-disjoint lanes per parallel batch → zero file-conflict incidents in W30 batches 1-3.
- Explicit `git add <path>` lists in every spawn prompt → zero rogue commits.
- `NEVER include INSERT INTO _migration_log` in dispatch prompts → no migration corruption regressions.
- `DOGFOOD = no push` → preserved.

---

*Wave closed by Coordinator on 2026-05-16. Inbox files drained into `decisions.md` Wave 30 section (lines ~4131-4216). All 8 W30 inbox files folded; 21 pre-W30 inbox files left as backlog for a future Scribe sweep (out of W30 scope).*
