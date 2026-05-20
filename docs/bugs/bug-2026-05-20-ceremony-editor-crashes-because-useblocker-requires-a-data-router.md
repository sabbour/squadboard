# Bug: Ceremony editor crashes because useBlocker requires a data router

| Field | Value |
|-------|-------|
| **Bug ID** | `bug-2026-05-20-ceremony-editor-crashes-because-useblocker-requires-a-data-router` |
| **Reported** | 2026-05-20 |
| **Severity** | 🟠 high |
| **Component** | frontend |
| **Assigned to** | Keyser |
| **Status** | Fixed |

## Reproduction Steps

1. Start Squadboard UI.
2. Open a project with at least one ceremony.
3. Click a ceremony to open the ceremony editor.

## Expected Behavior

The ceremony editor renders normally and protects unsaved edits without crashing.

## Actual Behavior

The ceremony editor fails to render with: "useBlocker must be used within a data router. See https://reactrouter.com/en/main/routers/picking-a-router."

## Additional Context

The app uses route elements in App.tsx rather than a data router; React Router's useBlocker hook is data-router-only.

## Fix Checklist

- [x] Root cause identified and documented here
- [x] Fix implemented
- [x] Regression test added
- [ ] Fix merged to `main` — worktree removed
- [x] This doc updated with resolution notes

## Resolution

Root cause: `useUnsavedChangesWarning` imported React Router's `unstable_usePrompt`, which calls the data-router-only blocker API. Squadboard currently mounts the client with `BrowserRouter`, so any page using the shared unsaved-changes hook could fail at render time with `useBlocker must be used within a data router`.

Fix: replaced the data-router prompt with a BrowserRouter-safe hook implementation that uses native `beforeunload` protection and same-origin link click confirmation. This preserves unsaved-change protection without requiring a router migration.

Files changed:

- `packages/client/src/hooks/useUnsavedChangesWarning.ts`
- `packages/client/src/hooks/__tests__/useUnsavedChangesWarning.test.tsx`

Regression test: `useUnsavedChangesWarning` now renders under `BrowserRouter` without throwing, warns on browser unload, blocks same-origin link navigation when the user declines, and stays inactive when clean.
