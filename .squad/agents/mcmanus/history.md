## W22 Lesson — Squad Apps Spec Delivery

**Date:** 2026-05-16  
**Wave:** 22

Squad Apps spec authored (docs/squadapp-spec.md, 1100 lines) — anchors Stream F (F4 curated apps, F5 import/export, F6 marketplace).

**Key patterns from this work:**
1. **Distribution format as superset of runtime format.** Existing `squad-bundle.json` becomes the runtime representation; new `squadapp.json` adds appId, tags, homepage, requires, seedIssues, README on top. Reuse existing idempotency patterns.

2. **Design for downstream clarity.** Define 10 open questions (OQ-1 through OQ-10) as *deferred* to later streams, not blockers. F4 can start immediately on curated apps; F5/F6 address registry, secrets, and schema discovery without blocking F4.

3. **Fixed artifact creation order prevents foreign-key violations.** Order: project → kanban → skills → tools → mcp → team → routing → ceremonies → workflows → seed issues. This mirrors existing bundle-loader patterns.

4. **Collision handling: skip-with-warning default.** Matches user expectations from built-in templates. Provide `--overwrite`, `--fail-on-conflict`, and `--dry-run` opts for CI flexibility.

5. **Document with worked examples.** Two examples: minimal (bug-repro-starter: one skill + ceremony) and full (aks-feature-kanban: 4 agents, 3 ceremonies, 2 skills, 1 tool, 1 MCP, routing, seed issues). Concrete enough for F4 to copy-paste immediately.

**Downstream:** F5 will adopt squadapp as maximal bundle shape; F6 adds global registry on top; F7 uses JSON schema for CI validation. All three can proceed in parallel.

---

## W24 Close-Out

**Date:** 2026-05-16  
**Status:** Completed

### Summary

McManus delivered F5 — spec gap fixes + schema updates (commit ffdd71cb). Work was completed on disk, but agent session cleared before commit. Coordinator executed orphan-commit pass with proper co-author attribution.

### Lineage

- **Todo:** f5-spec-gaps
- **Commit:** ffdd71cb
- **Pattern:** Orphan completion (silent success / agent runtime eviction)

### Notes

Part of the three-agent L/F pattern in W24. All three (Hockney/Kobayashi/McManus) completed work before session eviction, and coordinator handled uniformly.
