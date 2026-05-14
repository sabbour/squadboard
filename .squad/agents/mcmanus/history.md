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

