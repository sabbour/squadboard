# Decision: ceremonies.md vs Runtime Relationship

**Date:** 2026-05-16  
**Research by:** Kobayashi  
**Wave:** W28  
**Status:** Pending Brady's input

---

## Summary

The squad has two separate ceremony layers:

1. **ceremonies.md** (spec) — Human-readable team process handbook. Defines 3 core ceremonies: Design Review, Retrospective, Retrospective with Enforcement.
2. **Runtime** (exec) — Executable workflows in PostgreSQL, triggered by events/schedules/manual actions. Supports 5 workflow templates but no built-in ceremony instances.

**Key finding:** There is **NO bidirectional sync** between spec and runtime. ceremonies.md is never read or executed; the runtime is authored separately in the UI via Conjure (LLM-powered prose→YAML).

---

## Top 3 Misalignments

1. **Built-in ceremonies are not instantiated.** The 3 ceremonies in ceremonies.md are never auto-created when a project boots. Teams must author them from scratch.
2. **No condition detection.** ceremonies.md says "auto before multi-agent task" but the runtime has no logic to detect such events.
3. **Visual editor allows branching; spec uses linear steps.** The H3 canvas supports conditional routing; ceremonies.md templates are single-threaded.

---

## Import-from-Markdown Verdict

**Should we add an import flow that reads ceremonies.md and auto-registers workflows?**

**NO.** Instead:

- Keep ceremonies.md as **aspirational reference** (team handbook).
- Add `.squad/ceremonies/*.workflow.yaml` for **canonical** YAML definitions (version-controlled).
- LLM-based Conjure remains the **primary authoring** surface (prose in UI → YAML).
- SDK provides `readCeremonies()` helper for **seeding** at init time.

---

## Recommended W28 Items (Top 8)

1. Clarify ceremony origin & provenance (where did this ceremony come from?).
2. Auto-seed built-in ceremonies on project init.
3. Canonicalize ceremonies as `.squad/ceremonies/*.workflow.yaml`.
4. Round-trip visual editor → YAML → visual → verify fidelity.
5. Expand GitHub event trigger filters (size, review state, milestone).
6. Auto-detect & trigger "before" ceremonies (emit event when batch spawned).
7. Document ceremony lifecycle (spec → authoring → versioning → deployment).
8. Audit existing ceremonies (count by kind/trigger/status; flag orphans).

---

## Questions for Brady

1. Should built-in ceremonies (Design Review, Retrospective, etc.) be auto-seeded on project boot, or only on user request?
2. Is ceremonies.md a read-only reference forever, or should teams edit it (and we parse)?
3. Should we surface "scope" (all-relevant, all-involved) as a first-class runtime concept?
4. Formulate throttles to 3 per 60s per ceremony — is this the right rate?
5. Should GitHub trigger filters expand beyond label/branch/author_team?

---

## Full Research Document

See `.squad/research/ceremonies-md-vs-runtime.md` (10 sections, ~500 lines).

---

## Decision Needed

- [ ] Approve Option B (YAML canonicalization in `.squad/ceremonies/*.workflow.yaml`)?
- [ ] Reject import-from-markdown approach?
- [ ] Prioritize which 8 items for W28?
