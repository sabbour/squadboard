# Decision: Parks and Recreation Added to Local Universe Registry

**Date:** 2026-05-15T10:38:30.000-07:00
**Author:** Kobayashi (SDK Integrator)
**Requested by:** Ahmed Sabbour (quick follow-up to `785db624`)

---

## What Changed

Added `'parks-and-rec'` as the fourth `LocalUniverseId`. The `LOCAL_UNIVERSES` record in `local-universes.ts` now contains:

| Universe | Label | Characters |
|---|---|---|
| `the-office` | The Office | 15 |
| `seinfeld` | Seinfeld | 10 |
| `the-simpsons` | The Simpsons | 14 |
| `parks-and-rec` | Parks and Recreation | 14 |

**Total local characters:** 53
**Picker now shows:** 6 universes (2 SDK + 4 local)

## Parks & Rec Character Roster (14)

Leslie Knope (`lead`), Ron Swanson (`reviewer`, `devops`, `security`), Tom Haverford (`designer`, `prompt-engineer`), Ann Perkins (`tester`, `reviewer`), April Ludgate (`developer`, `security`), Andy Dwyer (`developer`, `prompt-engineer`), Ben Wyatt (`lead`, `tester`), Chris Traeger (`lead`, `prompt-engineer`), Donna Meagle (`devops`, `reviewer`), Jerry/Garry Gergich (`scribe`, `reviewer`), Mark Brendanawicz (`developer`, `tester`), Jean-Ralphio Saperstein (`prompt-engineer`, `designer`), Tammy Swanson (`security`, `reviewer`), Mona-Lisa Saperstein (`designer`, `prompt-engineer`).

All 9 `AgentRole` values (`lead`, `developer`, `tester`, `prompt-engineer`, `security`, `devops`, `designer`, `scribe`, `reviewer`) are covered within this universe.

## Future Universe Queue

The registry pattern is proven and low-friction — each addition is an additive change to one file (`local-universes.ts`) with no SDK interaction required. Candidate passes for future rounds:

- **Mad Men** — good fit for `lead`/`designer`/`prompt-engineer` archetypes (Don, Peggy, Roger, Joan, Pete…)
- **Succession** — strong `lead`/`reviewer`/`security` coverage; dark ensemble energy
- **Silicon Valley** — natural `developer`/`devops`/`tester` cast; startup-coded
- **Seinfeld coordinator symmetry** — Seinfeld universe currently has no `scribe` as first preferred role; Susan covers it but a future pass could audit role-coverage gaps across all universes and patch thin spots

Open question from wave 6 carries forward: should `listUniverses()` accept a per-project allowlist? Parks & Rec and The Office would often want to co-exist for workplace-flavoured projects.
