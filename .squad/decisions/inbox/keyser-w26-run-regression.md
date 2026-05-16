# keyser-w26-run-regression

**Date:** 2026-05-16  
**Wave:** 26 (post-batch-1 regression fix)  
**Author:** Keyser

---

## Root Cause

The W26 footer restructure (commit `53cba6eb`) correctly moved the RunButton outside the `onClick→onOpen` wrapper div so that clicking Run no longer opens the detail panel (fixing Bug 2). The click handler (`handleRun`) was NOT dropped — `startRun.mutate` IS being called correctly client-side.

The regression is a **visual feedback gap**: before W26, clicking Run incidentally triggered `onOpen(issue)` (the panel opened as a side-effect), giving Brady instant visual confirmation that something happened. After W26, with `stopPropagation` correctly blocking the panel open, there is no immediate visual cue. Compounding this: the Run button's `style` only updated `opacity` and `cursor` for `activeAgents.length === 0`, NOT for `startRun.isPending`. So after clicking, the button became `disabled` while looking identical (same cursor, same opacity), making Brady conclude "nothing happened."

**Confirmed:** The click IS firing and the API call IS being made client-side. The visual regression is entirely UI-side (Keyser's domain). No downstream dispatch/heartbeat issue is implicated.

---

## Fix

**File:** `packages/client/src/components/runs/RunButton.tsx`

1. Added `data-testid="task-run-button"` to the Run button element.
2. Extended the `isPending` check into the button's `style`:
   - `cursor: (startRun.isPending || activeAgents.length === 0) ? 'not-allowed' : 'pointer'`
   - `opacity: (startRun.isPending || activeAgents.length === 0) ? 0.5 : 1`
   - Added `transition: 'opacity 0.15s, background 0.15s'` for smooth feedback
   - Button text changes from `▶ Run` → `Starting…` while `isPending`
   - Background dims from `rgba(56,139,253,0.15)` → `rgba(56,139,253,0.08)` while pending

---

## Test

**New infrastructure:** vitest + @testing-library/react + @testing-library/user-event + jsdom added to `packages/client` devDependencies. Setup file: `src/test-setup.ts`.

**Test file:** `packages/client/src/components/runs/RunButton.test.tsx`

Tests (all passing, 3/3):
1. `renders the Run button with data-testid` — asserts `[data-testid="task-run-button"]` is in DOM and reads "▶ Run"
2. `calls startRun.mutate with issueId and first agent id when clicked` — mocks `useActiveAgents` (1 agent) and `useStartRun`, clicks the button, asserts `mutate` called with `{ issueId: 'issue-1', agentId: 'agent-fenster' }`
3. `button is enabled with at least one active agent` — confirms button is not disabled when agents are available

---

## Verification

- `pnpm -r build` — green (no errors; pre-existing chunk size warning only)
- `vitest run` — 3/3 tests pass

---

## Scope

- Client-side only. No server code touched.
- Verbal's in-flight `w26-autoassign-defaults-to-fenster` work is unaffected.
- W25 collapsed nav, Conjure FAB, Consult top-bar — all untouched.
- No emoji in UI. Fluent2 icons only.
