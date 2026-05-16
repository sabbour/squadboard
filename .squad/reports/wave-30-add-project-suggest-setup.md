# Wave 30 — Add Project → Suggest Setup: UX Revisit

**Agent:** Verbal (UX / Research)  
**Wave:** 30  
**Date:** 2026-05-16T14:00:00Z  
**Lane:** `w30-revisit-add-project-suggest-setup-flow`  
**Status:** FILED

---

## Executive Summary

The "Suggest Setup" tab in the Add Project modal was shipped in Wave 20 (O1) as a
keyword-scanning stub with a placeholder comment: *"LLM call TBD by Verbal."*  Six
waves later, the stub is still in production and the UX has not been revisited.  The
top friction point is **discoverability and position**: the Suggest tab is the
rightmost (4th) of four tabs, making it invisible to new users who land on Discover
by default and rarely tab-browse.  A close second is the **opt-out gap**: once a user
reaches the suggestion preview there is no escape back to a blank slate — they must
either Apply, Customize (which hijacks the Create tab), or close the dialog entirely.

---

## Section 1 — Current State (Code-Grounded)

### 1.1 The Full Add Project Flow

The Add Project modal is a four-tab dialog (`DiscoveryModal`) in
`packages/client/src/pages/ProjectPicker.tsx` (lines 354–553).

Tabs, in render order:

| # | Tab key | Label | Purpose |
|---|---------|-------|---------|
| 1 | `discover` | Discover | Scan filesystem for existing `.squad/` directories |
| 2 | `connect` | Connect existing | Scaffold `.squad/` inside an existing project folder |
| 3 | `create` | Create new | Create a directory + `.squad/` scaffold from scratch |
| 4 | `suggest` | ✨ Suggest setup | Describe project → get bundle recommendation |

Default active tab: `discover` (line 362).

The Suggest tab renders `<SuggestTab>` (lines 766–1006).  Its internal flow:

1. User types a free-text description into a `<Textarea>` (≥1 character required).
2. User clicks **Suggest setup** — fires `POST /api/projects/suggest` via
   `useSuggestProjectSetup()` (a React Query mutation).
3. While pending, the button shows `<Spinner size="tiny" />` and is disabled.
4. On success, a preview card appears (aria-live="polite") showing:
   - Bundle name + matched keyword badges (info tint)
   - Team chips (outline badges: `Name · Role`)
   - Ceremony chips (outline badges: `Name (cadence)`)
   - Board column sequence (filled/subtle badges, numbered)
   - Starter skills (success tint badges)
5. Two action buttons inside the preview card:
   - **Apply suggestion** → shows an inline apply form (name + parent directory)
   - **Customize** → `setCreateName(suggestion.bundleName)` then `setActiveTab('create')`
6. The apply form (lines 946–1004) calls `useApplyBuiltinProjectTemplate()` with
   `{ bundleId, name, squadPath }` and navigates into the new project on success.

**Important structural note:** The `primaryAction` computed in `DiscoveryModal` only
covers the `connect` and `create` tabs (lines 436–452).  For the `suggest` tab,
`primaryAction` is `null`, which means the standard `DialogActions` footer renders
only **Cancel / Close** — the Suggest tab's CTA lives inside the scrollable body,
breaking the Fluent2 dialog action-row convention shared by every other tab.

### 1.2 API Contract

**Endpoint:** `POST /api/projects/suggest`  
**Auth:** None (same server-local trust model as all routes)  
**Request body:**
```json
{ "description": "string (free text, any length)" }
```
**Response:** `ProjectSuggestion`
```typescript
{
  bundleId:        string;   // e.g. "library-or-sdk-project"
  bundleName:      string;   // e.g. "Library / SDK Project"
  description:     string;   // human-readable bundle description
  team:            Array<{ name: string; role: string }>;
  ceremonies:      Array<{ name: string; cadence: string }>;
  columns:         Array<{ slug: string; label: string }>;
  skills:          string[];
  matchedKeywords: string[]; // subset of description tokens that triggered match
}
```
**Defined in:** `packages/server/src/routes/projects.ts` lines 8–35 (types) and
335–352 (route handler).

The route is registered before the `/:id` route (line 203+) so Express does not
swallow the literal string "suggest" as a project ID parameter.

### 1.3 What Suggestions the Server Can Emit

The server maintains a static `BUNDLE_TEMPLATES` object (lines 51–180) with **six
archetypes**:

| bundleId | bundleName | Trigger keywords (any match) |
|---|---|---|
| `library-or-sdk-project` | Library / SDK Project | rust, cargo, crate, npm, pypi, pip, gem, nuget, library, sdk, package, cli, command-line, module |
| `content-writing-project` | Content Writing Project | writing, blog, content, article, newsletter, editorial, copywriting, post, publication |
| `research-spike` | Research Spike | research, spike, analysis, explore, investigation, data, ml, machine learning, ai, experiment, python, jupyter, notebook |
| `ops-runbook-project` | Ops / Incident Runbook | ops, devops, infra, infrastructure, incident, runbook, sre, monitoring, cloud, kubernetes, k8s, docker, ci/cd, deployment |
| `bug-bash-project` | Bug Bash Project | bug, test, qa, quality, bash, regression, testing, validation |
| `default-software-project` | Default Software Project | node, express, react, next, typescript, javascript, web, api, http, rest, graphql, app, application, backend, frontend, go, golang, java, kotlin, swift, c#, dotnet, php, ruby, rails |

**Fallback:** If no keywords match, returns `default-software-project` with
`matchedKeywords: []`.

**Matching algorithm** (`detectBundle`, lines 192–200): lowercases the description,
iterates `KEYWORD_MAP` in priority order, returns on **first match** using
`Array.filter` (checks all keywords in the matched set).

### 1.4 Where the Data Comes From

The suggestion data is **entirely hard-coded** — no LLM, no database, no heuristics
derived from user data.  The route comment explicitly marks this:

> *"Static keyword-keyed stub.  Verbal can wire in an LLM call later."*
> — `packages/server/src/routes/projects.ts`, line 333

The `BUNDLE_TEMPLATES` are separate from (but intentionally aligned with) the
`bundles/` directory that powers `useBuiltinProjectTemplates()`.  The bundles
directory has **seven** entries:

```
bundles/
  aks-feature-kanban/          ← NOT in BUNDLE_TEMPLATES / KEYWORD_MAP
  bug-bash-project/
  content-writing-project/
  default-software-project/
  library-or-sdk-project/
  ops-runbook-project/
  research-spike/
```

**Gap:** `aks-feature-kanban` exists as a real bundle accessible via "Create from
template" but is unreachable through the Suggest Setup flow.  The keyword map has no
entry for it and `BUNDLE_TEMPLATES` does not define it.

---

## Section 2 — Friction Analysis (New-User POV)

Walk: a developer who has never used Squadboard opens the app, sees the empty state,
and clicks **Add Project** for the first time.

### 2.1 The Tab Order Buries the Most Helpful Path

The modal opens on **Discover**, which immediately offers a "Scan filesystem" button.
For a brand-new user with no existing `.squad/` directories, this scan will return
zero results — but the user does not know that.  They click "Scan filesystem", wait
for the result, get "No .squad/ directories found," and feel stuck.

The **Suggest setup** tab — which is the most guided, lowest-friction path for a
first-timer — is the last tab in the row and has no visual affordance beyond a
sparkle icon.  A user who has never seen the app has no reason to click it before
exhausting the other three tabs.

**Hesitation point:** New user reads "Discover" → "Connect existing" → "Create new"
as a linear checklist.  "Suggest setup" reads as optional/advanced, not as the
recommended starting point.

### 2.2 No Up-Front Explanation of What "Suggest Setup" Does

The tab body opens with a single `<Body1>` sentence:

> *"Describe what you're building and we'll recommend a team, ceremonies, and board
> setup."*

There is no example output, no preview thumbnail, no indication of what templates
exist, and no reassurance that the user can change anything later.  A user who does
not know what "ceremonies" or "board setup" means will hesitate.

**Hesitation point:** The user does not know what they are about to receive.  The
promise ("we'll recommend") is vague about the source (is it AI?  Is it canned?).

### 2.3 The Textarea Is a Cold-Start Blank Field

The placeholder text (`e.g. I'm building a CLI in Rust that helps developers manage…`)
is a single example of a well-formed, keyword-rich description.  Users with a
non-obvious project type (e.g., "planning my D&D campaign" or "tracking my
freelance invoices") will not know which words trigger a match.

If they type a description with no matching keywords, the server silently returns
`default-software-project` with `matchedKeywords: []`.  The preview card shows
"Default Software Project" and empty keyword badges — no indication that their input
was unrecognized and the system fell back.

**Hesitation point:** The user receives a generic suggestion with no feedback that
their description was not understood.  They may wonder: "Is this what I should
use?" or "Did I describe it wrong?"

### 2.4 No Opt-Out Once a Suggestion Appears

After clicking **Suggest setup** and receiving a suggestion, the user has three
choices:

1. **Apply suggestion** — commits to the bundle, opens the apply form.
2. **Customize** — switches to the Create tab with the bundle name pre-filled.
3. Close the dialog entirely.

There is no **"Start blank / Skip suggestion"** path.  "Customize" is labeled as
customization but actually abandons the suggestion and drops the user into the Create
tab, which asks for a parent directory with no carry-forward of the suggested team
or columns.  The bundleId is not passed to Create.

**Frustration point:** "Customize" does not customize the suggestion — it discards it.
A user who wants a blank project with custom columns but was curious about the
suggestion has to restart.

### 2.5 The Apply Form Has an Empty "Parent Directory" Field on First Use

The `applyPath` state in `SuggestTab` is initialized to `createParent` (line 783),
which is the same state as the Create tab.  The Create tab auto-fills `createParent`
from `GET /api/squad/home` (lines 382–389).  However:

- The home path is fetched asynchronously.
- The `applyPath` is captured at `useState(createParent)` mount time (line 783).
- If the home path has not resolved yet (race condition), or if the user reaches the
  Suggest tab before the Create tab ever mounts, `applyPath` starts empty.

A first-time user who goes straight to Suggest without ever visiting Create will see
an empty "Parent directory" field in the apply form and have to type an absolute path
from scratch.

**Frustration point:** The most common first-time path (Suggest → Apply) is
precisely the one where the home directory pre-fill is least reliable.

### 2.6 Action Buttons Live Inside the Scroll Area, Not in DialogActions

Every other tab (Connect, Create) puts its primary action in the shared
`<DialogActions>` footer row, which is always visible even when the dialog body
scrolls.  The Suggest tab puts "Apply suggestion" and "Customize" inside the
scrollable content area.

On a short viewport (laptop at 90% zoom, modal capped at `maxHeight: '80vh'`), the
action buttons may be below the fold after the suggestion preview card renders.  The
user has to scroll to find them.

**Frustration point:** Primary action not visible without scrolling — opposite of
Fluent2 best practice.

### 2.7 Projects That Do Not Match Any Archetype

A user building a hobby project, a wedding planner, a game, or a research notebook
has no archetype match.  They silently receive "Default Software Project."  The team
composition (Lead, Dev, Reviewer), ceremonies (Sprint Planning, Retro), and columns
(Backlog, In Progress, Review, Done) are generic software-team concepts that may feel
alienating.

The "Customize" escape valve exists but, as noted above, does not carry suggestion
context forward.

**Frustration point:** Users with non-standard projects receive a generic suggestion
with no signal that something better might exist if they rephrased.

### 2.8 The `aks-feature-kanban` Bundle Is Silently Unreachable

The `bundles/aks-feature-kanban/` directory exists and is returned by
`GET /api/templates/builtin-projects`, making it selectable in **Create from
template**.  But it is absent from `BUNDLE_TEMPLATES` and `KEYWORD_MAP`, so the
Suggest Setup flow can never route to it.  A user who would benefit from that
template must know it exists and use the separate "Create from template" modal.

---

## Section 3 — Redesign Recommendations

### R1 — Promote Suggest Setup and Add a Guided Entry Point (Discoverability)

**Problem:** The Suggest tab is the 4th of 4 tabs and looks optional.  New users
never reach it before getting frustrated.

**Proposed fix:**
- Move "Suggest setup" to **tab position 2** (between Discover and Connect existing),
  matching the decision question already filed in `decisions.md` (line 2346).
- Alternatively: on the empty-state screen, add a primary "Get a suggested setup"
  button alongside "Add Project," making the guided path the most prominent CTA.
- Add a short tagline below the tab label on hover or as static caption:
  *"Best for new projects — describe what you're building."*
- Add a 2–3 sentence explainer at the top of the tab body that shows a visual sample
  of what a suggestion looks like (team + columns), so the user knows what they are
  about to receive before typing.

**Estimated effort:** S (tab reorder: ~5 lines in `ProjectPicker.tsx`; explainer +
sample: ~30 lines new JSX)

**Priority:** P0 — This is the primary discoverability gap and requires no backend
change.

---

### R2 — Add a "Start Blank" Opt-Out Path (Opt-Out Gap)

**Problem:** Once a suggestion appears there is no clean way to say "thanks, but I
want to start from scratch."  "Customize" is mislabeled and loses suggestion context.

**Proposed fix:**
- Add a **"Start blank"** button (secondary/ghost appearance) alongside "Apply
  suggestion" and "Customize" in the suggestion action row.
  - Action: `setActiveTab('create')` with `createName` and `createParent` preserved
    but no bundleId context (pure blank Create path).
- Rename "Customize" to **"Customize this template"** to clarify it is
  template-derived, not a blank slate.
- When "Customize this template" is clicked, pass `bundleId` to the Create tab so
  it can pre-select the matching builtin template (currently the bundleId is lost).

**Estimated effort:** S–M (button: ~5 lines; rename: 1 line; bundleId carry-forward
to Create tab requires adding a prop or shared state: ~20 lines)

**Priority:** P1 — Blocks user confidence that the suggestion is reversible.

---

### R3 — Emit a Fallback Signal When No Keywords Matched

**Problem:** The server silently falls back to `default-software-project` when no
keywords match, and the UI shows empty `matchedKeywords` badges with no explanation.

**Proposed fix (server-side):**
- Add an `isExactMatch: boolean` field to `ProjectSuggestion` (or `confidence:
  'high' | 'low'`).
- Set `isExactMatch: false` when `matchedKeywords` is empty.

**Proposed fix (client-side):**
- When `isExactMatch` is false, render a banner inside the suggestion preview:
  > *"We couldn't identify a specific archetype from your description.  Here's our
  > general-purpose template — or try describing your project differently."*
- Offer a **"Try again"** link that refocuses the textarea.
- Show a small "Browse all templates" link that opens the existing "Create from
  template" modal.

**Estimated effort:** S server (add one field + set it) + S client (conditional
banner)

**Priority:** P1 — Addresses the silent-fallback confusion directly.

---

### R4 — Fix the Apply Form's Parent Directory Pre-Fill Race Condition

**Problem:** `applyPath` is initialized at `useState(createParent)` mount time.  If
the user navigates to Suggest before Create, `createParent` may be empty (the home
fetch has not resolved), so the apply form shows an empty required field.

**Proposed fix:**
- In `SuggestTab`, independently fetch `GET /api/squad/home` and apply it to
  `applyPath` when the tab mounts and the field is still empty.  (Same pattern
  already used in `DiscoveryModal` lines 382–389.)
- Alternatively, lift the home-path fetch to `DiscoveryModal` level so all tabs
  share the resolved value immediately.

**Estimated effort:** XS (copy the existing `useEffect` fetch pattern into
`SuggestTab`, ~8 lines)

**Priority:** P2 — Silent UX degradation; low effort fix.

---

### R5 — Move the Primary CTA into DialogActions (Fluent2 Compliance)

**Problem:** "Apply suggestion" and "Customize" live inside the scrollable content
area, breaking the Fluent2 dialog pattern.  On short viewports the buttons may be
below the fold.

**Proposed fix:**
- Thread the Suggest tab's current step (`idle | previewing | applying`) up to
  `DiscoveryModal` state.
- When `activeTab === 'suggest'` and `step === 'previewing'`, add a primary
  "Apply suggestion" button and a secondary "Customize" button to `primaryAction` /
  `DialogActions`.
- Keep "Back" (from `applying` step) in `DialogActions` as well.
- The in-body action row can be removed once `DialogActions` carries the actions.

**Estimated effort:** M (requires lifting step state out of SuggestTab, refactoring
action buttons — ~60 lines changed across component boundary)

**Priority:** P2 — Correctness/polish; doesn't block functionality.

---

## Section 4 — Implementation Sketch

### 4.1 R1 — Promote Suggest Setup (P0, effort: S)

**Files affected:**
- `packages/client/src/pages/ProjectPicker.tsx`
  - Line 468: reorder the tab array from `['discover', 'connect', 'create', 'suggest']`
    to `['discover', 'suggest', 'connect', 'create']`.
  - Update `tabLabels` to relabel `suggest` as "Suggest setup" if not already.
  - Add 20–30 lines of explainer JSX at the top of `SuggestTab` body (above the
    `<Field label="Project description">`).
- No server changes required.
- No API changes required.
- E2e test `01-project-onboarding.spec.ts` (line 44): currently asserts three
  specific tab labels (Discover, Connect, Create).  The reorder does not break label
  presence tests but the order may need adjustment if a positional test is added.

**Complexity:** S — Tab reorder is a 1-line array change.  Explainer copy is purely
additive JSX.

---

### 4.2 R2 — Add "Start Blank" Opt-Out (P1, effort: S–M)

**Files affected:**
- `packages/client/src/pages/ProjectPicker.tsx`
  - `SuggestTab` props: add `onStartBlank: () => void` (calls
    `setActiveTab('create')` with no bundleId).
  - `SuggestTab` suggestion action row (lines 922–942): add a third `<Button
    appearance="subtle">Start blank</Button>` button.
  - Rename "Customize" button label to "Customize this template".
  - `DiscoveryModal` → `SuggestTab` call site (lines 519–530): pass the new prop.
- No server changes required.

**Complexity:** S — Pure UI addition with one new prop.  The "carry bundleId to
Create tab" variant is M because it requires either a shared state slice or a new
prop on `CreateTab`.

---

## Section 5 — Open Questions for Brady

1. **Should "Suggest setup" be the default tab for first-time users (no projects
   yet)?**  The empty state currently shows a generic "Discover .squad/ directories"
   CTA.  If the product hypothesis is that Suggest is the best new-user funnel,
   the empty-state button could open the modal directly on the Suggest tab instead
   of Discover.  This is a product decision about the onboarding narrative.

2. **Should the suggestion be LLM-driven or stay keyword-based?**  The stub comment
   ("LLM call TBD") is still in the code.  A keyword stub cannot handle natural-
   language descriptions, multi-domain projects, or non-English input.  An LLM call
   would make suggestions feel responsive and reduce the silent-fallback rate — but
   adds latency and cost per click.  Is it acceptable to ship R3 (fallback signal)
   as a band-aid, or is LLM integration the real fix?

3. **What should "Customize" actually do?**  Currently it drops the user into Create
   with only the bundle name pre-filled.  The most useful version would open a
   purpose-built "Edit suggestion" panel where the user can toggle team members,
   add/remove columns, and change ceremony cadences before applying.  This is
   significantly more scope — is it on the W31+ roadmap?

4. **Is `aks-feature-kanban` intentionally excluded from the Suggest flow?**  The
   bundle exists in `bundles/` and is accessible via "Create from template" but is
   not in `BUNDLE_TEMPLATES` or `KEYWORD_MAP`.  If it should be suggerable, someone
   needs to add it to both maps with an appropriate keyword set.  If it is
   intentionally a power-user template, that decision should be documented.

5. **What is the success metric for the Suggest tab?**  Without telemetry there is
   no way to know if users land on it, how often they apply vs. customize vs. abandon,
   or whether the fallback rate (empty `matchedKeywords`) is high.  Before investing
   in LLM integration, even a simple server-side log of `bundleId + isExactMatch + abandoned`
   would give the data needed to prioritize.  Is instrumentation in scope for W31?

---

## Appendix A — Decision Cross-References

Existing open questions from `decisions.md` (lines 2346–2349) that this report
directly addresses:

| decisions.md question | Status in this report |
|---|---|
| Suggest tab position (currently 4th) | Addressed by R1 (promote to 2nd) — **product decision needed** |
| Apply path default (empty on first use) | Root-caused in §2.5; fixed by R4 |
| LLM integration (keyword stub vs. streaming) | Scoped as Open Question 2 |
| Column overwrite on Apply | Confirmed acceptable (new project only); noted in §1.1 |

---

## Appendix B — Files Read (No Modifications)

| File | Purpose |
|---|---|
| `packages/client/src/pages/ProjectPicker.tsx` | Full modal UI + SuggestTab component |
| `packages/client/src/api/projects.ts` | `useSuggestProjectSetup` hook + `ProjectSuggestion` type |
| `packages/server/src/routes/projects.ts` | `POST /suggest` route, `BUNDLE_TEMPLATES`, `KEYWORD_MAP`, `detectBundle` |
| `packages/server/src/services/builtin-bundles.ts` | Bundle scanner (confirms 7 bundles on disk) |
| `packages/server/src/routes/templates.ts` | Builtin-projects API used by Apply path |
| `packages/e2e/tests/01-project-onboarding.spec.ts` | E2e coverage (Suggest tab not tested) |
| `.squad/decisions.md` (lines 2241–2349) | Prior O1 decisions + open questions |
| `.squad/reports/wave-30-sdk-cli-replication.md` | C-11 context (personal agent discovery; no direct overlap with Suggest flow) |
