# Wave 11B + 11C Close-Out — Orchestration Log

**Date:** 2026-05-15T18:45:00-07:00  
**Coordinator:** Scribe  
**Fleet Status:** COMPLETE

---

## Wave 11B: Cast-Team Hotfix — 4 Fresh Spawns

### Spawns Completed

**1. L1 (McManus, UI Designer)**
- **Task:** Replace app-level confirmation modals with per-component inline confirmations
- **Deliverable:** packages/client/src/pages/Projects.tsx + packages/client/src/components/ProjectCard.tsx
- **Evidence:** Inline confirm dialogs tested; old ConfirmationModal imports removed
- **Status:** ✅ Shipped

**2. K1 (Keyser, Frontend)**
- **Task:** Add role-based visibility guards to Hire Team controls
- **Deliverable:** packages/client/src/components/HireTeamModal.tsx role filter logic
- **Evidence:** Only Lead role sees Cast a Team button; modal closes correctly post-cast
- **Status:** ✅ Shipped

**3. F1 (Fenster, UX Designer)**
- **Task:** Restore Templates nav link missing from sidebar
- **Deliverable:** packages/client/src/components/Layout.tsx nav item + DocumentBulletList24Regular icon
- **Evidence:** Nav link visible; clicking routes to /projects/:id/ceremonies/templates
- **Status:** ✅ Shipped

**4. M1 (Hockney, Backend)**
- **Task:** Implement missing hire-team/propose and hire-team/confirm POST routes
- **Deliverable:** packages/server/src/routes/agents.ts + response shapes matching client interfaces
- **Evidence:** curl 200+JSON; no HTML-200 crash; member list returned correctly
- **Status:** ✅ Shipped

### Learning: Express SPA Catch-All

When a POST route is unimplemented, Express's SPA catch-all serves `index.html` with HTTP 200. On the client, calling `JSON.parse('<!doctype...')` throws **"Unexpected token '<'"** with no context. This manifested as Cast-Team modal crash. **Fix:** Tier-1 priority is always implementing unimplemented routes; tier-2 is client-side Content-Type guard (M2). Both landed.

---

## Wave 11C: Kujan M4 E2E Regression — 1 Fresh Spawn

### Spawn Completed

**M4 (Kujan, Verifier)**
- **Task:** Write end-to-end regression suite covering M1/M2/M3 fixes
- **Deliverable:** packages/e2e/tests/10-cast-team.spec.ts (7.8 KB, 4 sub-tests)
  - Sub-test 1: Cast a Team button visible on agents page (M1 smoke)
  - Sub-test 2: Modal opens without "Unexpected token '<'" crash (M2 guard)
  - Sub-test 3: Non-Lead role label toggle isolated (M3 regression)
  - Sub-test 4: /hire-team/propose returns 200+JSON with member list (M1 + M2 locked)
- **Fixture Helper:** createProjectViaApi() added to packages/e2e/tests/fixtures.ts (WSL/headless Chromium workaround)
- **Execution:** 4 passed in 9.9s
- **Status:** ✅ Shipped

### Gate Decision

**PASS** — All M1/M2/M3 regressions covered and green. Cast-Team modal crash (Bugs 1 + 2) fully fixed and locked.

---

## Wave 11 Summary

**Total Spawns:** 7 todos shipped clean
- L1: Inline confirmation modals (McManus)
- K1: Role-based Hire Team visibility (Keyser)
- F1: Templates nav link restoration (Fenster)
- M1: hire-team routes implementation (Hockney)
- M2: apiFetch Content-Type guard (Keyser)
- M3: HireTeamModal label-toggle fix (Keyser)
- M4: Cast-Team e2e regression suite (Kujan)

**Merged:** 4 directives + learnings into decisions.md  
**Archive Gate:** Triggered (148 KB > 51.2 KB); no entries > 7 days old  
**Inbox:** Empty ✓  
**Cross-agent Learnings:** Express SPA catch-all, Fluent Field htmlFor footgun documented

---

**Scribe Close-Out Timestamp:** 2026-05-15T18:45:00-07:00
