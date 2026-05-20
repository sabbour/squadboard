## W29 — Route Wiring + Ceremonies Expansion

**Date:** 2026-05-16  
**Wave:** 29  
**Status:** Completed


### 

### Lessons

1. **Optional params cascade through type signatures.** Making `agentId` optional required updates in controller → service → coordinator dispatch chain. Always trace impact through full call stack.

---


## 

## W23 Lesson — Fluent Icon Sweep at Scale

**Date:** 2026-05-16  
**Wave:** 23  

**UI — Fluent icon sweep (Ahmed 2026-05-16 directive): 106 glyphs → Fluent icons across 41 files.** Pattern: 40-entry systematic mapping table established (✓→Checkmark, ✗→Dismiss, ⚠→Warning, etc.). Structural changes (Pill icon prop, KIND_ICON maps, SVG text fallback). Keep the mapping table for re-use.

**Takeaway:** React components can't go in JSX-incompatible props (Badge text, Dropdown Option, toast strings). SVG `<text>` requires unicode outside emoji ranges. Always run grep to verify zero violations post-sweep. Document exceptions (markdown, tests) explicitly.



---


## 

### Summary

Keyser delivered W24 UX feature set: Conjure↔Consult re-swap + collapsible left navigation. Multiple commits (6cd1ae15, 55b4383f, 0f6315f9). Self-committed with proper co-author attribution. Build verified green before commit.


### 

### Build Status

✓ Green (tsc + vite, 7.05s, zero type errors)


### 

## Compaction Note

This history file exceeds 15KB. Older waves (W1–W20) are archived in `.squad/decisions.md`.
Current focus: W21–W24. For earlier context, search `.squad/decisions.md` by wave number.

---


## 

### Conjure/Consult Re-Swap — Pattern

This is the **2nd correction in 3 waves** (W22 put Conjure in the top bar; W24 reverts it to Consult). What would have prevented it:

1. **Read the most recent directive in `decisions/inbox/` BEFORE reading the spec.** W22 correctly followed the spec at the time. W24 is a product decision, not a spec violation. No amount of spec-reading would have caught it — only reading the latest human directive would have.
2. **Treat top-bar buttons as product-level decisions, not dev-level layout.** Before changing any top-bar button (add/remove/relabel), re-read the last 3 directives in `decisions/inbox/` regardless of what the spec says.
3. **Checklist for Conjure/Consult entry-point changes:** (a) re-read canonical Conjure spec at `decisions-archive.md` lines 1666–1960; (b) read the most recent directive in `decisions/inbox/`; (c) verify Board FAB, keyboard shortcuts, and ConjureModal are untouched.


### 

## W25 — Collapsed Nav Regression Fix (commit f5d03f4f)

**Date:** 2026-05-16  
**Wave:** 25


### 

### Bug 2 — NavItems not clickable in collapsed mode ⚠️ (CRITICAL LESSON)

**Root cause:** `<NavItem icon={...} value="..." />` with no children renders no inner button/link DOM element. Fluent UI's `NavItem` uses its children as the click target. Without children, the component renders an orphaned icon with no interactive wrapper — clicks never reach `onNavItemSelect`.

**The broken W24 pattern:**
```tsx
<Tooltip content="Projects" relationship="label" positioning="after" hideDelay={0}>
  <NavItem icon={<Home24Regular />} value="projects" />
</Tooltip>
```
`Tooltip relationship="label"` only wires up `aria-labelledby`. It does NOT add a click target. This pattern silently killed every collapsed nav click.

**Fix — Option A (hidden span):** Always render children, hide text with CSS:
```tsx
<NavItem icon={<Home24Regular />} value="projects">
  <span className={styles.navLabelHidden}>Projects</span>
</NavItem>
```
`navLabelHidden: { display: 'none' }` in makeStyles. The span keeps the click target alive in the DOM; CSS suppresses the visible text. Selected state, tooltips, and keyboard nav all still work.


### 

## W25 Close-Out

**Date:** 2026-05-16

Shipped W25 collapsible-nav regression fix. Two bugs:
1. NavItems in collapsed mode had no DOM click targets (fixed with hidden span children).
2. Collapse toggle was center-aligned instead of right-aligned in expanded state (fixed with `navCollapseToggleExpanded` style).

**Commit:** f5d03f4f

See `.squad/decisions.md` for full details.

---


## 

### Bug 1 (P0) — Routing tab crash

**Root cause (two paths):**
1. API returning non-array (e.g. `{ error: "..." }` with HTTP 200) → `entries.map is not a function`
2. `entry.score` arriving as a string from the server → `entry.score.toFixed is not a function`

**Fix pattern:**
- `RoutingLogTable`: `Array.isArray(entries)` guard; `typeof entry.score === 'number'` check.
- `Agents.tsx`: Added `RoutingErrorBoundary` class component (React class component for error boundary, matching existing `CheckCardErrorBoundary` in Diagnostics.tsx). Wraps the entire routing tab — future crashes show inline error + Retry instead of crashing the app.

**Lesson:** When the server might return `200 OK` with an error object instead of the typed array, React Query treats it as valid data. Defensive `Array.isArray` in list components is always warranted when `refetchInterval` is active.


### 

### Bug 3 — "Investigate in Conjure" dead button

**Fix:** Remove the entire Menu/overflow block from CardDetail panel header. When the only MenuItem in a Menu is dead, remove the whole Menu — don't leave a "..." trigger that does nothing.

**Lesson:** Dead action buttons should be removed immediately, not hidden or disabled. `navigate()` to a route that doesn't work is a silent failure that confuses users.


### 

## W26 — Run Button Regression Fix (post-batch-1)

**Date:** 2026-05-16  
**Wave:** 26


### 

### Fix

`RunButton.tsx`:
- `data-testid="task-run-button"` added.
- `cursor` and `opacity` styles now include `startRun.isPending` in the condition.
- Button text changes to `Starting…` while pending (was `▶ Run` even when disabled).
- Background dims slightly while pending for visual affordance.


### 

### Lesson

When visual feedback depends on an incidental side-effect of a bug (panel opening because Run was inside the onOpen wrapper), fixing the bug removes that feedback. Always audit every interactive element for its OWN visual confirmation path — don't rely on ambient side-effects to signal state changes.

---


## 

## W26 Learning 2: Error Boundary for Non-Array Data

**Date:** 2026-05-16  
**Commit:** 53cba6eb

RoutingLogTable crashed on `entries.map` when server returned non-array (e.g., `{ error: "..." }`). Also crashed on `entry.score.toFixed(2)` when score was a string. Fixes: (a) guard with `!Array.isArray(entries) || entries.length === 0`, (b) type-check score before `.toFixed()`, (c) wrap entire routing section with ErrorBoundary. Pattern: defensive rendering for tables + ErrorBoundary escape hatch prevents app-wide crashes from malformed API responses.

**Pattern:** Assume server data can be malformed. Type-check before calling methods. Use ErrorBoundary for data-intensive sections.

## 

### Summary

Keyser delivered W24 UX feature set: Conjure↔Consult re-swap + collapsible left navigation. Multiple commits (6cd1ae15, 55b4383f, 0f6315f9). Self-committed with proper co-author attribution. Build verified green before commit.


### 

### Build Status

✓ Green (tsc + vite, 7.05s, zero type errors)


### 


---

## Sync Status UI Proposal — 2026-05-19

Keyser audited Settings, ProjectPicker, Agents, project/squad API hooks, and setup scaffolding for cross-surface sync status. Decision: no visible status panel until backend exposes evidence-backed `GET /api/projects/:projectId/squad-sync/status` and `POST /api/projects/:projectId/squad-sync/repair`. Added frontend-ready TypeScript contract in `packages/client/src/api/squad.ts` so the future Settings → Sync status panel can cover source of truth, storage mode/runtime, governance projections, ceremonies defaults, drift, and repair availability without guessing.

---

## Pre-alpha README Copy Fix — 2026-05-19

After Kujan rejected final release sign-off for an unsafe public maturity label, Keyser independently revised the remaining README wording from `Alpha caution` to `Pre-alpha caution`. Focused scan confirmed README maturity references now use pre-alpha wording; no standalone public `alpha` warning remains in README.

---

## Cross-surface sync status UI — 2026-05-19T21:58:16.699-07:00

Implemented Settings → Team Sync as the project-level status surface for Squadboard ↔ CLI/Copilot interchangeability. Lesson: Hockney's route returns both a product API envelope (`authority`, `drift`, `repair.actions`) and legacy/SDK contract concepts, so the frontend panel should normalize evidence before rendering rather than bind copy directly to one backend shape.

---

## W30 — Delete Error UX (2026-05-19T23:37:54.700-07:00)

**Problem:** Danger Zone delete modal displayed raw HTML/stack fragments from a backend 500 (`text/html` response) inside the `<Caption1>` error label — the full `First 200 chars: <!DOCTYPE html>...` string leaked into the UI.

**Root cause:** `apiFetch` included the raw response body (up to 200 chars) in the thrown `Error.message` for non-JSON responses. `DangerZoneSection.onError` passed `e.message` directly to `setError`, which rendered it verbatim.

**Fix:**
1. `packages/client/src/api/client.ts` — extracted `nonJsonErrorMessage()` helper: logs raw body to `console.error`, throws a clean human message ("Server error (500) — …" or "Request failed (N) — …"). Structured JSON error path unchanged.
2. `packages/client/src/pages/Settings.tsx` — added `sanitizeApiError()` safety-net helper that strips HTML tags if any ever leak through; wired `console.error` into `onError` so full context is still visible in devtools.
3. Added 7-test regression file at `packages/client/src/api/__tests__/apiFetch.errors.test.ts`. All pass; typecheck clean.

**Learnings:**
- Never include raw response bodies in user-facing Error messages — log them, don't surface them.
- Defence in depth: fix at the API layer AND add a sanitization safety net at the render layer.
- `vi.stubGlobal('fetch', mock)` is the idiomatic way to mock `fetch` in Vitest (no `global.fetch` assignment needed — avoids TS errors under strict mode).

---

## UI Critical Crash Sweep — 2026-05-20

Learning: keep client-side agent safety in `components/agents/agent-origin.ts`; underscore-prefixed `.squad/agents/*` folders are housekeeping/internal and must render read-only even if a stale DB row reaches the frontend. Shared skill provenance copy now lives in `utils/skill-provenance.ts` so Skills and AgentCapabilities stay consistent.

---

## Project index persistence — 2026-05-20

Learning: browser-local UI preferences belong in `packages/client/src/utils/userPrefs.ts` under the existing `squadboard:prefs` localStorage key. Persist index search/filter/sort there, but keep transient selections in page state so bulk-selection behavior resets safely after refresh.

---

## Learnings

### Sync export preview UX — 2026-05-20T04:16:33.702-07:00

- `packages/client/src/components/settings/SquadSyncStatusPanel.tsx`: dry-run `unchanged` / `already_up_to_date` rows are no-op evidence, not preview detail. Hide those paths and summarize the count so meaningful `would-apply` / `failed` changes stay prominent.
- `packages/client/src/components/settings/__tests__/SquadSyncStatusPanel.test.tsx`: for DB-backed projects without a live filesystem mirror, assert against provider/env-var jargon at the panel level and describe Preview Export as an explicit filesystem handoff.

---

## Built-in ceremony Validate fix — 2026-05-20

**Bug:** Clicking Validate on the built-in "Work Pickup" ceremony returned 2 simultaneous errors — `'name' is required and must be a string` AND `'steps' is required and must be a non-empty array`.

**Root cause:** `normalizeWorkflowDocument` in `workflow-parser.ts` gated the canonical detection on `isRecord(doc['spec'])`. If the client ever emits `spec:` with no child content (js-yaml parses that as `spec: null`), the condition fails and the legacy path is taken. The legacy path finds no top-level `name` or `steps` keys (those are under `metadata` and `spec` in canonical YAML), so BOTH errors fire simultaneously.

**Fix:** Removed `&& isRecord(doc['spec'])` from the canonical detection condition. The canonical branch is now triggered solely by `apiVersion === 'squad.io/v1' && kind === 'Ceremony'`. `spec` defaults to `{}` if it is not a record, so name is extracted from `metadata.displayName` (which always passes) and steps correctly resolves to missing/empty.

**Learnings:**
- When a canonical document format has `apiVersion/kind` discriminators, canonical detection should be based on those alone — not on nested fields that could be null.
- A guard like `isRecord(spec)` seems safe but creates a hidden fallthrough: canonical YAML with a null/missing `spec` silently becomes legacy YAML, and BOTH top-level fields fail because neither `name` nor `steps` exist at the legacy flat level.
- Always add an edge-case test for `spec: null` (empty mapping block) when any nested field is part of a conditional canonical-detection path.

---

## Deep Frontend Code Review — 2026-05-20

Full audit of `packages/client/src/` (130+ files). Findings written to `.squad/decisions/inbox/keyser-deep-review-frontend.md`.

### Learnings

- **Zero code splitting.** All 26 page routes are synchronously imported in `App.tsx`. No `React.lazy` usage anywhere. This is the single biggest perf debt — every user downloads every page.
- **Zero `React.memo`.** Not a single component is memoized. High-frequency list items (`IssueCard`, `KanbanColumn`, `ChatBubble`) re-render on every parent state change.
- **Timer cleanup pattern is inconsistent.** ~15 `setTimeout` calls across pages/components lack ref-based cleanup. Most are cosmetic (flash resets), but `usePresence` debounce timer is a real leak that fires after unmount.
- **`null as unknown as T` in `apiFetch`.** Returns null cast as the expected type for 204/empty responses. Every caller that doesn't guard for null will crash at runtime. This is a systemic typing lie.
- **Unvalidated external `href` props.** 6+ locations render API-sourced URLs directly in `<a href>` / `<Link href>` without `https://` protocol validation. XSS vector if API data is ever poisoned.
- **Dead pages exist.** `LiveSession.tsx` and `StarterDetail.tsx` are defined but never imported or routed. They inflate the bundle and confuse contributors.
- **Index-based keys widespread.** 15+ list renders use `key={i}` or `key={index}`. Most are in stable-order lists (low risk), but `KanbanBoard` column keys and `CeremonyEditor` step keys can cause state bleed on reorder.
- **`as unknown` casts on WS/SSE payloads.** Realtime event handlers cast raw server data directly to typed interfaces without runtime validation. A malformed server message will silently corrupt React state.
