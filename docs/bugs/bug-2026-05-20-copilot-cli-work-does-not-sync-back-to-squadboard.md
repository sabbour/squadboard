# Bug: Copilot CLI work does not sync back to Squadboard

| Field | Value |
|-------|-------|
| **Bug ID** | `bug-2026-05-20-copilot-cli-work-does-not-sync-back-to-squadboard` |
| **Reported** | 2026-05-20 |
| **Severity** | 🔴 critical |
| **Component** | mcp |
| **Assigned to** | Kobayashi |
| **Status** | Open |

## Reproduction Steps

1. Open this Squadboard repository in Copilot CLI.
2. Ask Squad/Copilot CLI to perform work that creates todos, starts agents, commits fixes, or marks work done.
3. Open the corresponding project in Squadboard.
4. Check the board, inbox, run views, and Squad Sync view for the work started/done state from the CLI session.

## Expected Behavior

CLI-originated Squad work is durably reflected in Squadboard without a manual hidden ritual. If the required MCP/generated-agent sync automation is missing or unhealthy, the Squad Sync view clearly reports the broken link and offers a repair action.

## Actual Behavior

Work performed from Copilot CLI is visible in the CLI session and local files/commits, but the user does not see it syncing back into Squadboard. The required automation and Squad Sync status are unclear, leaving the user unsure what to do.

## Additional Context

User explicitly said: "So I'm typing shit out into Copilot CLI here and you get to work yet I don't see anything syncing back to my Squadboard. What am I supposed to do to make this work? Consider the automation necessary and the Squad Sync view you already built." Existing context: Squadboard should support interchangeable Squadboard and CLI/Copilot modes; generated agent instructions and MCP bridge are supposed to capture work intake and done state back into Squadboard.

## Fix Checklist

- [ ] Root cause identified and documented here
- [ ] Fix implemented on worktree branch `squad/bug-2026-05-20-copilot-cli-work-does-not-sync-back-to-squadboard`
- [ ] Regression test added (Kujan sign-off required)
- [ ] Fix merged to `main` — worktree removed
- [ ] This doc updated with resolution notes

## Resolution

_To be filled in when fixed. Include: root cause, files changed, test added._
