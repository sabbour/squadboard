# Decision: Conjure UX Design — Replace Capture

**Author:** Fenster (UX Designer)  
**Date:** 2026-05-15  
**Status:** Ratified — ready for implementation

---

## Summary

Capture is replaced by **Conjure** — a smarter creation surface that classifies user intent and routes to the appropriate entity type (project, issue, team, agent, skill, or tool).

---

## Final Naming

| Surface | Old | New |
|---------|-----|-----|
| Button label | Capture | Conjure |
| FAB aria-label | "Quick capture" | "Conjure something new" |
| FAB tooltip | "Quick capture (press c)" | "Conjure (⌘K)" |
| Component | `CaptureFab.tsx` | `ConjureFab.tsx` |
| Component | `CaptureModal.tsx` | `ConjureModal.tsx` |
| Folder | `components/inbox/` | `components/conjure/` |

---

## Final Icon

**Icon:** `Sparkle20Regular` / `Sparkle24Regular`

**Why:** Already used in the codebase for AI/formulation actions. "Sparkle" connotes magic, intelligence, creation — aligns with Conjure semantics. Proven to work in `@fluentui/react-icons`.

---

## Keyboard Shortcut

**New:** `Cmd+K` / `Ctrl+K` (was `c`)

**Rationale:** Universal command palette shortcut (VS Code, Slack, Linear, Notion). `c` was a mnemonic for "capture" which no longer applies.

---

## Per-Intent Form Pattern

Each intent has a dedicated form with pre-filled fields from the backend classification:

| Intent | Key fields |
|--------|-----------|
| **project** | name, description, suggested first issues (checkboxes) |
| **issue** | title, description, project, labels, priority |
| **team** | universe, project type, suggested roles (checkboxes + counts) |
| **agent** | name slot, role, charter starter, model |
| **skill** | title, body, filename, confidence slider |
| **tool** | name, description, type (script/MCP), schema (JSON) |

User can override the classified intent by clicking fallback pills in the classification banner.

---

## Capture Deprecation Plan

1. **Inbox page stays read-only.** Existing inbox items remain viewable until published/discarded.
2. **No new inbox items.** Conjure creates target entities directly, not inbox drafts.
3. **Deprecation banner.** Inbox page shows: "Capture has been replaced by Conjure. These are your legacy drafts."
4. **Future cleanup.** Later release: "Discard all" or auto-archive after 30 days.

**No data migration required.** Inbox items are issue-draft-only artifacts; they don't transform into the new 6-intent model.

---

## Files Changed

| Action | File |
|--------|------|
| Rename | `inbox/CaptureFab.tsx` → `conjure/ConjureFab.tsx` |
| Rename | `inbox/CaptureModal.tsx` → `conjure/ConjureModal.tsx` |
| Create | `conjure/IntentForm.tsx` |
| Create | `conjure/ClassifyBanner.tsx` |
| Create | `conjure/useConjure.ts` |
| Modify | `Layout.tsx` (shortcut, import, button) |
| Modify | `pages/Inbox.tsx` (deprecation banner) |

---

## Spec Location

Full design spec: `.squad/agents/fenster/conjure-design.md`

---

## Implementation

Keyser implements. Hockney builds `POST /api/conjure/classify` and `POST /api/conjure/create`.
