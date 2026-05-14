---
updated_at: 2026-05-14T08:47:34Z
focus_area: Squadboard — hacking phase
phase: hacking
workflow:
  remote: local-only (no remote pushes required)
  branches: worktrees per issue (squad/{issue-number}-{slug})
  reviews: inline on branch before merge (no PRs)
  merges: frequent, direct to main (no PR gate)
active_issues: []
---

# What We're Focused On

Building Squadboard from the PRD that landed in `docs/prd.md` (canonical) and the deep-design source at `/home/asabbour/.copilot/session-state/b22555db-ec9d-4ffd-9266-4553cda5bb11/research/squad-web-design-v4.md` (appendix).

## Current phase: HACKING

- ✅ Work in local git
- ✅ Use worktrees for isolated feature/issue work
- ❌ Do NOT create pull requests
- ✅ Merge frequently into `main` locally

Reviewer rejections (Kujan on durability/recovery, Redfoot on user-facing copy) happen inline on the branch *before* merge, not via PR. The strict-lockout rule still applies — a different agent owns any rejected revision.

The standard PR workflow resumes only when the user says "exit hacking phase" / "we're shipping" / "open PRs". Until then, `github_pr` and `github_pr_wait_merged` workflow steps in the PRD apply to Squadboard the *product* (what end users get), not to our own development workflow.

## Next likely work

- McManus is finishing the canonical PRD distillation (in flight at the time this was written)
- After PRD lands → Demo 1 work (Hello Squadboard + first project)
