# Keyser W22 — ConjureModal: Real Implementation + Consult Label Restoration

**Author:** Keyser (UI/UX)  
**Date:** 2026-05-16  
**Wave:** 22  
**Branch:** keyser/w17-settings-backup-github  
**Commits:** `92a6cb4f`, `44b0176f`

---

## Summary

Three waves of agents (W10–W21) misdiagnosed Conjure as a label problem on the Consult surface. Ahmed course-corrected in W22: Conjure is a **NEW modal**, not a renamed Consult entry point. This decision doc records what Keyser built to fix that.

---

## Verbatim Spec Quotes (from `.squad/decisions-archive.md` lines 1666–1960)

1. **Line 1693–1694 (Naming/Icon):**
   > "Keyboard shortcut stays `c`."  
   > `Import: import { Wand20Regular } from '@fluentui/react-icons'`

2. **Lines 1811–1814 (Routing — Hybrid Option C):**
   > "**In-place (light):** issue, inbox-item, consult, label (if ever added).  
   > **Navigate (heavy):** project, team, agent, skill, tool, ceremony, mcp-server."

3. **Lines 1818–1820 (Draft survival):**
   > "Context loss is mitigated: the draft is stashed in `sessionStorage` keyed by a unique formulation ID. If the user hits Back, the draft survives. The Conjure modal also shows a 'Navigating to [Agent Creator]…' toast with an undo link (3s window)."

---

## Files Changed

| File | Change |
|------|--------|
| `packages/client/src/components/conjure/ConjureModal.tsx` | **NEW** — full modal implementation |
| `packages/client/src/context/ConjureContext.tsx` | **NEW** — React context for hoisted modal state |
| `packages/client/src/components/Layout.tsx` | Restore "Consult" nav label; rewire Conjure button + `c`/`?`/Ctrl+K to open modal; add `<ConjureModal>` instance + `<ConjureProvider>` |
| `packages/client/src/pages/Board.tsx` | FAB opens `ConjureModal` with `hint="issue"` (replaces navigate-to-consult) |
| `packages/client/src/pages/Inbox.tsx` | "Open in Conjure" button opens `ConjureModal` with `initialProse` set (replaces navigate-to-consult) |

---

## Label Restorations Done

- **Nav item**: `"Conjure"` → `"Consult"` (it navigates to `/consult/new` as always — that's the Consult surface)
- **Top-bar button**: stays labeled `"Conjure"` but now opens `ConjureModal` (with `Wand20Regular` icon per spec) instead of navigating
- **Tooltip**: updated from `"Conjure (press c, ? or Ctrl+K)"` to `"Conjure anything (c, ? or Ctrl+K)"`
- **Keyboard shortcuts** (`c`, `?`, `Ctrl/Cmd+K`): all three now open `ConjureModal`, not navigate to `/consult/new`

---

## Modal Behavior Shipped

### Input
- `<Textarea>` with auto-focus and natural language placeholder
- `Ctrl+Enter` submits from within the textarea

### Classification pipeline
1. **Heuristic fast-path** (no network): `bug:` / `fix:` / `task:` → issue (0.95); `hire ` / `recruit ` → agent/team (0.92); `project:` / `new project` → project (0.95). Fires if confidence ≥ 0.9.
2. **Server classify** (`POST /api/conjure/classify` with `{ prompt, hint?, context? }`): returns winner + `routing.fallbacks`. Supports future Verbal-w22 `candidates` array too.
3. Top-3 candidate chips shown after classification. Most confident chip auto-selected.

### Routing
- **Light** (`issue`, `inbox-item`, `consult`): create in-place or navigate to consult/new with prose pre-filled. Close modal + success toast.
- **Heavy** (`project`, `team`, `agent`, `skill`, `tool`, `ceremony`, `mcp-server`): stash draft in `sessionStorage` keyed by `conjure-draft-<uuid>` → navigate → 3s undo toast.
- `hint="issue"` on Board FAB biases the modal (auto-selects the chip, skips API if heuristic matches).

---

## Entry Points Wired

| Trigger | Before W22 | After W22 |
|---------|-----------|-----------|
| Top-bar "Conjure" button | Navigate to `/consult/new` | Opens `ConjureModal` |
| `c` key | Navigate to `/consult/new` | Opens `ConjureModal` |
| `?` key | Navigate to `/consult/new` | Opens `ConjureModal` |
| `Ctrl/Cmd+K` | Navigate to `/consult/new` | Opens `ConjureModal` |
| Board FAB | Navigate to `/consult/new` | Opens `ConjureModal` with `hint="issue"` |
| Inbox "Open in Conjure" | Navigate to `/consult/new?prefill=...` | Opens `ConjureModal` with `initialProse` set |

---

## Architecture Decisions

1. **React Context over Zustand**: Zustand is not in the dependency tree. Used `ConjureContext.tsx` with a simple `useState` inside `ConjureProvider`. Hoisted into `Layout.tsx` so the modal is a singleton.

2. **Server field name**: Server uses `prompt` (not `prose` as the spec uses). Client adapts silently.

3. **Candidates from server**: Current server (`classifyAndDraft`) returns `{ intent, confidence, draft, routing: { fallbacks } }` — no top-3 `candidates` array yet (that's Verbal-w22's job). Client builds candidates from `winner + fallbacks` as a graceful fallback. When Verbal-w22 ships the `candidates` array, the modal picks it up automatically.

4. **ConjureIntent type**: Client defines a broader 10-kind type (`project | issue | team | agent | skill | tool | inbox-item | consult | ceremony | mcp-server`) even though the server currently only classifies 6. The extra 4 kinds are ready for Verbal-w22's extension.

---

## Screenshots (by description — no browser available)

1. **ConjureModal open**: Fluent 2 Dialog with `Wand20Regular` icon in title, textarea placeholder, and "Classify" primary action button.
2. **After classification**: Three candidate chips appear (e.g. "Issue · 87%", "Agent", "Project"), most confident pre-selected. Primary button changes to "Create Issue".
3. **Nav sidebar**: "Consult" (ChatHelp24Regular) navigates to the Consult chat surface. "Conjure" is only in the top-bar button.
4. **Board FAB**: `Wand20Regular` icon (was ChatHelp24Regular). Clicking opens ConjureModal pre-biased to issue.

---

## Known Limitations / Follow-ups

1. **No `label` field** in the top-bar "Conjure" button per Fluent 2 Button pattern — this is intentional since the label IS "Conjure"; just using the wand icon differentiation.
2. **`consult` routing**: Currently classified as "light" — navigates to `/consult/new?prefill=...`. This matches the spec's intent even though it's technically a navigation.
3. **`inbox-item` without projectId**: Falls back to creating an inbox item without a project (uses `suggestedProjectId: null`). Acceptable for v1.
4. **Verbal-w22 coordination needed**: When Verbal-w22 ships `candidates` array from `/api/conjure/classify`, the modal will automatically use it (the `if (d.candidates && d.candidates.length > 0)` branch).
5. **Auto-select after 5s**: Spec section 3 says "if user doesn't pick within 5s and confidence ≥ 0.5, auto-select top candidate but keep chip bar visible." Not implemented in v1 — follow-up task.
6. **Keyboard a11y for chips**: Arrow key navigation on candidate chips is not yet implemented. Open question from spec section 7. Filed as follow-up.
