# Decision: Standard "create" page pattern for Squadboard

**Date:** 2026-05-15  
**Author:** Kobayashi (Squad SDK Integrator)  
**Status:** Adopted  
**Reference:** `feat(ceremonies): Conjure entrypoint + first-time-friendly create UX`

---

## Decision

Every "create" page in Squadboard should follow the pattern established in `CeremonyEditor.tsx`'s create-mode rendering. This pattern makes every new-artifact flow approachable for first-time users while keeping the power-user edit surface unchanged.

### The pattern (5 elements)

1. **`<PageHeader title="New <artifact>" description="…" />`**  
   Replace any bespoke header with the canonical `PageHeader` component. Title = "New <artifact>". Description = one sentence explaining what this artifact is for. Actions = back button + primary create button.

2. **Dismissible intro card**  
   A Fluent2 `<Card>` immediately below the PageHeader. `<Body1>` text explains what the artifact is and when to use it. A `<Dismiss16Regular>` button in the top-right corner persists the dismissal in `localStorage` with key `squadboard.<artifactType>.introDismissed`.

3. **Formulate / Conjure entrypoint at the top**  
   `<FormulatePanel>` mounted above the form body. The `onFormulate` callback calls the relevant `generate-from-prose` or `formulate` endpoint, populates all form fields, and switches to a review tab (Visual, Preview, etc.) so the user immediately sees the AI draft.

4. **Labeled pickers with one-line descriptions**  
   For any enum/kind/type picker, prefer `<RadioGroup>` with `label={`${technicalName} — ${humanDescription}`}` over a plain `<Dropdown>`. For step/action kinds, use a grouped `<Dropdown>` with descriptions inline; collapse less-common options under an "Advanced" divider.

5. **Sensible defaults on create**  
   Pre-populate the most common values so the user can click "Create" immediately without changing anything. Document the defaults in a comment above the `useState` initializations.

### What stays unchanged in edit mode

The edit-mode surface (existing artifact, `ceremonyId` is set) should NOT include the PageHeader, intro card, or Formulate panel. These are first-time affordances. The existing compact header with badges, validate, run, and save buttons is the right edit-mode experience.

---

## Applicability to future create pages

This pattern should be applied to the following create pages (where not already done):

| Page | Status |
|------|--------|
| `CeremonyEditor.tsx` (new ceremony) | ✅ Done (2026-05-15) |
| New skill | Apply pattern |
| New tool | Apply pattern |
| New MCP server | Apply pattern |
| New agent (HireAgent dialog) | Partial — has FormulatePanel; add intro card + PageHeader |
| New team (HireTeam dialog) | Partial — has FormulatePanel; add intro card + PageHeader |

---

## Rationale

- Users landing on a blank create form with no framing have no idea what the artifact is, which fields are required, or what a sensible starting point looks like.
- The Conjure / Formulate entrypoint reduces time-to-first-success from "navigate docs + fill form" to "type a sentence + review draft".
- The intro card gives just enough context without being a wall of text — it's also dismissible so power users don't see it every time.
- Using `RadioGroup` with descriptions instead of raw-enum `Dropdown` means users can make an informed choice without looking up documentation.
- Sensible defaults mean users can always click "Create" immediately and refine later.
