# Decision: squad-client real invocation approach

**Author:** Kobayashi  
**Date:** 2026-05-14  
**Commit:** a2b826e

## What changed

`packages/server/src/sdk/squad-client.ts` was a thin wrapper around the
non-existent `@sabbour/squad-sdk` package. It always fell back to a stub
that produced `[stub output — real SDK integration in production]`.

I replaced it entirely.

## Option chosen: B — subprocess LLM backend with structured offline fallback

### Why not Option A (gh copilot subprocess)?
`gh copilot` extension is not installed on this host. `gh` is available but
only for GitHub API calls, not Copilot agent tasks.

### Why not Option C (@github/copilot-sdk)?
Not present in `packages/server/package.json` dependencies.

### What I implemented (Option B)

Execution order in `createAgentSession()`:

1. **Read charter from disk** (`charterPath` → full markdown string)
2. **Try `llm` CLI** (`pip install llm`) — supports 40+ models via plugins,
   free for local backends. Invokes `execFile('llm', ['-s', charter, task])`.
3. **Try `ollama run llama3`** — local model runner, widely available.
4. **Structured offline briefing** — if both fail, returns a markdown document
   containing the full charter and task. Labeled "Offline run", cost $0.000,
   no fake token counts. A developer reading the output knows exactly what the
   agent would execute and can run it manually.

### Why this ordering

`llm` is the fastest path to a real response without infra setup. `ollama` is
the next most common local LLM runner. Neither requires a network connection
or API key if configured with a local model. The offline briefing is a genuine
last resort, not a disguised stub — it contains real content.

### Stub text removed

- `[stub output — real SDK integration in production]` — gone from both
  `squad-client.ts` and `bridge.ts`
- `executeAgentRunStub` in `bridge.ts` updated to produce a useful forced-stub
  briefing (for tests/local hacking) without placeholder text

## To get live responses now

```bash
pip install llm
llm install llm-anthropic   # or any other provider plugin
llm keys set anthropic
```

After that, every "Run Agent" button press will invoke the Claude API using
the agent's charter as the system prompt and the issue title+body as the
user message.
