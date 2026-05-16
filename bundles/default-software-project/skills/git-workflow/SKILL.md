# Git Workflow

**Category:** engineering

Standard branch-based git workflow: feature branches, atomic commits, PR discipline.

## Git Workflow

Follow this discipline for all code changes:

1. **Branch naming**: `<type>/<short-description>` — e.g. `fix/login-crash`, `feat/kanban-reorder`.
2. **Atomic commits**: Each commit is a single logical change. Commit message: `<type>: <what and why>` (≤72 chars).
3. **Co-authored-by trailer**: Always include `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>` on agent-authored commits.
4. **PR checklist before merge**: tests pass, no TODO/FIXME left behind, docs updated if public API changed.
5. **Never force-push shared branches.** Only force-push personal branches after explicit agreement.
