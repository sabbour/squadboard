# Squad Decisions

## Active Decisions

### 2026-05-14T08:17:03Z: Project pivot — "foo" → Squadboard
**By:** Ahmed Sabbour (via Coordinator)
**What:** This repo is now the build for **Squadboard** — a local-first kanban + workflow board for Squad agents. Package `@sabbour/squadboard`, MIT, self-hosted.
**Why:** PRD landed at `/home/asabbour/.copilot/session-state/b22555db-ec9d-4ffd-9266-4553cda5bb11/research/squad-web-design-v4.md` (~90KB, 15-demo roadmap). Original "foo" placeholder is retired.
**Stack:** Node + Express v5 · Postgres (embedded local / hosted cloud) + Drizzle · React 19 + Vite · WebSocket · Squad SDK · GitHub API.

### 2026-05-14T08:17:03Z: Team augmented for Squadboard
**By:** Ahmed Sabbour (via Coordinator)
**What:** Added 4 specialists to the existing 4-person team (Usual Suspects universe maintained):
- **Hockney** — Backend / Workflow Engine Dev
- **Kobayashi** — Squad SDK Integrator
- **Kujan** — Tester / QA (reject authority on durability + recovery contracts)
- **Redfoot** — DevRel / Docs (reject authority on user-facing copy)

Re-roled **Verbal** from "Interaction Dev" → "Real-time / WebSocket Dev" (project-scoped WS, event_log fan-out, since-id reconnect cursor, Live ops view feed).

Existing roles unchanged: McManus (Lead Architect), Keyser (Frontend Dev), Fenster (UX Designer).
**Why:** "foo"'s original 4 were a web-design team; Squadboard needs full-stack muscle.

### 2026-05-14T08:17:03Z: Five non-negotiable engine invariants (PRD §6.0)
**By:** Ahmed Sabbour (via PRD intake)
**What:**
1. `agent_run` is the only step that does LLM work. `peer_review`, tier-3 routing, and `split` desugar to `issue_runs` rows with distinct `kind` values.
2. **Single-spawner discipline.** The stepper alone spawns runs via `FOR UPDATE SKIP LOCKED`. The dispatcher only ticks/sweeps/wakes — never touches `issue_runs` except via sweepers.
3. Lease (90s TTL) + heartbeat (30s) is the authoritative liveness signal. `kill(pid, 0)` is an in-pod sanity check only.
4. Output schema validation happens at session end — after `sendAndWait` returns, before `recordRunCompletion`. Never on the post-tool-use hook.
5. `fan_out` and `split` materialize full child `workflow_runs` rows in one six-step transaction (issue + workflow_run + first step_run + issue_link + handoff_context + variables propagation). Children inherit `pinnedAgentRevisions` from parent.

**Enforcement:** Kujan has reject authority on PRs that violate these. Hockney owns implementation. McManus owns adjudication of any proposed change.

### 2026-05-14T08:17:03Z: Bypass `SquadCoordinator` (PRD Appendix A)
**By:** Ahmed Sabbour (via PRD intake)
**What:** The Squadboard engine reads `task.assignee` directly and calls `SquadClient.createSession()` for that one agent. Coordinator's regex routing and parallel fan-out are NOT used by the engine.
**Why:** Coordinator's parallel fan-out and ad-hoc handoffs are exactly what Squadboard exists to escape. We need deterministic, single-spawner orchestration with durable state.
**Owner:** Kobayashi.

### 2026-05-14T08:17:03Z: Postgres, not SQLite
**By:** Ahmed Sabbour (via PRD §6.13)
**What:** Storage is Postgres everywhere — embedded `embedded-postgres` (~50MB binary) for local install, hosted Postgres for cloud. Same Drizzle schema, same SQL surface (`FOR UPDATE SKIP LOCKED`, partial unique indexes, JSONB, recursive CTEs, tsvector).
**Why:** Same SQL across local + cloud is worth more than a smaller binary. SQLite was considered and rejected.
**Owner:** Hockney.

### 2026-05-14: PRD canonicalization
**By:** McManus (Lead Architect)
**What:** `docs/prd.md` (~12KB) is the canonical PRD for Squadboard. The research doc (`squad-web-design-v4.md`, 90KB) is the deep design appendix — implementation spec only. The five engine invariants are pasted verbatim into PRD §5. Roadmap = one-line-per-demo only. Verbal listed under re-roled title (Real-time / WebSocket Dev, not Interaction Dev).
**Next:** Redfoot to copy-pass for voice/clarity on `docs/prd.md`. Deep design file to be moved into repo proper (separate routing).

### 2026-05-14: Hacking phase workflow
**By:** Ahmed Sabbour (via Copilot)
**What:** We are in **hacking phase**. (1) Local git only. (2) Use worktrees per issue (`squad/{issue-number}-{slug}` branch). (3) No PRs. (4) Merge frequently into `main` locally. (5) Reviewer rejections (Kujan/Redfoot) happen inline on branch before merge, not via PR. Standard PR workflow resumes when user says "exit hacking phase".
**Why:** User directive — explicit team operating mode for current development phase.

### 2026-05-14: PRD copy pass approved
**By:** Redfoot
**What:** Copy pass on `docs/prd.md` complete and ✅ approved. 12,331 → 12,195 bytes (5 surgical edits). Tightened vision with active problem statement; simplified scope table grammar; improved architecture signal-to-noise; polished tech-stack links; removed instructional trailer. The 5 engine invariants verified paste-locked against `decisions.md`. 14-section structure intact. No follow-up issues flagged. Treat as final for hacking phase.
**Owner:** Redfoot (reject authority on user-facing copy).

### 2026-05-14: Top-level README authored
**By:** Redfoot
**What:** `README.md` at project root, 5,024 bytes. Hero banner uses `assets/squadboard-horizontal.svg` (full width, centered); smaller logo uses `assets/squadboard.svg` (bottom, inline with team names). 10 sections in show-before-tell order (quick-start precedes architecture). All content sourced from `docs/prd.md` — zero invention. Hacking-phase compliant: no Contributing/PR section, no CI badges, no npm badge. Honest status section notes "hacking phase, pre-1.0, breaking changes expected". Brand assets (both SVGs + square PNG) committed alongside.
**Source:** `decisions/inbox/redfoot-readme.md` (merged, inbox deleted).

## Governance

- All meaningful changes require team consensus
- Document architectural decisions here
- Keep history focused on work, decisions focused on direction
- The five engine invariants above are non-negotiable without an explicit decision entry overriding them
