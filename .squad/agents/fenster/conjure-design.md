# Conjure UX Design Spec

**Author:** Fenster (UX Designer)  
**Date:** 2026-05-15  
**Status:** Ready for implementation by Keyser  

---

## 1. Naming + Iconography

### Final naming

| Surface | Old | New |
|---------|-----|-----|
| FAB button label | Capture | Conjure |
| FAB aria-label | "Quick capture" | "Conjure something new" |
| FAB tooltip | "Quick capture (press c)" | "Conjure (⌘K)" |
| Modal title (step 1) | "Quick capture" | "Conjure" |
| Modal title (step 2) | "Review formulated draft" | "Create {intent}" |
| Component file | `CaptureFab.tsx` | `ConjureFab.tsx` |
| Component file | `CaptureModal.tsx` | `ConjureModal.tsx` |
| Folder | `inbox/` | `conjure/` |

**Rationale:** "Conjure" evokes the idea of making something appear from a description — magical, fast, not capturing but creating. The folder rename from `inbox/` to `conjure/` reflects the expanded scope: this isn't inbox triage anymore, it's a creation surface.

### Icon choice

**Icon:** `Sparkle20Regular` (FAB) / `Sparkle24Regular` (elsewhere if needed)

**Why:** Already used in the codebase for AI/formulation actions (CastPanel, StarterDetail). "Sparkle" connotes magic, intelligence, creation — aligns with Conjure semantics. `WandSparkleRegular` does not exist in the installed `@fluentui/react-icons` version; `Sparkle*` does and is proven to work.

**Import:**
```tsx
import { Sparkle20Regular, Sparkle24Regular } from '@fluentui/react-icons'
```

### Keyboard shortcut

**New shortcut:** `Cmd+K` / `Ctrl+K`

**Rationale:** `c` was appropriate for "capture" (mnemonic). `Cmd+K` is the universal command palette / quick action shortcut (VS Code, Slack, Linear, Notion). Users expect Cmd+K to open "do something smart."

**Migration:** The old `c` shortcut (Layout.tsx lines 164-166) should be removed entirely. `Cmd+K` takes its place.

---

## 2. Modal Interaction Flow

### 2.1 Step 1 — Capture Intent (single input)

```
┌────────────────────────────────────────────────────────────────┐
│  ✨ Conjure                                              [✕]   │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  Describe what you want to create…                             │
│  ┌────────────────────────────────────────────────────────────┐│
│  │                                                            ││
│  │ [                                                         ]││
│  │                                                            ││
│  │                                                            ││
│  └────────────────────────────────────────────────────────────┘│
│                                                                │
│  Examples:                                                     │
│   • "a tool that summarizes PDFs"                              │
│   • "a bug in the login flow"                                  │
│   • "a team to build a mobile app"                             │
│   • "an agent that reviews security"                           │
│                                                                │
├────────────────────────────────────────────────────────────────┤
│                                    [Cancel]  [✨ Conjure ⏎]    │
└────────────────────────────────────────────────────────────────┘
```

**Components:**

| Element | Fluent2 component | Props/notes |
|---------|-------------------|-------------|
| Modal container | `<Dialog>` | `modalType="modal"`, trap focus |
| Close button | `<DialogTrigger>` + `<Button>` | `appearance="subtle"`, icon-only |
| Input | `<Textarea>` | `resize="vertical"`, autoFocus, rows=4 |
| Examples list | `<Caption1>` | `color: tokens.colorNeutralForeground3` |
| Cancel button | `<Button>` | `appearance="secondary"` |
| Conjure button | `<Button>` | `appearance="primary"`, `icon={<Sparkle20Regular />}` |

**Keyboard shortcuts in modal:**

| Key | Action |
|-----|--------|
| `Enter` (unmodified) | New line in textarea |
| `Cmd/Ctrl+Enter` | Submit (invoke classify) |
| `Escape` | Close modal |

**Loading state:** After submit, the button becomes:
```
[⏳ Classifying…]
```
Use `<Spinner size="tiny" />` inline before text. Button disabled during flight.

---

### 2.2 Step 2 — Classified Result

After `POST /api/conjure/classify` returns:

```json
{
  "intent": "tool",
  "confidence": 0.92,
  "draft": {
    "name": "PDF Summarizer",
    "description": "Summarizes PDF documents using...",
    "type": "script"
  },
  "routing": {
    "destination": "/projects/:id/tools/new",
    "presentation": "navigate",
    "fallbacks": ["skill", "agent"]
  }
}
```

**Modal transforms to:**

```
┌────────────────────────────────────────────────────────────────┐
│  ✨ Create Tool                                          [✕]   │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  ┌────────────────────────────────────────────────────────────┐│
│  │ ✨ Looks like you're describing a tool — 92% confident     ││
│  │    Not right? → [project] [issue] [skill] [agent]          ││
│  └────────────────────────────────────────────────────────────┘│
│                                                                │
│  Name                                                          │
│  ┌────────────────────────────────────────────────────────────┐│
│  │ PDF Summarizer                                             ││
│  └────────────────────────────────────────────────────────────┘│
│                                                                │
│  Description                                                   │
│  ┌────────────────────────────────────────────────────────────┐│
│  │ Summarizes PDF documents using...                          ││
│  └────────────────────────────────────────────────────────────┘│
│                                                                │
│  Type                                                          │
│  [● Script  ○ MCP Server]                                      │
│                                                                │
├────────────────────────────────────────────────────────────────┤
│                           [Start over]  [Create Tool →]        │
└────────────────────────────────────────────────────────────────┘
```

**Classification banner components:**

| Element | Fluent2 component | Props/notes |
|---------|-------------------|-------------|
| Banner container | `<MessageBar>` | `intent="info"`, custom styling |
| Confidence display | `<Badge>` | `appearance="filled"`, color by confidence tier |
| Fallback pills | `<Button>` (array) | `appearance="outline"`, `size="small"` |

**Confidence color tiers:**

| Range | Color | Token |
|-------|-------|-------|
| ≥0.8 (high) | Green | `tokens.colorPaletteGreenBackground3` |
| 0.5–0.79 (medium) | Yellow/amber | `tokens.colorPaletteYellowBackground3` |
| <0.5 (low) | Gray | `tokens.colorNeutralBackground3` |

**Override behavior:** Clicking a fallback pill:
1. Sets intent to that type
2. Re-renders the form for that intent
3. Keeps any overlapping draft fields (e.g., "description" survives across most intents)

---

### 2.3 Step 3 — Confirmation / Navigation

**On "Create {intent}" click:**

1. `POST /api/conjure/create` with `{ intent, draft }`
2. Backend creates the entity and returns `{ id, redirectUrl }`
3. Modal closes
4. Navigate to `redirectUrl` (e.g., `/projects/:pid/tools/:tid`)

**Instant-creation intents (skill, issue):** Show a brief inline success toast, then navigate.

**Deferred-creation intents (project, team, agent, tool):** Navigate to the entity's detail/edit page with the draft pre-populated.

---

## 3. Per-Intent Form Sketches

### 3.1 Project

```
┌────────────────────────────────────────────────────┐
│ Name*                                              │
│ [Mobile App Rewrite              ]                 │
│                                                    │
│ Description                                        │
│ [A complete rewrite of our mobile...  ]            │
│                                                    │
│ Suggested first issues                             │
│ ┌────────────────────────────────────────────────┐ │
│ │ ☑ Set up React Native project                  │ │
│ │ ☑ Design navigation architecture               │ │
│ │ ☐ Migrate auth module                          │ │
│ └────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────┘
```

| Field | Source | Editable | Component |
|-------|--------|----------|-----------|
| Name | `draft.name` | Yes | `<Input>` |
| Description | `draft.description` | Yes | `<Textarea>` |
| Suggested issues | `draft.suggestedIssues[]` | Checkboxes | `<Checkbox>` list |

**On create:** Creates project, optionally creates checked issues in backlog.

---

### 3.2 Issue

```
┌────────────────────────────────────────────────────┐
│ Title*                                             │
│ [Login button doesn't work on Safari ]             │
│                                                    │
│ Description                                        │
│ [Users report that clicking the login button on... │
│  Safari 17+ does nothing. Console shows...        ]│
│                                                    │
│ Project*                                           │
│ [▼ Select project...         ]                     │
│                                                    │
│ Labels         Priority                            │
│ [bug] [safari] [▼ Medium    ]                      │
└────────────────────────────────────────────────────┘
```

| Field | Source | Editable | Component |
|-------|--------|----------|-----------|
| Title | `draft.title` | Yes | `<Input>` |
| Description | `draft.description` | Yes | `<Textarea>` |
| Project | `draft.projectId` or context | Yes (dropdown) | `<Dropdown>` |
| Labels | `draft.labels[]` | Yes (tag input) | `<TagPicker>` |
| Priority | `draft.priority` | Yes | `<Dropdown>` |

**Note:** If opened from within a project context, Project is pre-filled and locked.

---

### 3.3 Team

```
┌────────────────────────────────────────────────────┐
│ Universe                                           │
│ [● The Office  ○ Seinfeld  ○ Parks & Rec  ○ ...]   │
│                                                    │
│ Project type                                       │
│ [▼ Web application            ]                    │
│                                                    │
│ Suggested roles                                    │
│ ┌────────────────────────────────────────────────┐ │
│ │ ☑ Lead (1)                                     │ │
│ │ ☑ Developer (2)                                │ │
│ │ ☑ Designer (1)                                 │ │
│ │ ☐ Tester (1)                                   │ │
│ └────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────┘
```

| Field | Source | Editable | Component |
|-------|--------|----------|-----------|
| Universe | `draft.universeId` | Yes (radio) | `<RadioGroup>` |
| Project type | `draft.projectType` | Yes | `<Dropdown>` |
| Roles | `draft.roles[]` | Checkboxes + count | `<Checkbox>` + `<SpinButton>` |

**On create:** Navigates to Hire Team flow with these presets.

---

### 3.4 Agent

```
┌────────────────────────────────────────────────────┐
│ Name slot                                          │
│ [Keyser               ]                            │
│                                                    │
│ Role                                               │
│ [▼ developer          ]                            │
│                                                    │
│ Charter starter                                    │
│ [You are a senior backend developer focused on... ]│
│                                                    │
│ Model                                              │
│ [▼ claude-sonnet-4-20241022 ]                      │
└────────────────────────────────────────────────────┘
```

| Field | Source | Editable | Component |
|-------|--------|----------|-----------|
| Name slot | `draft.nameSlot` | Yes | `<Input>` |
| Role | `draft.role` | Yes | `<Dropdown>` (from AgentRole enum) |
| Charter starter | `draft.charter` | Yes | `<Textarea>` |
| Model | `draft.model` | Yes | `<Dropdown>` (from available models) |

---

### 3.5 Skill

```
┌────────────────────────────────────────────────────┐
│ Title*                                             │
│ [Summarize long documents            ]             │
│                                                    │
│ Body (what the skill does)                         │
│ [When the user asks to summarize a document,      ]│
│ [extract the key points and present them as...    ]│
│                                                    │
│ Suggested filename                                 │
│ [summarize-docs.skill.md     ]                     │
│                                                    │
│ Confidence        [Low ●───○───○ High]             │
└────────────────────────────────────────────────────┘
```

| Field | Source | Editable | Component |
|-------|--------|----------|-----------|
| Title | `draft.title` | Yes | `<Input>` |
| Body | `draft.body` | Yes | `<Textarea>` rows=6 |
| Filename | `draft.filename` | Yes | `<Input>` |
| Confidence | `draft.confidence` | Yes | `<Slider>` or radio |

**Default confidence:** Low (skills need testing before promotion).

---

### 3.6 Tool

```
┌────────────────────────────────────────────────────┐
│ Name*                                              │
│ [PDF Summarizer                   ]                │
│                                                    │
│ Description                                        │
│ [Summarizes PDF documents by extracting text and  ]│
│ [using an LLM to produce a concise summary.       ]│
│                                                    │
│ Type                                               │
│ [● Script  ○ MCP Server]                           │
│                                                    │
│ Suggested schema (JSON)                            │
│ ┌────────────────────────────────────────────────┐ │
│ │ {                                              │ │
│ │   "input": { "pdfUrl": "string" },             │ │
│ │   "output": { "summary": "string" }            │ │
│ │ }                                              │ │
│ └────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────┘
```

| Field | Source | Editable | Component |
|-------|--------|----------|-----------|
| Name | `draft.name` | Yes | `<Input>` |
| Description | `draft.description` | Yes | `<Textarea>` |
| Type | `draft.type` | Yes | `<RadioGroup>` ("script" / "mcp") |
| Schema | `draft.schema` | Yes | `<Textarea>` monospace, JSON |

---

## 4. Empty / Loading / Error States

### 4.1 Loading state (classify in flight)

```
┌────────────────────────────────────────────────────────────────┐
│  ✨ Conjure                                              [✕]   │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  ┌────────────────────────────────────────────────────────────┐│
│  │ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ ││
│  │ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ ││
│  │ ░░░░░░░░░░░░░░░░░░░                                       ││
│  └────────────────────────────────────────────────────────────┘│
│                                                                │
│  ⏳ Classifying your request…                                  │
│                                                                │
├────────────────────────────────────────────────────────────────┤
│                                            [Cancel]            │
└────────────────────────────────────────────────────────────────┘
```

**Components:**
- `<Skeleton>` (3 lines, varying width)
- `<Spinner size="small" />` + `<Caption1>Classifying your request…</Caption1>`
- Cancel button remains enabled (aborts fetch, returns to step 1)

---

### 4.2 Error state (classify failed)

```
┌────────────────────────────────────────────────────────────────┐
│  ✨ Conjure                                              [✕]   │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  ┌─ ⚠️ ────────────────────────────────────────────────────────┐│
│  │ Couldn't classify your request.                            ││
│  │ Try rephrasing, or pick a type manually:                   ││
│  │                                                            ││
│  │ [Project] [Issue] [Team] [Agent] [Skill] [Tool]            ││
│  └────────────────────────────────────────────────────────────┘│
│                                                                │
│  Your prompt:                                                  │
│  "a thing that does stuff"                                     │
│                                                                │
├────────────────────────────────────────────────────────────────┤
│                                    [Try again]  [Cancel]       │
└────────────────────────────────────────────────────────────────┘
```

**Components:**
- `<MessageBar intent="warning">` for the error banner
- Manual type buttons: `<Button appearance="outline" size="small">` × 6
- "Try again" re-opens step 1 with the same prompt pre-filled

**Clicking a manual type button:**
1. Sets intent to that type
2. Navigates to step 2 with empty draft (user fills from scratch)
3. Confidence shown as "manual" (no numeric value)

---

### 4.3 Low-confidence state (<0.5)

```
┌────────────────────────────────────────────────────────────────┐
│  ✨ Conjure                                              [✕]   │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  ┌────────────────────────────────────────────────────────────┐│
│  │ 🤔 We're not sure what you're describing.                  ││
│  │ Pick the best match:                                       ││
│  │                                                            ││
│  │ [◉ Issue — 42%] [○ Skill — 31%] [○ Project — 27%]          ││
│  └────────────────────────────────────────────────────────────┘│
│                                                                │
│  (form fields for selected intent appear below)               │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

**Behavior:**
- Show top 3 candidates (or fewer if `fallbacks` is shorter)
- Pre-select the highest-confidence option
- User can switch; form re-renders for selected intent
- No "confidence banner" once user makes explicit choice

---

## 5. Migration / Replacement Details

### 5.1 Capture data persistence audit

**Findings from CaptureModal.tsx analysis:**

The current Capture flow persists to:
1. **`/api/inbox`** — backend inbox table via `useCreateInboxItem`
2. **No localStorage** — the modal does not use `localStorage` or `sessionStorage`

Existing inbox items are **issue drafts only** — they have `originalDraft`, `formulatedTitle`, `formulatedBody`, `suggestedLabels`, `suggestedProjectId`, `suggestedColumn`. This schema is narrower than Conjure's 6-intent model.

### 5.2 Migration path

**Recommendation: Deprecate inbox items gracefully.**

1. **Inbox page stays read-only.** The `/inbox` route continues to display existing inbox items until they're published or discarded.
2. **No new inbox items.** Conjure does not create inbox items — it classifies and creates the target entity directly.
3. **Archive notice.** Add a banner to the Inbox page: "Capture has been replaced by Conjure. These are your legacy drafts."
4. **Future cleanup.** In a later release, offer "Discard all" or auto-archive after 30 days.

**No data migration required.** Inbox items don't transform into the new intent types — they're a dead-end artifact of the old flow.

### 5.3 Files to touch

| Action | File | Notes |
|--------|------|-------|
| **Rename** | `inbox/CaptureFab.tsx` → `conjure/ConjureFab.tsx` | Update component name, icon, tooltip |
| **Rename** | `inbox/CaptureModal.tsx` → `conjure/ConjureModal.tsx` | Complete rewrite (see spec) |
| **Create** | `conjure/IntentForm.tsx` | Shared form renderer for 6 intents |
| **Create** | `conjure/ClassifyBanner.tsx` | Confidence + fallback pills |
| **Create** | `conjure/useConjure.ts` | Hook: classify, create, abort |
| **Modify** | `Layout.tsx` | Update import path, change shortcut `c` → `Cmd+K`, rename button |
| **Modify** | `pages/Board.tsx` | Update import if it uses CaptureFab (check for FAB mount) |
| **Modify** | `pages/Inbox.tsx` | Add deprecation banner |
| **Delete** | (none immediately) | Keep inbox folder until legacy items are cleared |

### 5.4 API endpoints (Hockney scope)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/conjure/classify` | POST | Classify prompt → intent + draft |
| `/api/conjure/create` | POST | Create entity from intent + draft |

*Note: Hockney is building these. Keyser's client code will call them.*

---

## 6. Accessibility + Fluent2 Compliance

### 6.1 Keyboard navigation

| Key | Action |
|-----|--------|
| `Cmd/Ctrl+K` | Open Conjure modal (global) |
| `Tab` | Move focus forward through interactive elements |
| `Shift+Tab` | Move focus backward |
| `Enter` | Activate focused button; newline in textarea |
| `Cmd/Ctrl+Enter` | Submit (classify or create) |
| `Escape` | Close modal |
| `Arrow keys` | Navigate within RadioGroup, Dropdown |

### 6.2 ARIA labels

| Element | ARIA attribute | Value |
|---------|----------------|-------|
| Modal | `aria-label` | "Conjure something new" |
| Input (step 1) | `aria-label` | "Describe what you want to create" |
| Close button | `aria-label` | "Close" |
| Confidence badge | `aria-label` | "Confidence: 92 percent" |
| Fallback pill | `aria-label` | "Change to {intent}" |
| Create button | `aria-label` | "Create {intent}" |

### 6.3 Focus management

1. **On open:** Focus moves to the textarea (step 1) or first form field (step 2).
2. **On close:** Focus returns to the trigger element (Conjure button in topBar).
3. **On step transition:** Focus moves to the classification banner, then user tabs to form.

### 6.4 Fluent2 component usage

| Custom element in CaptureModal | Replace with |
|--------------------------------|--------------|
| `<div>` modal overlay | `<Dialog>` with `modalType="modal"` |
| `<button>` close | `<DialogTrigger>` + `<Button>` |
| `<textarea>` | `<Textarea>` from `@fluentui/react-components` |
| `<input>` | `<Input>` |
| `<select>` | `<Dropdown>` or `<Combobox>` |
| Inline style buttons | `<Button>` with `appearance` prop |
| Confidence pill | `<Badge>` |
| Error banner | `<MessageBar intent="error">` |
| Labels tag input | `<TagPicker>` (or custom with `<Badge>` + `<Input>`) |

### 6.5 Dark theme

The codebase uses `webLightTheme` but has GitHub-dark hex codes in places. Per prior decisions, structural CSS vars (`--surface`, `--border`) coexist with tokens. The Conjure modal should use **only Fluent tokens** for colors — no hardcoded hex.

---

## 7. Summary Checklist for Keyser

- [ ] Create `packages/client/src/components/conjure/` folder
- [ ] Implement `ConjureFab.tsx` (icon: `Sparkle20Regular`, tooltip: "Conjure (⌘K)")
- [ ] Implement `ConjureModal.tsx` using `<Dialog>` from Fluent2
- [ ] Implement `IntentForm.tsx` with 6 intent form variants
- [ ] Implement `ClassifyBanner.tsx` for confidence + fallback pills
- [ ] Implement `useConjure.ts` hook (classify, create, abort)
- [ ] Update `Layout.tsx`: change shortcut from `c` to `Cmd+K`, rename button, update import
- [ ] Update `pages/Board.tsx` if it mounts CaptureFab
- [ ] Add deprecation banner to `pages/Inbox.tsx`
- [ ] Remove old `inbox/CaptureFab.tsx` and `inbox/CaptureModal.tsx` after migration
- [ ] Run `npx tsc --noEmit` — must pass clean
- [ ] Verify keyboard navigation and ARIA labels

---

## Appendix: Response shape reference

**POST /api/conjure/classify request:**
```json
{
  "prompt": "a tool that summarizes PDFs",
  "projectId": "optional-context-project-id"
}
```

**POST /api/conjure/classify response:**
```json
{
  "intent": "project" | "issue" | "team" | "agent" | "skill" | "tool",
  "confidence": 0.92,
  "draft": { /* intent-specific fields */ },
  "routing": {
    "destination": "/projects/:id/tools/new",
    "presentation": "navigate" | "inline",
    "fallbacks": ["skill", "agent"]
  }
}
```

**POST /api/conjure/create request:**
```json
{
  "intent": "tool",
  "draft": { "name": "PDF Summarizer", "description": "...", "type": "script" },
  "projectId": "optional"
}
```

**POST /api/conjure/create response:**
```json
{
  "id": "tool-uuid",
  "redirectUrl": "/projects/p1/tools/tool-uuid"
}
```

---

*End of spec. Questions? Ping Fenster.*
