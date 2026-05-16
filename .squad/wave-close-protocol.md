# Wave Close Protocol — Build, Merge, Verify

**Established:** 2026-05-16 by Ahmed (Brady) directive: *"close each wave by building and merging to main and verifying things still work"*.

**Effective:** Wave 24 onward (retroactively applied to W17-W23 as a one-shot bulk catch-up).

---

## The contract

A wave is NOT closed until ALL of these are green:

1. ✅ All domain agents committed their work (no orphan artifacts on disk)
2. ✅ Scribe close-out done (inbox merged, decisions written, orch log written, health report written)
3. ✅ `pnpm -r build` clean (zero TS errors, zero workspace failures)
4. ✅ `main` fast-forwarded to the wave tip
5. ✅ Smoke verify on `main` (server starts, `/api/health` 200, client renders)

If any step fails → **the wave doesn't close**. Spawn a fix-agent, retry the failing step. Do NOT mark todos done. Do NOT dispatch the next wave's domain agents until the current wave closes.

---

## The orchestrated sequence

```
[domain agents finish]
        │
        ▼
[ORPHAN COMMIT PASS] — coordinator OR per-agent
   • Stage and commit any uncommitted work in attributed groups
   • Commit message format: "{stream}({wave}): {summary} ({Agent})"
   • One commit per logical unit (don't bundle Hockney + Kobayashi in one commit)
        │
        ▼
[SCRIBE close-out] — claude-haiku-4.5
   • Inbox → decisions.md (existing)
   • orch log per agent (existing)
   • Session log (existing)
   • Cross-agent history append (existing)
   • Health report (existing)
   • Decisions archive HARD GATE (existing)
   • History summarization HARD GATE (existing)
   • Git commit of Scribe-authored files (existing)
        │
        ▼
[HOCKNEY close-out] — claude-haiku-4.5 (mechanical ops)
   • pnpm -r build  → must exit 0
   • [optional/configurable] pnpm -r test  → must exit 0
   • If build fails:
       - Capture error
       - Write .squad/decisions/inbox/hockney-w{N}-close-build-fail.md
       - DO NOT merge to main
       - DO NOT mark wave closed
       - Spawn a fix-agent (typically the domain owner of the failing package)
       - Re-run this close-out after fix
   • If build green:
       - git checkout main
       - git merge --ff-only {wave-tip-branch}  → must succeed
       - If FF fails (main diverged): spawn rebase/merge sub-agent, do not force
       - git checkout {wave-tip-branch}  (return to working branch)
   • Smoke verify:
       - Background-start server: pnpm dev (kill after smoke)
       - curl -fsS http://127.0.0.1:{port}/api/health  → 200
       - HEAD request on client root → 200, HTML returned
       - Kill server
   • Health report sibling: .squad/health/{date}/wave-{N}-close.md
       Sections: build duration, test summary, merge result, smoke result, sha at main HEAD
        │
        ▼
[CLOSE DOGFOOD CARD] — coordinator
   • For each captured-on-intake directive in this wave:
       capture("done: {summary} (sha={merged-sha-on-main})")
   • Move squadboard card from inbox → done
```

---

## Failure handling — wave gets stuck

If close-out fails repeatedly (build won't go green, smoke fails twice), the coordinator:

1. Pauses the autopilot loop
2. Pings Ahmed with a concise diagnostic:
   ```
   ⚠️ Wave {N} stuck at close-out step: {step name}
   Last error: {one-line}
   Last commit on working branch: {sha} ({message})
   Main HEAD: {sha}
   Recommended next action: {1-2 options}
   ```
3. Does NOT dispatch the next wave until Ahmed responds

---

## Retroactive catch-up (one-shot, W17 → W23 → W24)

Brady's `main` froze at Wave 16 (`7e6d931b`) on 2026-05-15. By W23 close, `keyser/w17-settings-backup-github` was 34 commits ahead and 0 behind — a fast-forward path with zero conflict risk.

The W24 close-out (this wave) executes the full new protocol AND the retroactive bulk catch-up: when the FF lands, all 34 prior commits (W17-W23 + W24) land on main simultaneously. Per-wave smoke verification of W17/W18/W19/etc. is NOT performed retroactively — only the final composed tip is verified. Acceptable trade-off because:

- All intermediate states had per-package builds during their wave (agents ran `pnpm -C packages/client build` etc.)
- The team's regression discipline going forward starts at W24
- Bisecting 7 historical waves would be ~7× the work for marginal benefit

---

## Why Hockney owns the close-out, not Scribe

Scribe is Haiku/mechanical, but its job description is **memory & decisions** — file ops on `.squad/`. Adding build orchestration to Scribe muddles its concern.

Hockney is Backend/DevOps territory. Build + merge + smoke is squarely in his wheelhouse. He gets a Haiku model for this work (mechanical ops, no code authorship) — same cost profile as Scribe, cleaner role separation.

---

## Update history

- **2026-05-16** (Ahmed directive) — Protocol created.
