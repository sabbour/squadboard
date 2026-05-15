# McManus — History

## Core Context

- **Project:** A web design project (v4 iteration) for the Squad product site
- **Role:** Lead Architect
- **Joined:** 2026-05-14T08:12:50.169Z

## Learnings

- **2026-05-14 Project Pivot:** Web design project expanded to **Squadboard** — local-first kanban + workflow board for Squad agents. Team augmented from 4 to 10 members. New teammates: Hockney (Backend), Kobayashi (SDK), Kujan (QA), Redfoot (DevRel), plus Ralph (Coordinator) and Scribe (Logger). Verbal re-roled to Real-time/WebSocket Dev. Squadboard PRD adopted as source of truth; ready for Demo 1 work.

- **2026-05-14 PRD Written:** Created `docs/prd.md` (~12KB) as the canonical executive-layer PRD. Key distillation calls:
  - **Cut:** All schema details, full demo exit criteria, user journey walkthroughs, SDK wiring specifics, step catalogue internals. These stay in the deep design.
  - **Kept:** The five invariants verbatim (they're contracts); one-line roadmap (links to deep design for detail); non-goals as a flat table (devs skim tables, skip prose); architecture as a single paragraph + pointer.
  - **Judgment call:** Framed "scope" as capabilities (what users get), not components (what engineers build). The PRD is a product brief, not a tech spec — that's the deep design's job.
  - **Pattern:** When distilling a research doc into a PRD, the rule is: the PRD answers "what and why"; the research doc answers "how." If a section requires reading code or schema to understand, it belongs in the research doc, not the PRD.
  - **Next:** Redfoot should copy-pass for voice. Deep design file needs to move into the repo proper.

- **2026-05-14 Deliverables Decomposition:** Decomposed PRD into `docs/deliverables.md` — 15 demos, dependency graph, owner assignments. Demo 1 (Hello Squadboard) has no dependencies; Demos 14-15 depend on most prior work. Key architectural insight: demos split cleanly into Foundation → Engine Core → Board UI → Workflow → Advanced layers. Owner assignments follow domain routing: Hockney owns engine-heavy demos, Kobayashi owns SDK seams, Keyser owns UI-primary demos, Verbal owns real-time.

- **2026-05-15 Phase 8 Vertical Slice — Column Metadata Overlay:** Shipped per-project column rename/describe/recolor as a focused first slice of the larger Phase 8 epic. Key pattern: **overlay table, not enum replacement.** A new `column_meta` table stores label/description/color overrides per (project_id, column_id) pair. The existing `column_status` enum is untouched; Phase 8 proper (multi-board, `board_columns` table replacing the enum, presets, pickup_behaviour, scope-resolved default workflow) can rebuild on top of this without losing user-authored column descriptions. The `column_meta` rows carry over 1:1 into `board_columns` when that migration lands. Used `withTimezone: true` on both timestamp columns to be born Hockney-compliant. Delivered: idempotent bootstrap DDL, GET/PATCH/POST-reset API routes, `useColumnMeta`/`useUpdateColumn`/`useResetColumns` hooks, KanbanColumn 4px accent border + Fluent2 Tooltip on description hover, ColumnSettingsPanel drawer with 8-swatch color picker. Gear icon added to board header to open the drawer.

## Recent team activity

New decisions merged to `.squad/decisions.md`:
- Demo 9 open question #2: `request_changes_policy` default is `'first'` (Hockney)
- Demo 12 open question #6: Optimistic concurrency for concurrent issue edits (Verbal)
- Demo 15 open question #8: GitHub issue mirroring OFF by default, opt-in per project (Hockney)

See `.squad/decisions.md` for full details.

Multi-agent fanout session completed 2026-05-15T12:35:00Z:
- 5 agents shipped (2 keyser rounds, mcmanus, hockney, verbal)
- 5 commits landed (42c120a0, d74c9622, d7cc2ada, 4d9fb813, base a97e2bce)
- 2 agents in flight (fenster, kobayashi)

Session log: `.squad/log/2026-05-15T12:35:00Z-squad-fanout.md`

