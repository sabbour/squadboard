# Kobayashi — History Archive

## 2026-05-14 — SDK Integration & Ceremony UX

### SDK wiring (squad-client.ts)

Integrated @bradygaster/squad-sdk@0.9.4 as primary LLM backend. Key learnings:
- Correct import: @bradygaster/squad-sdk/client (re-exports SquadClient)
- createSession config: systemMessage mode='replace', workingDirectory, model
- sendAndWait returns Promise<unknown>; extract via result.data.content
- Always disconnect() in finally to avoid resource leaks
- SDK downloads ~73MB binaries on install (expected, not a problem)

Earlier iterations:
- Tried @copilot-extensions/preview-sdk (wrong package)
- Replaced with llm CLI + ollama fallbacks, then simplified to Copilot SDK only

### SDK surface ownership

From @squad/sdk: SquadClient, SquadSession, EventBus, CharterCompiler, HookPipeline, CostTracker, OTel runtime.

### Routing pipeline (3-tier)

1. Deterministic rules (.squad/routing.md) — label matchers, title regex
2. matchRoute() — Squad's existing matcher
3. Specifier agent — reads issue + roster, returns {assignee_agent_id, confidence}

### Charter compilation & agent-sync (Phase 5)

**charter-compiler.ts:** Refactored parseCharter & computeCharterHash to expose in-memory primitives:
- parseCharterContent(content: string) — pure parser
- computeContentHash(content: string | Buffer) — md5 hash

**agent-sync.ts:** Migrated 3 fs.readdir/access callsites to SDK collections:
- readdir → (await getAgents(projectId)).list()
- fs.access + parseCharter → SDK getAgents().get(name).charter()
- Both now use in-memory parsers; fs.writeFile write-side retained (SDK has no update method)

**Phase 5 SDK state wrapper (p5-state-wrapper):**
- getState(projectId): SquadState — lazily cached
- invalidateState(projectId) — cache eviction
- 7 collection accessors: getAgents, getRouting, getDecisions, getSkills, getTeam, getTemplates, getConfig
- FSStorageProvider with confinement; SquadState.fromStorage() synchronous factory

### Ceremony create page UX (Conjure wiring)

**Conjure strategy:** Use existing Phase 16 generate-from-prose endpoint (ded0a28b). No new server service needed; client-side YAML parsing via parseSteps().

**Create mode pattern:**
- Dismissible intro card explaining ceremonies
- FormulatePanel at top (isNew only)
- RadioGroup for trigger kind with descriptions
- Step kind dropdown with collapsible Advanced section
- Defaults: kind='workflow', triggerKind='manual', single empty step
- Empty state card with "Add step" + "Formulate with AI" guidance

**New-user split:** isNew = !ceremonyId || ceremonyId === 'new'

### Earlier learnings (2026-05-14)

- Demo 1: squad-discovery.ts filesystem scanning (home + common dirs, depth 3)
- Demo 3: CharterCompiler parses charter.md; agent-sync.ts syncs to DB
- Demo 4: executeAgentRun entry point; SquadClient.createSession() directly
- Demo 5: routing-compiler.ts parses .squad/routing.md; RoutingBadge shows ⚡
- Demo 6: HookPipeline registration by HookPoint
- SDK real invocation: llm CLI (Simon Willison) → ollama fallback → offline briefing
- Later simplified: Copilot SDK only (no fallbacks)

---

## Recent decisions archived from main history

- p5-migrate-fs (commit reference 1a4c5d46, d87c8f45, 6067d8a2)
- column_meta table design (semantic TEXT, is_default BOOLEAN)
- Bootstrap DDL for enum→text migration and column seeding
- Ceremony Conjure UX integration with FormulatePanel
