# Decision: Squad Git Branch Convention

**Date:** 2026-05-15T22:42:29.855-07:00
**Author:** Verbal (Real-time / WebSocket Dev)
**Wave:** 16
**Status:** Accepted
**Relates to:** Stream G Phase 1 (G1.3)

---

## Branch Naming Convention

### Agent runs

```
squad/{agent-name-lowercased}/{slug-from-issue-title}
```

Examples:
- `squad/keyser/use-template-prefill-fix`
- `squad/verbal/push-branch-ui`
- `squad/hockney/worktree-strategy-cleanup`

### Ceremony runs (spanning multiple agents or driven by a ceremony slug)

```
squad/ceremony/{ceremony-slug}-{run-id-suffix}
```

Examples:
- `squad/ceremony/scribe-close-out-w15`
- `squad/ceremony/wave16-agent-fanout-a3b9`

### Slug derivation rules

1. Lowercase
2. Replace any run of non-alphanumeric characters with a single `-`
3. Strip leading and trailing `-`
4. Agent name truncated to 30 characters
5. Issue title truncated to 50 characters
6. Result: no shell metacharacters; safe to use in `git worktree add -b <branch>`

---

## Implementation

The convention is implemented in `packages/server/src/engine/workspace.ts`:

```typescript
export function deriveSquadBranchName(agentName: string, issueTitle: string): string
```

Called from `stepper.ts` when `workspaceStrategy === 'worktree'`, passing `agent.name` and `issue.title`. Falls back to `squad/run-{issueRunId}` when metadata is unavailable.

---

## Relationship to existing `squadboard/run-{id}` branches

Old worktrees created before Wave 16 used the `squadboard/run-{uuid}` pattern. Cleanup via `git branch -d` in `cleanupWorkspace` now reads the branch from the worktree HEAD instead of reconstructing it, so legacy branches are handled correctly.

---

## Protected branches

The push endpoint (`POST /api/runs/:runId/git/push`) refuses to push to `main`, `master`, `develop`, or `trunk`.
