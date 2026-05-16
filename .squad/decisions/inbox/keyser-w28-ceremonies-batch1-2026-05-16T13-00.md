# Decision: W28 CER-1 + CER-8 — Ceremony Origin/Provenance Badges + Audit Endpoint

**Agent:** Keyser (UI + design)  
**Wave:** W28  
**Timestamp:** 2026-05-16T13:00Z  
**Status:** SHIPPED — merged to main

---

## What shipped

### CER-1 — Ceremony Origin & Provenance

**Origin derivation strategy (no schema changes):**
- Used a derived-field approach via `packages/server/src/services/ceremony-origin.ts`
- Signal hierarchy (most-specific → fallback):
  1. `templateId` non-null → `built-in` (reserved for CER-2; no built-in ceremonies in DB today)
  2. `sourceYamlPath` non-null → `yaml-import` (reserved for future yaml-import feature)
  3. `parentNarrativeId` non-null → `conjure-llm` (active signal: set by Conjure/Formulate flow)
  4. Fallback → `user-created`
- `origin` is computed server-side and returned as a computed field on all ceremony GET responses (list + detail). No DB write, no migration.

**UI changes:**
- Added `OriginBadge` component to `CeremonyBadges.tsx` (Fluent2 Badge)
- Added "Origin" column to `CeremonyList.tsx` DataGrid (between Name and Trigger)
- Added "Origin" read-only field in `CeremonyEditor.tsx` metadata section (only shown for existing ceremonies)
- Added `CeremonyOrigin` type to `api/ceremonies.ts`

### CER-8 — Ceremony Audit Endpoint + Diagnostics Page

**Endpoint:** `GET /api/projects/:projectId/ceremonies/audit`  
**Returns:** `{ total, byOrigin, byTrigger, byStatus, orphans[], dead[] }`  
**Orphan detection:** `status=active` + zero runs in last 30 days  
**Dead detection:**
- `on_event` trigger with `eventType` starting with `github.` or `gh.` but project has `githubSyncEnabled=false` or no `githubOwner`/`githubRepo`
- `on_schedule` trigger with no enabled `ceremonySchedules` row

**New page:** `packages/client/src/pages/CeremonyAudit.tsx` at route `/projects/:id/ceremonies/audit`  
**Link:** "Audit" button in CeremonyList toolbar (subtle, with ChartMultiple icon)

---

## Files changed

| File | Change |
|------|--------|
| `packages/server/src/services/ceremony-origin.ts` | NEW — derivation logic |
| `packages/server/src/routes/ceremonies.ts` | GET / and GET /:id attach `origin`; new GET /audit endpoint |
| `packages/server/src/__tests__/ceremony-origin.test.ts` | NEW — 10 tests |
| `packages/server/src/__tests__/ceremony-audit.test.ts` | NEW — 13 tests |
| `packages/client/src/api/ceremonies.ts` | `CeremonyOrigin` type, `origin` field on `Ceremony`, `useCeremonyAudit` hook |
| `packages/client/src/components/ceremony/CeremonyBadges.tsx` | `OriginBadge` component |
| `packages/client/src/pages/CeremonyList.tsx` | Origin column + Audit button |
| `packages/client/src/pages/CeremonyEditor.tsx` | Origin field in metadata section |
| `packages/client/src/pages/CeremonyAudit.tsx` | NEW — diagnostics page |
| `packages/client/src/App.tsx` | `/ceremonies/audit` route added |
| `packages/client/src/pages/__tests__/CeremonyList.test.tsx` | NEW — 7 tests |
| `packages/client/src/pages/__tests__/CeremonyAudit.test.tsx` | NEW — 16 tests |

---

## Surprising findings about the ceremonies data model

1. **All current ceremonies are `user-created`.** Since `parentNarrativeId` is null for all manually authored ceremonies and there are no built-in seeded ceremonies (CER-2 not yet shipped), every ceremony in any live project will show "User" origin until CER-2 ships.

2. **`parentNarrativeId` is the only active provenance signal.** The schema has no `template_id`, `source_yaml_path`, or `created_via_conjure` column. The `parentNarrativeId` column (added Phase 11) is the only column that encodes creation provenance.

3. **Conjure flow always sets `parentNarrativeId`.** When the Conjure/Formulate prose→YAML flow runs, it creates a `kind='narrative'` parent row and links the translated ceremony back via `parentNarrativeId`. This makes Conjure-generated ceremonies cleanly detectable.

4. **Orphan list includes ALL active ceremonies on fresh projects.** A project with active ceremonies that have never run will show them all as orphans. This is correct behavior (they've never fired) but may be noisy on new installations. The team should filter by ceremony age if needed.

5. **Dead detection for `on_schedule` is conservative.** A scheduled ceremony with no `ceremonySchedules` row is marked dead. This correctly catches ceremonies that were set to `on_schedule` trigger but never had a schedule configured.

---

## Test delta

- Server: +23 tests (10 origin, 13 audit)
- Client: +23 tests (7 CeremonyList, 16 CeremonyAudit)
- **Total new tests: 46**

## Schema changes

None. CER-3 (schema migration) deferred as directed.
