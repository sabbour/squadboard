# Ceremonies.md vs Squadboard Runtime: Relationship Analysis

**Wave:** W28  
**Date:** 2026-05-16T05:00:00-07:00  
**Research:** Kobayashi  
**Context:** Brady directive: "Unclear about how ceremonies.md and our ceremonies work together"

---

## Executive Summary

The squadboard runtime and ceremonies.md operate in two separate layers:

| Layer | What It Is | Source of Truth | Maturity |
|-------|-----------|-----------------|----------|
| **ceremonies.md** | Human-readable spec of team ceremonies (Design Review, Retrospective, etc.) | Markdown prose in `.squad/ceremonies.md` | ✅ Stable (3 core ceremonies defined) |
| **Runtime** | Executable workflows triggered by events, schedules, or manual actions | PostgreSQL tables: `workflows`, `workflowVersions`, `ceremonySchedules` | 🔨 Active (Phase 10–16; H3 visual editor added Phase 16) |

**The relationship is one-way:** ceremonies.md defines *intent* ("what we do"); the runtime provides *mechanism* ("how we do it"). However:

- ❌ **There is no bidirectional sync.** Changes to ceremonies.md do not auto-update the runtime, and vice versa.
- ❌ **No import from markdown exists today.** The runtime can *generate* YAML from prose (via LLM translation), but cannot read ceremony definitions directly from ceremonies.md.
- ✅ **Runtime can emit YAML.** The visual editor (H3, Phase 16) round-trips through YAML and the code editor.
- 🤔 **Visual editor respects YAML structure** but does *not* validate round-trip fidelity to ceremonies.md format.

---

## Section 2 — ceremonies.md Spec Inventory

### `.squad/ceremonies.md` (Current)

**Three ceremonies defined:**

| Name | Trigger | When | Condition | Facilitator | Participants | Enforcement |
|------|---------|------|-----------|-------------|--------------|-------------|
| **Design Review** | auto | before | multi-agent task involving 2+ agents modifying shared systems | lead | all-relevant | ❌ |
| **Retrospective** | auto | after | build failure, test failure, or reviewer rejection | lead | all-involved | ❌ |
| **Retrospective with Enforcement** | auto | weekly | no retro log in .squad/log/ within 7 days | lead | all | ✅ (retro-enforcement skill) |

**Observations:**
- Each has a human-readable agenda (3–4 bullet points).
- Trigger is expressed in prose ("auto", "weekly", "before").
- No YAML format or structured step definitions.
- Focus on **human process**, not executable workflow.

### `docs/concepts/ceremonies.md` (Broader Definition)

**Five workflow templates:**

| Name | Use Case | Trigger Example | Steps (Abstract) | Kind |
|------|----------|-----------------|------------------|------|
| **Simple Review** | Bug triage, design review, RFC feedback | Manual button | agent_run → peer_review (1-of-2) → done | ceremony |
| **Bug Fix** | Production bugs, regressions | Label `bug/critical` | agent_run → peer_review (2-of-3) → github_pr → wait_merged | ceremony |
| **RFC** | Architecture decisions, breaking changes | Label `type:rfc` | agent_run → peer_review (3-of-5, async) → agent_run → done | ceremony |
| **Spike** | Research task, feasibility studies | Manual + schedule | agent_run → wait_timer → agent_run → peer_review → done | ceremony |
| **Pair-Programming Session** | Complex features, knowledge transfer | Label `work-mode:pair` | agent_run (A) → agent_run (B) → iterate 2–3 cycles → peer_review | ceremony |

**Observations:**
- More structured: step kinds are named (agent_run, peer_review, wait_timer, etc.).
- Trigger types: manual, scheduled, github_event (labeled).
- These are *templates*, not concrete ceremony instances.

---

## Section 3 — Squadboard Runtime Ceremony Inventory

### DB Schema (workflows table)

**Ceremonies are stored as `workflows` rows** with:

```
id (uuid)
name, slug, description
triggerKind: 'on_issue_entry' | 'on_schedule' | 'on_event' | 'manual'
triggerConfig: JSONB (shape varies by triggerKind)
kind: 'ceremony' | 'workflow' | 'review_policy' | 'narrative'
status: 'active' | 'draft' | 'paused' | 'archived'
parentNarrativeId: optional (if auto-generated from markdown prose)
lastTranslationError, lastTranslationAttemptAt (Phase 11)
```

### Trigger Mechanisms (Executables)

| Trigger Kind | Dispatcher | Entry Point | Idempotency |
|--------------|------------|-------------|------------|
| **on_schedule** | `ceremony-scheduler.ts` → heartbeat sweep | `sweepDueSchedules()` every 5–10s | DB: UPDATE-then-SELECT on next_fire_at |
| **on_event** | `ceremony-dispatcher.ts` → event bus | `handleEvent()` on new BusEvent | In-memory LRU dedupe (60s window, 4096 entries) or DB `ceremony_github_fires` table |
| **github** | `ceremony-dispatcher.ts` → GitHub webhook | `handleGithubEvent()` on GH event | DB: `ceremony_github_fires(ceremony_slug, delivery_id)` unique constraint |
| **manual** | REST API `/api/projects/{id}/ceremonies/invoke` | `spawnCeremonyRun()` | None (user-triggered) |

### Associated Tables

| Table | Purpose | Linkage |
|-------|---------|---------|
| `workflows` | Ceremony/workflow definitions | PK: id, FK: projectId |
| `workflowVersions` | Immutable snapshots (YAML + JSON schema) | FK: workflowId; isActive boolean |
| `ceremonySchedules` | Cron schedules for on_schedule ceremonies | FK: workflowId; nextFireAt, cronExpr |
| `workflowRuns` | Execution instances | FK: workflowVersionId; triggerSource JSONB |
| `stepRuns` | Individual step executions | FK: workflowRunId; stepType, status, reviewDecision |
| `issueWorkflows` | Links an issue to active workflowVersion | FK: issueId, workflowVersionId (for issue-entry workflows) |

### UI Surfaces

| Surface | Code Path | Capability |
|---------|-----------|-----------|
| **Ceremony List** | `packages/client/src/pages/CeremonyList.tsx` | DataGrid: Name, Trigger, Kind, Scope, Created; toolbar: New ceremony, Review drafts, End wave |
| **Ceremony Editor** | `packages/client/src/pages/CeremonyEditor.tsx` | Prose (Conjure/Formulate), Code (YAML), Visual (H3 canvas); tabs: live-switch |
| **Visual Canvas** | `packages/client/src/components/ceremony/VisualCanvas.tsx` | Drag-from-palette (5 step kinds), connect outputs→inputs, delete, property panel |
| **Formulate Panel** | `packages/client/src/components/formulate/FormulatePanel.tsx` | LLM-powered prose→YAML; model badge shows which model was used |

---

## Section 4 — Alignment Matrix

### Spec ↔ Runtime Mapping

| Spec Ceremony | Runtime Equivalent | Status | Notes |
|---------------|-------------------|--------|-------|
| **Design Review** | Unnamed (no instance in DB) | ❌ Not implemented | Would need on_event trigger for "multi-agent task" condition detection |
| **Retrospective** | Unnamed (no instance in DB) | ❌ Not implemented | Would need on_event trigger for "build/test failure or reviewer rejection" |
| **Retrospective with Enforcement** | `retro-enforcement` skill only | ⚠️ Partial | Skill checks if retro is due; ceremony auto-trigger not found in workflows |
| **Simple Review** (template) | Manual ceremony (generic) | ✅ Can be authored | Users create via UI; no built-in instance |
| **Bug Fix** (template) | Manual ceremony (generic) | ✅ Can be authored | Users create via UI; no built-in instance |
| **RFC** (template) | Manual ceremony (generic) | ✅ Can be authored | Users create via UI; no built-in instance |
| **Spike** (template) | Manual ceremony (generic) | ✅ Can be authored | Users create via UI; no built-in instance |
| **Pair-Programming Session** (template) | Manual ceremony (generic) | ✅ Can be authored | Users create via UI; no built-in instance |

### Missing in Runtime

1. **Built-in ceremony instances** — The 3 ceremonies in `.squad/ceremonies.md` are never auto-created when a project boots. A team must manually author them in the UI or via YAML.
2. **Auto-detection of conditions** — "multi-agent task" and "build/test failure" are prose concepts; no logic exists to detect and trigger ceremonies based on these rules.
3. **Scope concept** — ceremonies.md talks about "all-relevant", "all-involved", "all"; runtime has no first-class notion of scope. Participants are hard-coded in steps (peer_review: reviewers=1, etc.).

### Missing in ceremonies.md

1. **Step-level detail** — ceremonies.md agendas are human-focused bullet points; they don't enumerate technical steps (agent_run kinds, timeouts, retry policies).
2. **Execution lifecycle** — No mention of draft/active/paused/archived status or version control.
3. **Event and GitHub integration** — ceremonies.md trigger descriptions are informal; runtime supports GitHub event filters (label, branch, author_team) not mentioned in spec.

---

## Section 5 — Trigger Mechanics

### Auto-Triggered (Event-Based)

**ceremonies.md description:** "auto" (before/after work)

**Runtime implementation:**
- `ceremony-dispatcher.ts` subscribes to `eventBus` (in-process event broker).
- Listens for `BusEvent` with type matching `triggerConfig->>'eventType'`.
- Examples: `'review.requested'`, `'deliverable.created'`, `'issue.created'`.
- **Idempotency:** In-memory LRU dedupe (60s window) or DB `ceremony_github_fires` constraint for GitHub events.
- **Mismatch:** ceremonies.md says "auto before multi-agent task" but runtime has no "multi-agent task started" event. Would need to emit from orchestrator.

### Sweep-Triggered (Heartbeat-Driven)

**ceremonies.md description:** "weekly" (for retro enforcement)

**Runtime implementation:**
- `ceremony-scheduler.ts` → `sweepDueSchedules()` called every heartbeat (~5–10s).
- Scans `ceremonySchedules` for rows with `nextFireAt <= now()` and `enabled=true`.
- Uses **cron-parser** to compute next fire time (e.g., `"0 9 * * MON"` = 9 AM Mondays).
- **Idempotency:** Optimistic lock on `nextFireAt` (write tentative future time, then recompute).
- **Anchor issue:** For scheduled ceremonies with no natural issue, uses project's most-recent non-fan_out-child issue.
- **Backoff:** On 2+ consecutive failures, pushes nextFireAt to 1h in future.

### Manually Triggered (User Click)

**ceremonies.md description:** implicit (no explicit mention)

**Runtime implementation:**
- REST endpoint: `POST /api/projects/{id}/ceremonies/invoke`
- Payload: `{ ceremonySlug, context? }`
- Calls `spawnCeremonyRun()` with trigger='manual' or 'manual_force'.
- **Bypass:** manual_force overrides status checks (draft/paused/archived OK).
- UI: button on ceremony card, toolbar, or direct page navigation.

### Scheduled (Cron-Like)

**ceremonies.md description:** "weekly" (hardcoded frequency)

**Runtime implementation:**
- Cron expressions in `ceremonySchedules.cronExpr` (full flexibility).
- Timezone-aware parsing (default UTC, override per schedule).
- `previewNextFireTimes()` helper shows next 3 fire times (UX preview).

---

## Section 6 — Visual Editor (H3) vs Spec

### Visual Canvas Capabilities

**Added Phase 16:**
- Drag-from-palette: 5 step kinds (agent_run, peer_review, fan_out, route, wait_timer) + fan_out children.
- Click node → property panel; edit agent, prompt, timeout, reviewers.
- Drag-to-connect outputs → inputs; re-orders step list (no branching support yet).
- Delete / Backspace to remove.
- Auto-layout via dagre.

### Round-Trip Fidelity

**Code path:** VisualCanvas ↔ ceremony-graph.ts ↔ YAML

1. **Input:** User drags steps, configures in right panel.
2. **Intermediate:** In-memory graph (CeremonyGraph + CeremonyStep[]) syncs with property form.
3. **Output:** `rebuildGraph()` serializes to YAML, stored in `workflowVersions.yamlContent`.
4. **Re-import:** Parsing YAML → graph → re-render canvas (read-only or edit mode).

### Spec Alignment

**Does the visual editor respect ceremonies.md format?**
- ✅ Visual steps map to runtime step kinds (agent_run, peer_review, etc.).
- ⚠️ **Partial.** Visual editor allows branching (route step with multiple conditions); ceremonies.md templates use linear steps only.
- ❌ **No ceremonies.md validation.** Editor never checks if a ceremony matches a spec template.
- ❌ **No round-trip guarantee.** A ceremonies.md prose ceremony → LLM translation → YAML → visual editor is lossy (prose details like "focused time budget" are lost).

---

## Section 7 — Importing Ceremonies from Markdown

### Was There Ever an Import Flow?

**Git search:** No `importCeremonies()` or `parseMarkdownCeremonies()` function found in current codebase.

**Git history** (selected relevant commits):
- `fa62d185` (Nov 2024): "Ceremonies: Conjure entrypoint + first-time-friendly create UX"
- `b4d580dc` (Dec 2024): "Ceremonies: Conjure entrypoint + first-time-friendly create UX"
- `d27988e0` (Jan 2025): "Workflow vs Ceremony nomenclature + template curation"

**Observation:** No evidence of a "read ceremonies.md file and auto-register workflows" phase. The LLM-powered translation (Conjure) always starts from *prose description in UI*, not file parsing.

### Current Formulate/Conjure Flow

**Located in:** `packages/client/src/components/formulate/`, `services/ceremony-translator.ts`

**Steps:**
1. User types prose description in FormulatePanel: "Every Monday at 9 AM, triage open issues…"
2. UI calls `/api/ceremonies/translate` → `ceremony-translator.ts`.
3. LLM invoked (one-shot SquadClient session) with strict JSON prompt.
4. LLM returns: `{ yamlContent, triggerKind, triggerConfig, warnings, rationale }`.
5. YAML validated against `validateWorkflowYaml()` (same schema as manual editor).
6. Row inserted into `workflows` table with `kind='ceremony'` and `parentNarrativeId=null` (or narrative ID if from a Narrative record).

**Input:** Prose (from UI text field or `.squad/narratives/` markdown file read by Narrative editor).
**Output:** Runtime ceremony YAML.
**Limitation:** Does not read from `.squad/ceremonies.md`. Built-in ceremonies (Design Review, Retrospective, etc.) are *never* auto-translated.

### Recommendation: Should We Restore an Import Flow?

**Pros:**
- ✅ Ceremonies.md becomes *executable*; changes auto-register new workflows.
- ✅ One source of truth: ceremonies.md defines, runtime instantiates.
- ✅ Reduces manual UI authoring for standard ceremonies.

**Cons:**
- ❌ Requires parsing prose ceremony format (prose → trigger detection, step inference).
- ❌ Ceremonies.md is human-readable (prose agendas), not machine-readable (no YAML steps).
- ❌ LLM translation already exists; adding a file-watcher + import layer is redundant.
- ❌ Team may want ceremonies.md as *reference* (read-only), not *config* (auto-executed).

**Verdict:** Should NOT restore. Instead:
- **Ceremonies.md remains spec / reference document** (human team process).
- **Runtime ceremonies are authored via UI or LLM translation**, with optional seeding from a `.squad/ceremonies/` YAML directory (not markdown).
- **Consider adding a "quick-start" workflow** that reads `.squad/ceremonies/*.workflow.yaml` and auto-registers them on project boot.

---

## Section 8 — Architecture Recommendations

### Option A: Current State (Spec ≠ Runtime)

**Ceremonies.md is aspirational; runtime is operational.**

- Ceremonies.md: team's process handbook (read by humans, team lead).
- Runtime: executable workflows (authored in UI, triggered by events/schedules).
- No sync, no import.

**Pros:** Simple, decoupled, flexible (team can deviate from spec).
**Cons:** Spec and reality drift; no single source of truth.

### Option B: Canonical YAML in `.squad/ceremonies/` + Exec Seeding

**Recommended for W28–W30.**

- Rename/migrate: `.squad/ceremonies.md` → `.squad/ceremonies/README.md` (reference).
- New: `.squad/ceremonies/*.workflow.yaml` (YAML ceremony definitions).
- On project init: read `.squad/ceremonies/*.workflow.yaml`, create workflow rows, skip if exists (idempotent).
- UI remains the primary authoring surface; CLI/SDK can also commit YAML.

**Pros:**
- ✅ Ceremonies are version-controlled and auditable.
- ✅ YAML is both machine-readable and hand-editable.
- ✅ Keeps ceremonies.md as human-facing reference.
- ✅ Incremental: no breaking changes to current UI.

**Cons:**
- ⚠️ Requires migration (copy 3 ceremonies from markdown spec → YAML).
- ⚠️ SDK needs a `readCeremonies()` or `seedCeremonies()` helper.

### Option C: Two-Way Sync (Future, Phase 17+)

**Ceremonies.md ↔ Workflows (bidirectional).**

- LLM markdown→YAML (already done by Conjure).
- Add YAML→prose for display (novel).
- File watcher on `.squad/ceremonies.md` → trigger translate on change.
- UI publishes changes back to ceremonies.md.

**Pros:** Single source of truth; spec and runtime always in sync.
**Cons:**
- ❌ High complexity (LLM round-trip, conflict resolution).
- ❌ Risk of merge conflicts in ceremonies.md.
- ❌ Prose format is fragile; YAML is more reliable for automation.

**Recommendation:** **Do NOT pursue Option C.** Option B is the sweet spot.

---

## Section 9 — Open Questions for Brady

1. **Ceremony ownership:** Should built-in ceremonies (Design Review, Retrospective, Retro with Enforcement) be auto-seeded on project boot, or only created when a team explicitly requests them in the UI?

2. **Ceremonies.md evolution:** Is `.squad/ceremonies.md` meant to be a read-only reference forever, or should it become a configuration file that teams edit (and we parse)?

3. **Scope vs. Participants:** Ceremonies.md talks about "all-relevant" and "all-involved"; should the runtime surface a first-class concept of scope, or remain step-level (hard-coded reviewers counts)?

4. **Formulate throttle:** Current LLM-based ceremony translation throttles to 3 per 60s per ceremony. Is this the right rate limit? Should there be per-project or per-user caps?

5. **GitHub event scope:** Ceremonies support GitHub event triggers with label/branch/author_team filters. Should we expand to more filters (PR size, review state, milestone)?

---

## Section 10 — W28 Ceremonies-Overhaul Implementation TODOs

### Phase 1: Clarify & Seed (1–2 days)

- [ ] **T1**: Document current ceremony instance count in live project (grep workflows table for kind='ceremony').
- [ ] **T2**: Decide: auto-seed the 3 built-in ceremonies (Design Review, Retrospective, Retro+Enforcement) or leave manual.
- [ ] **T3**: If auto-seeding: add Phase 11 migration that creates ceremony rows on first project init (idempotent).
- [ ] **T4**: Audit: ensure no ceremonies.md prose → YAML translation happens outside Conjure/Formulate.

### Phase 2: YAML Canonicalization (2–3 days)

- [ ] **T5**: Migrate: write the 3 built-in ceremonies as `.squad/ceremonies/*.workflow.yaml` (skeleton; users customize trigger/agents).
- [ ] **T6**: SDK helper: `squadboard.ceremonies.readFromDir(path)` → load all YAML, validate, return array.
- [ ] **T7**: CLI command: `squad ceremonies import [path]` → read .yaml files, call runtime to register.
- [ ] **T8**: Test: verify YAML ceremonies round-trip through visual editor without loss.

### Phase 3: UI/UX Polish (1–2 days)

- [ ] **T9**: Ceremonies list: add column "Source" (built-in | user-authored | translated-from-prose) for visibility.
- [ ] **T10**: Ceremony editor: show breadcrumb / provenance (e.g., "Translated from narrative on 2026-05-10").
- [ ] **T11**: Drafts review page: highlight auto-drafted ceremonies so users can decide: approve, refine, or discard.

### Phase 4: Verification & Docs (1–2 days)

- [ ] **T12**: End-to-end test: create ceremony via UI, export YAML, import back, verify round-trip fidelity.
- [ ] **T13**: Document in `.squad/ceremonies/README.md`: format, authoring guide, inheritance/override examples.
- [ ] **T14**: Add integration test: trigger a ceremony by its spec condition (e.g., auto-trigger Retrospective on test failure).

### Phase 5: Observability & Hardening (1–2 days)

- [ ] **T15**: Add logging: `[ceremony] auto-seeded {name} on project init` + link to review page.

---

## Top 3 Misalignments

1. **Ceremonies.md is unexecuted spec.** The 3 ceremonies in `.squad/ceremonies.md` (Design Review, Retrospective, Retro with Enforcement) are *never* instantiated in the runtime. No auto-registration, no import flow, no project boot seeding. A team must author them from scratch in the UI or API.

2. **No condition detection for "before" ceremonies.** Ceremonies.md says "auto before multi-agent task" but the runtime has no logic to detect "multi-agent task started" events. Would need orchestrator to emit a signal and ceremonies dispatcher to listen.

3. **Visual editor allows branching; spec uses linear steps.** The H3 canvas supports route steps with multiple conditions; ceremonies.md templates are single-threaded. No spec coverage for conditional branching or fan-out scenarios.

---

## Import-from-Markdown Verdict

**Current status:** ❌ No import flow exists.

**Should we add one?** **NO.** Instead:
1. Keep ceremonies.md as aspirational **reference** (team handbook).
2. Add `.squad/ceremonies/*.workflow.yaml` for **canonical** ceremony definitions.
3. LLM-based Conjure remains the primary **authoring** surface (prose → YAML).
4. SDK provides `readCeremonies()` helper for **seeding** at init time.

---

## Recommended W28 Ceremonies-Overhaul Item Titles

1. **Clarify ceremony origin & provenance** — Surface where each ceremony came from (built-in, user-authored, LLM-translated).
2. **Auto-seed built-in ceremonies on project init** — Design Review, Retrospective, Retro+Enforcement available by default.
3. **Canonicalize ceremonies as `.squad/ceremonies/*.workflow.yaml`** — YAML-first workflow definitions, version-controlled.
4. **Round-trip visual editor → YAML → visual editor** — Verify no fidelity loss in ceremony graph serialization.
5. **Expand GitHub event trigger filters** — Support size, review state, milestone in addition to label/branch/author_team.
6. **Auto-detect & trigger "before" ceremonies** — Emit "multi-agent task started" event when orchestrator spawns a batch.
7. **Document ceremony lifecycle** — Spec, authoring, versioning, deployment, observability.
8. **Add ceremonies to project templates** — Starters (AB-test-orchestrator, etc.) include ceremony YAML.
9. **Throttle LLM ceremony translation per project** — Cap formulate calls per project per day.
10. **Audit existing ceremonies** — Count live ceremonies by kind/trigger/status; flag orphans or failures.

---

## Surprising Findings

- **Retro-enforcement has no ceremony instance.** The `retro-enforcement` skill checks if a retrospective is overdue, but there's no corresponding automation-trigger ceremony row. The sweep logic is in the skill, not the ceremony system.
- **Anchor issue fallback is clever but fragile.** When a scheduled ceremony fires with no natural issue, the scheduler picks the project's most-recent non-child issue. This works, but if all issues are fan-out children, the ceremony skips silently.
- **Prose → YAML has no validation loop.** The LLM can generate syntactically valid YAML that `validateWorkflowYaml()` accepts, but there's no human review step before the workflow goes active. (The UI shows draft status, but this is post-translation, not pre.)
- **Visual canvas does NOT respect ceremonies.md format.** You can author linear stepwise ceremonies (matching the spec), but there's no schema validator that says "this ceremony must match the 'Simple Review' template."

---

## Appendix: File Paths Reference

| File | Role |
|------|------|
| `.squad/ceremonies.md` | Team ceremony spec (human-readable) |
| `docs/concepts/ceremonies.md` | Broader ceremony templates & YAML syntax guide |
| `packages/server/src/services/ceremony-dispatcher.ts` | Event-based trigger handler (Phase 10) |
| `packages/server/src/services/ceremony-scheduler.ts` | Cron sweep & scheduled trigger handler (Phase 10) |
| `packages/server/src/services/ceremony-translator.ts` | Markdown narrative → YAML translator (Phase 11) |
| `packages/server/src/db/schema.ts` | DB tables: workflows, workflowVersions, ceremonySchedules, etc. |
| `packages/client/src/pages/CeremonyList.tsx` | Fluent2 ceremony list UI |
| `packages/client/src/pages/CeremonyEditor.tsx` | Multi-tab ceremony authoring (Prose, Code, Visual) |
| `packages/client/src/components/ceremony/VisualCanvas.tsx` | H3 visual ceremony editor canvas (Phase 16) |
| `packages/client/src/components/formulate/FormulatePanel.tsx` | LLM prose → ceremony translation input panel |
| `.github/agents/squad.agent.md` | Squad agent charter; Ceremonies section at L955 |

---

**End of research.**
