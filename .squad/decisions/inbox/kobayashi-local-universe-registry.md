# Decision: Local Universe Registry — The Office, Seinfeld, The Simpsons

**Date:** 2026-05-15
**Author:** Kobayashi (SDK Integrator)
**Requested by:** Ahmed Sabbour

---

## Problem

Ahmed reported that the Hire Team picker only showed "The Usual Suspects" and "Ocean's Eleven", despite requesting Seinfeld in a previous session. The SDK's `UniverseId` type is a sealed union (`'usual-suspects' | 'oceans-eleven' | 'custom'`) with no extensibility API — the SDK ships exactly two named universes and there is no `registerUniverse()` or equivalent.

---

## Decision: Squadboard-side Local Registry (not SDK PR / fork)

**Chosen:** A `local-universes.ts` module in `packages/server/src/services/` that lives entirely within the Squadboard monorepo and is merged with the SDK output at the `casting-engine.ts` wrapper layer.

**Rationale:**
- PRing the SDK would introduce an upstream dependency on a release cycle we do not control; the SDK maintainer may not want show-specific content in the core package.
- Forking the SDK requires maintaining a divergent copy, which has compounding cost.
- The `casting-engine.ts` wrapper is Kobayashi's file and is explicitly the right place for SDK augmentation per the charter. Merging in `listUniverses()` and routing in `castTeam()` is a surgical, localised change.
- Future universes (Mad Men, Parks & Rec, Succession) can be added to `LOCAL_UNIVERSES` in minutes — no SDK interaction required.

**Workaround for sealed type:** `ExtendedUniverseId = Exclude<UniverseId, 'custom'> | LocalUniverseId` gives the type system what it needs without touching the SDK or casting it to `any` at the boundary.

---

## Universes Added (this batch)

| Universe | Label | Characters |
|---|---|---|
| `the-office` | The Office | 15 |
| `seinfeld` | Seinfeld | 10 |
| `the-simpsons` | The Simpsons | 14 |

**Total new characters:** 39
**Total universes now available:** 5 (2 SDK + 3 local)

---

## Future Additions

If Ahmed wants more universes (Mad Men, Parks & Rec, Succession, etc.), the `LOCAL_UNIVERSES` record in `local-universes.ts` is the right place — just add a new `LocalUniverseId` member to the union and a corresponding entry in the record. `listUniverses()` and `castTeam()` pick them up automatically.

---

## Open Question

**Should `listUniverses()` accept a per-project override?**
Some projects might only want a subset of universes (e.g. a workplace-comedy project could default to The Office and hide heist themes). Currently the full merged list is always returned. A future `project.universeAllowlist` config field could filter this. Out of scope now — flagged for follow-up.
