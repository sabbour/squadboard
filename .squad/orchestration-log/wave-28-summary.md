# Wave 28 Orchestration Summary

**Closed:** 2026-05-16  
**Duration:** Hacking phase sprint (start of sustained delivery post-PD approval)

---

## Wave 28 Overview

Wave 28 closed the Jump Into Session (JIS) design-to-ship pipeline, delivered hardened cost calculation with critical Haiku rate fix and 8 missing models, shipped J3 SSE streaming + 3s WS fallback and J5 coordinator context injection (8K budget with privacy redaction), implemented comprehensive migration safety (rollback hooks + dry-run + snapshots), shipped ceremonies diagnostics (CER-1 origin badges + CER-8 audit endpoint), and initiated ceremonies overhaul research. This wave marked the transition from infrastructure stabilization (W26-W27) to feature-delivery scaling: 23 todos delivered, 13 critical items rolled to W29 alongside the mini-coordinator (MC) 14-item slate.

---

## Delivered (23 todos)

### Design & Research (2)
- **w28-jump-into-session-design-doc** — JIS end-to-end spec (schema, bridge events, registry, client hooks, steer protocol). Commit: `2ac47487`
- **w28-mini-coordinator-design-doc** — Coordinator context architecture (8K budget, privacy redaction, context assembly). Commit: `12169c76`

### Jump Into Session (JIS) — T1-T10, T12 (10 items)
- **JIS-T1 (schema + migration)** — `issue_run_events` table (bigserial PK, indexed by run_id, seq). Commit: `f62e1bd6`
- **JIS-T2 (session class)** — `RunningIssueSessionImpl`, self-registration in registry, event emit to DB + bus. Commit: `a92f6d39`
- **JIS-T3 (bridge events)** — Session lifecycle events in `executeAgentRun`: start → turn → metric → finish (success) or error. Commit: `a92f6d39`
- **JIS-T4 (steer endpoint)** — `POST /api/projects/:projectId/issues/:issueId/runs/:runId/steer` with validation. Commit: `a92f6d39`
- **JIS-T5 (active registry)** — In-memory registry with get/set/unregister ops. Commit: `f62e1bd6`
- **JIS-T6 (events query)** — `GET /api/projects/:projectId/issues/:issueId/runs/:runId/events` (since_seq support). Commit: `f62e1bd6`
- **JIS-T7 (useRunStream hook)** — Client-side WS listener + event buffering + reconnect handling. Commit: `aa909f30`
- **JIS-T8 (LiveRunViewer)** — Component rendering live event stream (turn-by-turn transcript, token counter). Commit: `aa909f30`
- **JIS-T9 (Watch button)** — Eye icon on running issue cards, navigates to `/projects/:pid/issues/:iid/runs/:rid/live`. Commit: `fff70477`
- **JIS-T10,T12 (reconnect + tests)** — 3-strike WS failure counter, retry() method, E2E smoke tests. Commit: `fff70477`

### Cost Calculation (5 items)
- **COST-1 (Haiku rates fix)** — Input 0.25→1.00, output 1.25→5.00 USD/M. CRITICAL 4-5× correction. Commit: `b954fe18`
- **COST-2 (add 8 models)** — GPT-5.5, GPT-5.4-mini, Gemini 2.5/3/3.1, Claude Opus 4.7 variants, Raptor mini, Goldeneye. Commit: `b954fe18`
- **COST-4 (consult premiums)** — End-to-end premium request tracking + multiplier verification. Commit: `b954fe18`
- **COST-3 (cached tokens schema)** — `cachedInputTokens` column + 10% rate calculation. Commit: `00ef812d`
- **COST-5b (drift alarm)** — Snapshot test suite (gated env flag) for rate-table drift detection. Commit: `00ef812d`

### Migration Safety (1)
- **I9 (migration safety)** — Rollback hooks + dry-run + snapshots + skip flag + `_migration_log` table. Commit: `a35226ab`

### Ceremonies (CER) (2)
- **CER-1 + CER-8 (origin badges + audit)** — Ceremony origin derivation (templateId → sourceYamlPath → parentNarrativeId → user-created). OriginBadge component + CeremonyAudit page with orphan/dead detection. Commit: `0604f914`
- **CER-10 (research + planning)** — Ceremonies overhaul roadmap (8 recommended W28 items). Commit: `58852130` (research)

### Streaming & Context (2)
- **J3 (SSE streaming)** — SSE alternative transport, 3s WS→SSE fallback, 100-event resume buffer, 15s heartbeats. Commit: `fe14d8dc`
- **J5 (coordinator context)** — 8K token budget, variable-section-only cap, privacy redaction, ContextPanel. Commit: `07790f6d`

---

## Test Deltas

| Package | Before | After | Δ |
|---------|--------|-------|---|
| server | 894 | 972 | +78 |
| client | 93 | 127 | +34 |
| **Total across packages** | — | 1099+ | — |

Key additions:
- Cost calculation tests (51 new): Haiku rates, models, premiums, cached tokens, drift alarm
- Migration safety tests (16 new): schema, rollback files, snapshots, env flags
- JIS tests (44 new): session registry, bridge events, steer endpoint, useRunStream hook, LiveRunViewer, reconnect
- Ceremonies tests (46 new): origin derivation, audit logic, UI components
- J3 tests (4 new): SSE stream resume, heartbeat, fallback
- J5 tests (embedded in context tests): coordinator context assembly

---

## Architectural Highlights

1. **JIS Room Scoping** — Events routed via projectId room (not per-run room). Client filters by `payload.runId === runId` at handler level. Scalable to per-run isolation via `subscribeRoom` pattern if needed.

2. **SSE + WS Hybrid** — 3-second fallback timeout governs switch. Native WS ping/heartbeat every 15s per connection; SSE uses `:heartbeat\n\n` comment lines. Resume buffer (100 events) covers realistic reconnect windows.

3. **DirectResponseHandler Import** — Must be imported from `@bradygaster/squad-sdk/coordinator` subpath, NOT from main barrel (`dist/index.d.ts`). Covers status/help/config/roster/greeting with short-circuit emission of `consult.message_complete`.

4. **Coordinator Context 8K Token Budget** — Applies only to variable sections (decisions, orchestration-log, view); identity (squad.agent.md ~22K) not counted. Truncation order (fallback): orchestration-log → decisions tail → view tail. Privacy redaction: KEY=value, xox*, ghp_, github_pat_, Bearer patterns.

5. **Migration System Idempotence** — Dry-run (`MIGRATIONS_DRY_RUN=1`), rollback files (`.rollback.sql`), schema snapshots (`.squad/db-snapshots/`), skip flag (`SKIP_BOOTSTRAP_DDL=1`), checksum tracking in `_migration_log`. Supports rollback via `pnpm run migrate:rollback -- --to=<version>`.

6. **Cost Model Dual Path** — Projects can render costs as USD or premium requests. Rate tables now comprehensive: 50+ models with Haiku corrected, 8 new models added, cached tokens at 10%, multipliers (Opus 10×, Sonnet 1×, Haiku 0.25×, included 0×).

7. **Ceremony Diagnostics** — Origin (computed field, no schema migration needed) paired with audit endpoint (orphan detection: active + 0 runs in 30 days; dead detection: event trigger with github sync off, or schedule trigger with no ceremonySchedules row).

---

## Rolled to W29 (13 items)

These join the existing W29 14-item MC (mini-coordinator) slate to form a 27-item W29 delivery scope:

**Ceremonies Overhaul (8)**
- w28-cer-2-auto-seed-builtin
- w28-cer-3-canonicalize-yaml
- w28-cer-4-roundtrip-fidelity
- w28-cer-5-gh-event-trigger-filters
- w28-cer-6-auto-before-detection
- w28-cer-7-document-lifecycle
- w28-cer-9-templates-include-ceremonies
- w28-ceremonies-overhaul

**Workflow Infrastructure (3)**
- i4-workflow-checkpointing
- i5-agent-crash-detection
- i6-db-integrity-maintenance

**Observability & Diagnostics (2)**
- i8-health-diagnostics-surface
- w28-jump-t11-steering-persistence-optional

**Mini-Coordinator Slate (14 — MC-1 through MC-14)**
- Architecture: coaching-mode Coordinator, semantic caching, token budgeting, output formatting, API integration

---

## Open Questions Still Pending Brady's Input

### Mini-Coordinator (Q1–Q3)
- **Q1:** Should agent preamble (identity) live in squad.agent.md or orchestration-log?
- **Q2:** Model mode: use fixed Sonnet 4.5, or allow model override per project?
- **Q3:** CLI `ask` / `--coach` fragment — does `$([...])` shell syntax for inline context acceptable?

### JIS Design (Q1–Q4)
- **Q1:** Should SDK support mid-stream interrupt (client can cancel agent mid-turn)?
- **Q2:** Budget guardrails — fail gracefully or queue excess steer messages?
- **Q3:** Mobile UX — side panel vs overlay vs tab switch?
- **Q4:** Should JIS emit an audit table (timestamp, actor, message, response)?

### Cost Research (3 buckets)
- **AI Credits opt-in:** Should free-tier projects see "credits exhausted" banners, or silent failure?
- **Free-tier badge:** Mark projects as free/paid in cost dashboard?
- **Historical re-pricing:** When rates change (e.g., Haiku), should we backfill historical runs?

### Ceremonies Research (5 Qs)
- **Q1:** Built-in auto-seed on project boot — on/off?
- **Q2:** ceremonies.md read-only forever, or teams edit + we parse?
- **Q3:** Scope (all-relevant vs all-involved) as first-class runtime concept?
- **Q4:** Formulate throttle rate (3 per 60s per ceremony) — correct?
- **Q5:** GitHub trigger filters — expand beyond label/branch/author_team?

---

## Hygiene Incidents Recap

### Commit-Sweep Incidents (3)
1. **`2ac47487`** (design doc) — concurrent agents swept unrelated files into commit
2. **`12169c76`** (coordinator design doc) — same sweep pattern
3. **`58852130`** (cost + ceremonies research) — same pattern

**Mitigation:** Explicit file-list spawn instructions worked well for later batch commits (`f62e1bd6`, `a92f6d39`, `aa909f30`, `fff70477`, `b954fe18`, `00ef812d`, `a35226ab`, `0604f914`, `fe14d8dc`, `07790f6d`).

### Side-Branch Incident (1)
- **`00ef812d`** (COST-3, COST-5b) — committed from `w28-cost-residual` branch, later FF'd to main. Noted in commit message.

**Learning:** Branch discipline improved mid-wave. All subsequent commits went directly to main branch per team hygiene rules.

---

## Key Metrics

| Metric | Value |
|--------|-------|
| Todos Shipped | 23 |
| Todos Rolled | 13 |
| Test Delta | +146 net new tests |
| Server Files Changed | ~20 files |
| Client Files Changed | ~18 files |
| New Tables | 1 (issue_run_events) |
| Schema Migrations | 2 (issue_run_events, cached_input_tokens) |
| Commits Delivered | 10 |

---

## Transition Notes

**From W27 to W28:** W27 closed with heartbeat surface stabilization + sweep timeline fixes. W28 transitioned from ops focus to feature delivery: JIS live observability + cost rigor + ceremony diagnostics. The 10-commit wave (vs prior single-batch approach) reflects stable CI/CD and agents' improved parallel coordination.

**To W29:** W29 slate (27 items: 13 rolled + 14 mini-coordinator) is historically large; recommend staged delivery with checkpoint at week 2 (TC mid-wave review). Ceremonies overhaul and mini-coordinator are heavy-lift items; pair with JIS T11 steering polish + cost residual (cached write tokens + free-tier badge).

---

**Document prepared by:** Scribe (wave-28 close-out)  
**Date:** 2026-05-16T14:30:00Z
