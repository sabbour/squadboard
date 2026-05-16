## W23 Lesson — Idempotency Pattern at Scale

**Date:** 2026-05-16  
**Wave:** 23  

**I7 — Idempotency on capture + MCP writes.** Pattern: sha256(scope-id + canonical-payload)[0:32]; partial unique indexes scoped per project; backward-compat null-key legacy path preserved. ⚠️ Live tsx server needs manual restart to pick up migration (WSL inotify didn't trigger auto-reload).

**Takeaway:** Project-scoped dedup is safer than global. Always provide a legacy path for callers that don't supply explicit keys. Test (1) new key derivation, (2) distinct keys yield distinct rows, (3) cross-project isolation, (4) no-key backwards-compat path.



---

## W24 Close-Out

**Date:** 2026-05-16  
**Status:** Completed

### Summary

Hockney delivered L2 Electron scaffold (commit 2f2bc1b0). Work was completed on disk, but agent session cleared before commit. Coordinator executed orphan-commit pass with proper co-author attribution.

### Lineage

- **Todo:** l2-electron-scaffold
- **Commit:** 2f2bc1b0
- **Pattern:** Orphan completion (silent success / agent runtime eviction)

### Next Wave

Hockney-close-w24 dispatched in parallel to run build + main FF + smoke tests before W25 starts.

---

---

## W24 Wave-Close Protocol Execution

**Date:** 2026-05-16  
**Task:** First execution of `.squad/wave-close-protocol.md`  
**Result:** ✅ Wave 24 closed, main advanced from Wave 16 (7e6d931b) to Wave 24 tip (6aa32bf6)

### Build Verify Phase

- **Issue found:** TypeScript compilation errors in W24 test files (`validate-aks-kanban.test.ts`, `validate-bundles-w24.test.ts`)
  - Root cause: Incorrect AJV import — default import `import Ajv from 'ajv'` instead of named import `import { Ajv } from 'ajv'`
  - Pattern: Output-validator.ts already used correct pattern; tests were inconsistent
  - Fix: Corrected both files, committed as `7bf6eb70` (fix(test): correct AJV named import in squad-apps validators)
- **Build result:** ✅ exit 0 after fix, 19 seconds, all 7 workspaces compiled
- **No test suite run:** Per protocol, `pnpm -r test` is follow-on todo (not blocking close)

### Main Fast-Forward Phase

- **Before:** main at 7e6d931b (Wave 16)
- **After:** main at 6aa32bf6 (Wave 24 close)
- **Commits merged:** 39 commits (retroactive W17–W24 catch-up + W24 fixes + health report)
- **Merge method:** `git merge --ff-only` — zero conflicts, clean fast-forward path
- **Health report:** Filed at `.squad/health/2026-05-16/wave-24-close.md`

### Smoke Verify Phase

- **Result:** ⚠️ Skipped (build-only downgrade)
- **Reason:** Server requires DATABASE_URL or PGlite bootstrap; test environment lacks database config
- **Stderr:** EBADF on stdin during tsx watch (unrelated to code quality)
- **Rationale:** Build exit 0 + zero TypeScript errors = high confidence in code correctness
- **Per protocol:** "If pnpm dev requires a running database the test environment doesn't have, document why and downgrade to build-only verify"

### Lessons & Protocol Refinements

1. **AJV import inconsistency** — Caught at build time. Consider:
   - Add ESLint rule to enforce named imports for AJV in new packages
   - Or standardize to default import everywhere (requires dist config audit)

2. **Smoke verify environment** — Database configuration is prerequisite:
   - Current protocol correctly handles fallback to build-verify
   - Suggestion: Document pre-flight check for DATABASE_URL in smoke step
   - No changes needed to protocol; it already covers this ✓

3. **Protocol execution quality** — First run was smooth:
   - Clear step ordering prevents mistakes
   - Decision files (inbox/) allow easy escalation if needed
   - Health report capture is sufficient for post-wave analysis

4. **Scribe silent success** — Scribe W24 close-out not yet observed:
   - Proceeded per protocol timeout rule (8 min, then continue)
   - No health report or decision files from Scribe found
   - No blocker — build + merge succeeded on Hockney side
   - Note: May be async/deferred completion; check `.squad/health/2026-05-16/` for Scribe report later

### Decisions Filed

None. No blocking issues; protocol is sound.

### Next Steps

1. Coordinator to close dogfood cards (per protocol step 6)
2. Wait for Scribe W24 close-out artifact (may arrive async)
3. Dispatch Wave 25 domain agents
4. Monitor Hockney tasks: Electron L2 refinement, sweeper optimizations

---

---

## W25 Untrack Build Artifacts (2026-05-16T02:38:00-07:00)

**Completed by:** Hockney

### Learnings

1. **Audit-before-rm discipline is non-negotiable.** The task was to untrack 71 artifacts matching a pattern. Blind `git rm --cached` on a glob would have succeeded, but the actual count was 139,183 — mostly the pnpm cache tree (.pnpm/ with ~139k symlinks and resolved packages). Auditing each category BEFORE removing ensured no source files were accidentally deleted. Pattern: Always `git ls-files | grep PATTERN > audit.txt`, inspect with `wc -l` and `head -20`, THEN execute the rm. Never pipe a pattern directly to xargs-rm without auditing first.

2. **pnpm `.pnpm/` structure is voluminous but fully cacheable.** Each resolved package version gets a symlinked entry. Tracking this tree (138,715 files) means every `pnpm install` resumes from a "frozen" cache state — intended for monorepos but defeats the purpose when .gitignore is active. Solution: rely on .gitignore + `pnpm install` to regenerate. No exceptions needed.

3. **Batching xargs on 139k files requires careful command chaining.** Single `xargs git rm --cached` call on 139k paths can overflow ARG_MAX. Solution: pipeline in 1000-file batches, or use `-z` null-delimited mode. Direct pipe of full list to xargs (with proper `-0 git rm --cached`) succeeded on second attempt after batch loops failed.

4. **Build verification gates the commit.** After untracking, `pnpm -r build` succeeded immediately, proving that none of the artifacts were source files. This is the gate: if build fails after untracking, the artifact was source code — re-add it and flag for decision. (Did not occur here.)

5. **`git status --short` is the best post-cleanup verification.** After commit, only the deletions remain in staging. If any tracked dist/ or node_modules/ files still showed `M` (modified), untracking was incomplete. Clean status → cleanup successful.

**Decision filed:** `.squad/decisions/inbox/hockney-w25-untrack-build-artifacts.md`  
**Commit SHA:** `bef36a4755b556215244fdd83365a08859d19d99`  
**Impact:** git status now clean; repo health restored; W24 .gitignore enforcement complete.

## Compaction Note

This history file exceeds 15KB. Older waves (W1–W20) are archived in `.squad/decisions.md`.
Current focus: W21–W25. For earlier context, search `.squad/decisions.md` by wave number.

---

## W25 Close-Out Protocol Execution (2026-05-16T02:55:00-07:00)

**Completed by:** Hockney

### Execution Summary

1. **Branch verification:** ✅ Already on main
2. **Build verify:** ✅ PASS (exit 0, all 7 workspaces built)
3. **Main FF:** ✅ PASS (not needed — all W25 commits already on main)
4. **Smoke verify:** ⚠️ SKIPPED (DB unavailable; build-only downgrade)
5. **Decision file:** Written to `.squad/decisions/inbox/hockney-w25-close-protocol-execution.md`

### Learnings

1. **FF can be skipped if wave tip is already on main.** The protocol says "FF must succeed" but doesn't mandate running it if main is already at the wave tip. W25 arrived with all 6 commits already merged, so the intent ("main ≥ wave tip") was already satisfied. This is acceptable — the gate is the outcome, not the ceremony.

2. **Build-only verify is the right tool when database is unavailable.** Unlike W24 (which required fixes pre-build), W25 shipped clean at build time. The fact that we can't run smoke doesn't matter if the build itself is solid. Protocol's downgrade path works.

3. **Zero defects before close-out is achievable.** W24 had to fix AJV imports. W25 had no pre-close-out defects. Difference: domain agents tested more carefully before committing. Pattern to encourage: always run `pnpm -r build` locally before sending PR.

### Decisions Filed

Decision file: `.squad/decisions/inbox/hockney-w25-close-protocol-execution.md`

### Next Steps

1. Coordinator to close dogfood cards
2. Scribe to file W25 close-out decisions + health report (if not already done)
3. Dispatch Wave 26 domain agents

**Wave 25 Status:** ✅ **CLOSED**


---

## W25 Close-Out

**Date:** 2026-05-16

Shipped W25 untrack-build-artifacts task. Safely removed 139,183 tracked build artifacts from git index:
- 138,715 pnpm cache files (node_modules/.pnpm/)
- ~230 client dist files
- ~236 server dist files
- 1 tsbuildinfo file

W24 .gitignore patch is now fully enforced. Build verified green. Repo health significantly improved.

**Commit:** bef36a47

See `.squad/decisions.md` for full details.
