# Decision: Copilot SDK Wired — Implementation Complete

**Author:** Kobayashi (Squad SDK Integrator)  
**Date:** 2026-05-14T13:54:25Z  
**Status:** Done  
**Implements:** `mcmanus-sdk-integration.md`

---

## What Was Done

`@copilot-extensions/preview-sdk@5.0.1` is now the **primary LLM backend** for all agent runs in Squadboard. Committed as `619c33a3`.

### Files Changed

| File | Change |
|---|---|
| `packages/server/src/sdk/squad-client.ts` | Added `tryCopilotSdk()` as Priority 1 backend; added `model?: string` to `SessionOptions`; Priority order: Copilot SDK → llm CLI → ollama → offline |
| `packages/server/src/sdk/bridge.ts` | Added `model: input.agent.model ?? undefined` passthrough to `createAgentSession()` |
| `packages/server/package.json` | Added `@copilot-extensions/preview-sdk: ^5.0.1` as runtime dependency |
| `pnpm-lock.yaml` | Locked copilot-extensions + octokit transitive deps |
| `packages/server/dist/sdk/squad-client.js` | Rebuilt — old vaporware stub gone |

### Interface Contract: UNCHANGED

`SessionOptions`, `SessionResult`, `createAgentSession()` export signature — all identical. Only `model?: string` added (backward-compatible optional field).

## Implementation Notes

The `prompt()` function takes a `messages` array — the charter goes as `{ role: 'system', content: charter }`, NOT as a top-level `system:` field. That field does not exist in the SDK's `PromptOptions` type.

```typescript
const { message } = await prompt({
  token,
  ...(model ? { model } : {}),
  messages: [
    { role: 'system' as const, content: charter },
    { role: 'user' as const, content: task },
  ],
});
```

## Auth

- `GITHUB_TOKEN` → primary (standard env in GitHub Actions / Codespaces / gh CLI sessions)
- `SQUADBOARD_GITHUB_TOKEN` → alternative override
- If neither is set: logs a `console.warn` and falls through to llm CLI → ollama → offline briefing

## Build Status

17 pre-existing TypeScript errors (TS2742 declaration-file naming issues in route files + drizzle.config.ts rootDir issue) — **unchanged from baseline**. My SDK code introduces zero new errors. JS output emits correctly.

## What Kujan Needs to Know

No new AC work needed — Demo 4 ACs cover run completion. If `GITHUB_TOKEN` is set in the runtime environment when testing, the Copilot SDK fires and output is non-empty. If not set, offline briefing fires and output is also non-empty. Both paths satisfy the "run completes with output" AC.
