# Decision: Ceremony Pages — Fluent2 Redesign

**Author:** Fenster (UX Designer)  
**Date:** 2026-05-15T10:18:00.000-07:00  
**Wave:** fenster-4 (retry after fenster-3 API timeout)  
**Pages affected:** `/projects/:id/ceremonies` + `/projects/:id/ceremonies/new`

---

## Pattern chosen for Create flow: Pattern A (Conjure-first)

**Rationale:** The user complaint was "too busy". Pattern A removes the intro callout, collapses trigger selection to a single `Dropdown + Field` (saves ~150px of radio cards), and hides all advanced metadata behind an `Accordion`. The Formulate hero card IS the intro — no redundant text above it. The manual structured form is hidden behind a subtle "or build it manually →" toggle and auto-expands after Formulate fires.

---

## Badge color mapping (canonical — follow for Schedules page and any future list)

| Category | Value            | appearance  | color         |
|----------|------------------|-------------|---------------|
| Trigger  | `manual`         | `outline`   | `subtle`      |
| Trigger  | `on_issue_entry` | `filled`    | `brand`       |
| Trigger  | `on_event`       | `filled`    | `brand`       |
| Trigger  | `on_schedule`    | `filled`    | `informative` |
| Kind     | `narrative`      | `outline`   | `success`     |
| Kind     | `workflow`       | `outline`   | `warning`     |
| Kind     | `review_policy`  | `outline`   | `severe`      |
| Kind     | `ceremony`       | `outline`   | `subtle`      |

---

## "Advanced" Accordion contents (create mode)

The `Accordion` item titled **"Advanced"** contains:
1. **Description** — `Textarea`, optional, shown in ceremony list
2. **Kind** — `Dropdown` (`workflow` / `ceremony` / `review_policy` / `narrative`), helper text: "Use workflow for most automations. narrative is documentation-only."

---

## Small reusable mini-components extracted

| Component | Path | Purpose |
|-----------|------|---------|
| `TriggerBadge` | `packages/client/src/components/ceremony/CeremonyBadges.tsx` | Renders trigger kind as Fluent Badge with canonical color |
| `KindBadge`    | `packages/client/src/components/ceremony/CeremonyBadges.tsx` | Renders ceremony kind as Fluent Badge with canonical color |

Both are reusable in any future list page (Schedules, Runs log, etc.).

---

## What was changed

### CeremonyList.tsx
- Replaced hand-rolled `<table>` + plain `<h1>` with Fluent2 `DataGrid` + `PageHeader`
- Added `TriggerBadge` and `KindBadge` to Trigger and Kind columns
- `Created` column: `safeRelativeTime` + `Tooltip` showing absolute date
- Toolbar: `Review drafts` subtle button + `CounterBadge` + `+ New ceremony` primary button
- Empty state: centred card with CTA
- Background: `tokens.colorNeutralBackground1`, all spacing via Fluent tokens

### CeremonyEditor.tsx (/new route)
- Removed dismissable intro callout entirely
- Formulate hero card is now the only top-level element in create mode
- "or build it manually →" subtle button reveals the structured form
- Trigger: `RadioGroup` with 4 stacked cards → `Dropdown` inside `Field` (description as `hint`)
- Metadata (description + kind): collapsed inside `Accordion` titled "Advanced"
- `Create` button disabled until name differs from "New Ceremony"
- After Formulate fires: structured form auto-expands with populated values
- Edit mode unchanged: compact header + split left/right pane layout
- Fixed unclosed `<>` JSX fragment (root cause of TypeScript errors)
- Removed unused `Dismiss16Regular` icon import

---

## TypeScript

`npx tsc --noEmit` — clean, zero errors.
