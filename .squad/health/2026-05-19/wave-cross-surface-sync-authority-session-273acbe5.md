# Health Report: Cross-Surface Sync Authority Session

**Wave:** cross-surface-sync-authority-session-273acbe5  
**Date:** 2026-05-20T01:35:26Z  
**Session Type:** Decision capture and team coordination  
**Scribe:** Running checks

---

## Wave Summary

User directive clarified that Squadboard and CLI/Copilot must be interchangeable: users can start in either client and continue in the other. This requires rejecting the one-lifetime-authority model for a co-equal multi-surface authority pattern.

**Outcome:** Coordinator routed McManus and Kobayashi to define source-of-truth and SDK/client contract boundaries. 15 decisions merged; no inbox residue.

---

## Backlog Delta

| Component | Before | After | Change |
|-----------|--------|-------|--------|
| Inbox files | 15 | 0 | -15 (merged) |
| decisions.md | 342,235 bytes | ~360KB | +17KB |
| McManus history.md | 6,616 bytes | 7,493 bytes | +877 bytes |
| Kobayashi history.md | 10,905 bytes | 11,954 bytes | +1,049 bytes |
| Orchestration logs | 0 | 3 files | +3 (created) |
| Session logs | 0 | 1 file | +1 (created) |

---

## Lineage Tree

```
User Directive (Ahmed, 2026-05-19T18:35:26-07:00)
  ↓
Coordinator Decision (captured)
  ├─ McManus: Source-of-truth authority
  │   ├─ mcmanus-cross-surface-authority.md
  │   └─ mcmanus-cross-surface-sync-contract.md
  ├─ Kobayashi: SDK/client artifact contract
  │   ├─ kobayashi-cross-surface-contract.md
  │   └─ kobayashi-sdk-sync-ownership.md
  ├─ Hockney: [Release readiness, start script normalization]
  ├─ Keyser: [Sync status UI definition]
  ├─ Kujan: [Pre-alpha validation]
  ├─ Redfoot: [Docs normalization, terminology lock]
  └─ Scribe: [Inbox merge, logs, coordination]
    ├─ .squad/decisions.md (merged)
    ├─ .squad/orchestration-log/* (3 files)
    ├─ .squad/log/* (1 file)
    ├─ Agent history updates (2 files)
    └─ Git commit (staged)
```

---

## Defects Observed

**None.** All workflows executed cleanly.

---

## Spawn Summaries (Verbatim)

### Coordinator Directive Capture

> Squadboard and CLI/Copilot modes are interchangeable. A user can start with either client and continue in the other.
> 
> Coordinator updated docs/features/feat-2026-05-20-cross-surface-squad-state-authority-and-sync.md with Core Requirement and exit criteria.

### McManus — Cross-Surface Authority

> McManus defined source-of-truth outcome and wrote .squad/decisions/inbox/mcmanus-cross-surface-authority.md and .squad/decisions/inbox/mcmanus-cross-surface-sync-contract.md.

**Key insight from decisions:** Previous mode-authority rule remains, but interchangeability requires both clients to read and write through the same active authority for each project. No surface is first-class; both are co-equal.

### Kobayashi — SDK/Client Contract

> Kobayashi defined SDK/client artifact contract and wrote .squad/decisions/inbox/kobayashi-cross-surface-contract.md.

**Key insight from decisions:** A project has one Squad state authority at a time (filesystem `.squad/` or `squad_storage`). Both Squadboard and CLI/Copilot must target that same authority when they mutate Squad state. Generated client instruction files are projections, not independent state stores.

---

## Next-Wave Recommendations

1. **Implementation Priority:**
   - **Hockney:** Expose sync status API (`GET /api/projects/:projectId/squad-sync/status`) + repair endpoints
   - **Keyser:** Implement Sync Status panel in Settings (depends on Hockney API)
   - **Kujan:** Regression tests for both start paths (CLI-first, Squadboard-first)

2. **Decision Authority:**
   - Lock interchangeability as required for GA (not optional)
   - Both surfaces must use same storage authority; no cross-authority reads/writes
   - CLI-first projects default to `fs` mode; Squadboard-first default to `postgresql` mode (configurable)

3. **Testing & Validation:**
   - Extend regression suite to cover all start-path combinations
   - Live test: Create in Squadboard, edit in CLI, continue in Squadboard
   - Ceremony defaults must hydrate on both paths

4. **Documentation:**
   - Redfoot: User guide for mode selection and storage authority
   - Redfoot: Architecture diagram showing two co-equal entry points

---

**Report Generated:** 2026-05-20T01:35:26Z  
**Scribe Session:** COMPLETE

