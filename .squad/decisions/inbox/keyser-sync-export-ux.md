# Sync export UX decision

Date: 2026-05-20T04:16:33.702-07:00  
Owner: Keyser

## Decision

- DB-backed projects with no live filesystem mirror should read as **Ready through Squadboard**, not as a bridge/configuration warning.
- Preview Export is an explicit filesystem handoff. Dry-run previews should list meaningful changes only; unchanged / already-up-to-date file rows should be hidden behind a compact count.

## Rationale

Users need to know what to do next, not which provider/env-var path exists internally. The UI should make the safe path obvious: continue through Squadboard, or export `.squad` files only when handing off to filesystem-based tools.
