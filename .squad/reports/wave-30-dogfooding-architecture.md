# Wave 30 — Dogfooding Architecture Audit

**Author:** Keaton (Architecture/Audit)  
**Wave:** 30 — Batch 3  
**Lane:** w30-revisit-dogfooding-architecture  
**Date:** 2026-05-16T14:00:00Z  
**Scope:** Audit `.squad/dogfood.md` spec against actual implementation; compare W10 intent to W30 reality.

---

## Executive Summary

The dogfood loop is **partially working**. The server-side plumbing — `capture` tool,
`done:` close-out matching, idempotency, project-id resolution — is production-quality
code. The smoke test (Stream A6) proved the end-to-end path works mechanically. However,
**in live operation (W11–W30), there is no recorded evidence that the coordinator is
calling `capture` or `capture done:` for any real directive**. The orchestration logs,
wave summaries, and decision-inbox files all show the markdown-file capture path is
active; the MCP capture path is silent. Additionally, the spec's "Close-out flow"
section describes the tool as lacking match-by-text logic — which has been wrong since
Wave 12. The spec has drifted from the code in that single important respect.

---

## Section 1 — Specification

### 1.1 Source Documents

| Document | Relevant Section |
|---|---|
| `.squad/dogfood.md` | Full file; Wave 10 intro + Close-out flow (E3) + Smoke-test findings (A6) + Wave 23 idempotency (I7) |
| `.github/agents/squad.agent.md` | Lines ~225–261 (directive-capture) + Lines ~881–905 (close-out symmetry addendum) |

### 1.2 Intake Flow

**`.squad/dogfood.md` specifies:**

> "Always call `capture` (in addition to the existing flow) when:
> - Ahmed reports a bug or regression
> - Ahmed asks for a UX/polish change
> - Ahmed asks for a feature
> - Ahmed surfaces a directive that has implementation work attached"

The two-step wiring:
```
Ahmed (Copilot CLI)
 ├─► coordinator → .squad/decisions/inbox/copilot-directive-*.md  [EXISTING]
 └─► coordinator → capture(...) MCP tool                          [W10 ADDENDUM]
       └─► squadboard inbox row (status=captured)
             └─► Conjure classifier → card materialised
```

**`squad.agent.md` (line ~249–251) echoes:**

> "when the directive carries implementation work [call] `capture` with the prompt so
> the work lands as a card in squadboard's own board."

**Key "MUST/SHOULD" statements extracted:**

| ID | Policy | Source |
|---|---|---|
| P1 | Always call `capture` (in addition to markdown file) when directive has implementation work | `dogfood.md` §When |
| P2 | Do NOT call `capture` for pure questions or pure policy directives with no work | `dogfood.md` §Do NOT |
| P3 | `SQUADBOARD_DEFAULT_PROJECT_ID` env var MUST be set for stdio transport | `dogfood.md` §Gotchas |
| P4 | Captures are not idempotent — dedup via inbox UI if re-run [W10 intent; superseded by I7] | `dogfood.md` §Gotchas (original) |
| P5 | Call `capture` again with `done:` prefix on batch close-out for directives captured on intake | `dogfood.md` §Close-out + `squad.agent.md` ~881 |
| P6 | Two flows are additive: markdown file + close-out capture; keep markdown file unchanged | `dogfood.md` §Close-out + `squad.agent.md` ~903 |
| P7 | Coordinator records the "first 60 characters" of intake prompt for close-out matching | `dogfood.md` §Close-out step 1 |
| P8 | Scribe MUST record both intake capture + close-out capture calls in orchestration log | `dogfood.md` §In orchestration logs |
| P9 | Idempotency keys MUST be derived as `sha256(directiveId + ':intake')` and `sha256(directiveId + ':closeout')` for the two-flow pattern | `dogfood.md` §Wave 23 I7 |
| P10 | After successful `capture`, coordinator MUST surface result: "#id 'title' (status: backlog)" | `dogfood.md` §Coordinator response template |
| P11 | If `capture` returns `draft_only`, coordinator MUST surface draft to Ahmed | `dogfood.md` §Coordinator response template |

### 1.3 Close-out Flow

**Spec (Wave 10 E3 addendum, still present in dogfood.md):**

> "The `capture` tool in `packages/server/src/mcp/server.ts` does NOT yet have
> 'find existing card by text prefix' logic. Therefore, the close-out flow uses a
> coordinator-side convention for now."

The spec goes on to describe a **coordinator-side approach**: record first-60-char anchor
on intake; on close-out, pass `done:` prefix + matching text fragment. If no match,
creates a new standalone "done" card. Coordinator notes paired intake→close-out in the
orchestration log.

> **⚠️ This description is STALE as of Wave 12.** The code has had token-based matching
> since commit `d2c06218` (Wave 12, N1). See Section 2.3.

### 1.4 Two-flows-are-additive Rule

`dogfood.md`: "The existing markdown capture stays in place; the MCP capture is
additive." `squad.agent.md` line ~903: "Two flows remain additive: Keep the
orchestration log entry + the decision inbox file unchanged. The close-out capture is
supplementary."

### 1.5 "Dogfood" Scope (W10 vs Today)

- **W10 definition:** dogfooding = coordinator calls MCP `capture` tool so every
  directive lands on squadboard's own Kanban board. The board then tracks its own
  development, closing the loop: build the board on the board.
- **W10 scope:** capture on intake + capture on close-out, both via the same MCP tool
  the external users use. This keeps the dogfood representative (same code path).
- **W30 state:** The term is still used loosely in wave summaries (e.g. "dogfood
  prompts" in W27 = conjure classifier test inputs, not coordinator capture calls). The
  original "coordinator calls MCP capture" meaning has effectively become dormant while
  the classifier, idempotency, and matching were being built. The smoke test (A6) closes
  the loop mechanically; live coordinator use does not.

---

## Section 2 — Implementation

### 2.1 MCP `capture` Tool — Actual Contract

**File:** `packages/server/src/mcp/server.ts`  
**Function:** `handleCapture()` (line 850)

Tool registration (lines 220–266):
```typescript
name: 'capture',
// description mentions: 'done:' prefix closes a card by fuzzy-matching title
inputSchema: {
  required: ['prompt'],
  properties: {
    prompt, projectId, hint, useLlm, idempotencyKey, createdBy
  }
}
```

**Execution flow (handleCapture):**

1. **Prompt validation** — rejects empty prompt (line 862).
2. **Idempotency key** — if omitted, auto-generates `sha256(projectId + '\0' + normalizedPrompt)[0:32]` (line 872–874). [W23 I7]
3. **`done:` prefix detection** — regex `/^done:\s*/i` (line 878) branches to `handleCaptureClose()`.
4. **Dedup check on `inbox_items`** — queries existing `idempotencyKey` in same project (line 884–896); returns `{action:'dedup'}` if found.
5. **Conjure classification** — calls `classifyAndDraft()` with prompt, hint, useLlm, context (line 901–906).
6. **Issue materialisation** — if `intent === 'issue'` AND `projectId` resolved: inserts into `issues` (status `backlog`) and writes an `inbox_items` tracking row (lines 917–975).
7. **Draft-only** — if intent != `issue` or no `projectId`: returns `{action: 'draft_only'}` with classification (lines 978–985).

**Project-ID resolution chain** (line 494–496):
```typescript
args.projectId ?? headerProjectId(extra) ?? defaultProjectId
```
Where `defaultProjectId` is populated from `SQUADBOARD_DEFAULT_PROJECT_ID` env var in the stdio entry point (`index.ts` line ~70–78).

**`mcp-config.json` concern:** `.copilot/mcp-config.json` passes the env var as the literal string `"${SQUADBOARD_DEFAULT_PROJECT_ID}"`, which requires the host process to expand shell variables before passing them to the MCP server. If the env var is unset in the running CLI context, the literal dollar-brace string is passed to the server, which will silently fail to resolve a project and return `draft_only` for every capture call.

### 2.2 Server Intake Endpoint

The MCP `capture` tool does NOT delegate to a separate HTTP route for intake. It directly:
- Calls `classifyAndDraft()` from `services/conjure-classifier.ts`
- Inserts to `issues` via Drizzle ORM (`getDb()`)
- Writes an `inbox_items` tracking row

There is a separate REST surface: `POST /api/inbox` (routes/inbox.ts, lines 72–100) that
calls `inboxService.createInboxItem()`, which creates a row with `status='captured'` and
goes through formulate → publish steps. The MCP `capture` tool **bypasses** this REST
path for `issue` intents — it directly inserts a published issue. The inbox row is
written only as an idempotency tracking record (status `'published'`).

This means the MCP `capture` path does NOT go through `POST /api/inbox` and does NOT
require a formulate step — it's a single-step create. The spec says "routes the prompt
through the Conjure classifier" which is correct; but it does not say it goes through
the `/api/inbox` REST endpoint, so no spec drift here.

### 2.3 Close-out Matching Code

**File:** `packages/server/src/mcp/server.ts`  
**Function:** `handleCaptureClose()` (line 991)

**Algorithm:**
1. Requires `projectId` — returns error if missing (line 996–1000).
2. Idempotency dedup — queries `inbox_items` by idempotency key (lines 1003–1018).
3. **Tokenisation:** lower-case, strip non-alphanumeric, split on whitespace, filter tokens ≥3 chars against a stop-word list of ~40 words. Stop-words include: `'fix', 'fixed', 'done', 'closes', 'resolves', 'implements', 'sha='` (line 1022–1034).
4. **Candidate query:** ILIKE on up to 5 tokens against `issues.title` in the project, where `archived = 0` (lines 1041–1054).
5. **Scoring:** count overlapping tokens between descriptor and each candidate title (lines 1056–1065).
6. **Threshold:** ≥ 2 matching tokens required (unless 1-token descriptor → requires 1 match) (lines 1068–1070).
7. **On match:** `UPDATE issues SET status='done'` (line 1075–1078). Idempotency row written.
8. **No match:** creates a standalone `status='done'` card with body "Closed via `capture done:` — no matching open card found" (lines 1102–1113). Idempotency row written.

**Key finding:** The close-out matching logic is fully implemented. The spec section titled "Close-out flow" says: *"The `capture` tool... does NOT yet have 'find existing card by text prefix' logic"* — **this claim is false as of Wave 12 (commit `d2c06218`)**. The spec was never updated after N1 landed.

### 2.4 Conjure Classifier Hint Handling — Two-Layer Behaviour

**File:** `packages/server/src/services/conjure-classifier.ts`

There are two levels of hint processing, introduced at different points:

**Level 1 — Rule scorer (scorePromptByRules, line 256–265):**
```typescript
if (hint && ALL_INTENTS.includes(hint)) {
  s.rawScore = s.rawScore * 1.5 + 1; // soft boost — NOT a lock
}
```
This was the original W10 implementation. It only multiplies by 1.5 and adds 1, so a
keyword-heavy prompt can still beat the hint (the W10 smoke-test finding that 8/26
prompts were misclassified).

**Level 2 — Hard override in classifyAndDraft (lines 734–751):**
```typescript
// W27 fix: Hard override: when the caller passes an explicit hint, that intent MUST be
// the result... intent is locked to the hint.
if (req.hint && ALL_INTENTS.includes(req.hint)) {
  // ... return locked result regardless of scoring
}
```
This was added in W27 (commit referenced in `wave-27-summary.md`: "Conjure hint
hard-override — hint parameter now locks intent before scoring governs response").

**Net behaviour today:** The hint soft-boost in level 1 is effectively vestigial — the
level 2 hard override in `classifyAndDraft` is what matters. If the coordinator passes
`hint: 'issue'`, the result is locked to `issue` regardless of keyword scoring. If the
coordinator calls `capture` WITHOUT a hint (which the spec and dogfood.md do not require
a hint — the default example is just `capture({ prompt: "<text>" })`), the level 1
soft-boost applies and misclassification remains possible.

### 2.5 Coordinator Invocation — Is `capture` Actually Called After Every Batch?

**squad.agent.md lines 248–261** direct the coordinator to call `capture` when:
- Directive has implementation work

**Evidence from orchestration records (W10–W30):**

- **W10 orchestration.md:** "Directives captured: None new" (no MCP capture calls noted).
- **W12 close-out log:** States N1 is "the first time the dogfood done-capture loop actually works end-to-end." The wave-12 log records the code landing but does NOT record actual coordinator `capture` or `capture done:` invocations for any W12 directive.
- **W13–W30 orchestration logs:** All orchestration logs (checked: W22, W23, W24, W26, W27, W28, W29, W30) document "Directives captured" referring to markdown-file captures only. Zero entries record MCP `capture(...)` calls with returned issue IDs or close-out `capture done:` calls.
- **W27 "dogfood prompts":** The word "dogfood" in the W27 summary refers to the 26 seed-script prompts used to validate the Conjure classifier (mis-classification of 8/26 prompts) — not to live coordinator MCP calls.

**Conclusion:** The coordinator has not been calling `capture` in production since at least W12 (possibly never in live sessions, only in the smoke-test script). The markdown-file path is active; the MCP-capture path is dormant.

### 2.6 `createdBy` Provenance Tag

The `handleCapture` function hard-codes `createdBy: createdBy ?? 'copilot-cli'` (line 951) when inserting the inbox tracking row. The tool schema exposes `createdBy` as an optional arg with enum `['user', 'copilot-cli', 'squadboard-server', 'webhook']`. This is consistent with the dogfood use case (coordinator = copilot-cli).

---

## Section 3 — Gap Analysis

For each policy in Section 1.3:

| ID | Policy | Status | Evidence |
|---|---|---|---|
| P1 | Call `capture` on intake for work directives | **Missing** | Zero MCP capture call evidence in W11–W30 orchestration logs; markdown-file path active, MCP path dormant |
| P2 | Do NOT call `capture` for pure questions / policy-only directives | **N/A** | Cannot verify absence of unwanted calls when presence of expected calls is also absent |
| P3 | `SQUADBOARD_DEFAULT_PROJECT_ID` must be set for stdio | **Partial** | `mcp-config.json` passes literal `${SQUADBOARD_DEFAULT_PROJECT_ID}` — only works if host expands it; server code correctly reads it (`index.ts` ~L70). No evidence it's set in the live CLI session |
| P4 | Captures not idempotent [W10 original] | **Superseded** | W23 I7 added deterministic idempotency key auto-generation; spec updated in dogfood.md §Wave 23 section |
| P5 | Call `capture done:` on close-out for captured directives | **Missing** | Close-out code is implemented (`handleCaptureClose`, W12); coordinator never calls it in live sessions |
| P6 | Two flows additive; markdown file kept | **Partial** | Markdown file path working; MCP path not active, so additivity is vacuously false |
| P7 | Coordinator records first 60 chars for close-out anchor | **Missing** | No orchestration log records this; and the implemented matching uses token overlap (not 60-char anchor), so P7 is also technically superseded by the code change |
| P8 | Scribe records intake + close-out capture calls | **Missing** | Scribe logs show zero capture call records; no framework in Scribe charter for recording MCP call metadata |
| P9 | Deterministic idempotency keys for two-flow pattern | **Partial** | Auto-generation implemented. Explicit `sha256(directiveId + ':intake')` / `sha256(directiveId + ':closeout')` pattern described but no caller does this; auto-generation covers the case but without directive-anchored keys, retries could re-derive to same key and dedup |
| P10 | Coordinator surfaces "#id title (status: backlog)" after capture | **Missing** | No evidence; also coordinator doesn't call capture, so the response template is never used |
| P11 | Coordinator surfaces draft to Ahmed when `draft_only` | **Missing** | Same: capture not called |

**Score: 0 Implemented / 3 Partial / 7 Missing / 1 Superseded**

**Specific file/line citations:**

| Claim | File/Line | Status |
|---|---|---|
| `capture` tool exists | `server.ts:220` | ✅ Exists |
| `done:` routing | `server.ts:878–881` | ✅ Implemented |
| Token matching in close-out | `server.ts:1021–1070` | ✅ Implemented (spec stale re: "not yet have logic") |
| Idempotency auto-generation | `server.ts:872–874` | ✅ Implemented |
| Hint hard-override | `conjure-classifier.ts:734–751` | ✅ Implemented (W27) |
| Env var read in stdio entry | `mcp/index.ts:~70` | ✅ Implemented |
| `mcp-config.json` env passthrough | `.copilot/mcp-config.json:9–11` | ⚠️ Shell var expansion required |
| Coordinator calling `capture` | `orchestration-log/*` W11–W30 | ❌ No evidence |
| Coordinator calling `capture done:` | `orchestration-log/*` W11–W30 | ❌ No evidence |
| Scribe recording capture calls | `.squad/log/*` | ❌ No evidence |

---

## Section 4 — Evidence from Recent Directives

I sampled 8 recent directives visible in wave summaries and orchestration logs and
checked for intake capture + close-out capture evidence.

| # | Wave | Directive (paraphrase) | Intake MCP capture? | Close-out MCP capture? | Notes |
|---|---|---|---|---|---|
| D1 | W22 | "Use Fluent icons, not emoji" | ❌ Not recorded | ❌ Not recorded | `.squad/log/2026-05-16T02-15-00Z-wave-22-conjure-correction.md` only records markdown capture |
| D2 | W23 | "Add idempotency to MCP capture" | ❌ Not recorded | ❌ Not recorded | `W23 hockney orchestration` records code delivery only |
| D3 | W27 | "Fix Conjure hint to be hard override" | ❌ Not recorded | ❌ Not recorded | W27 summary records code fix but no MCP call evidence |
| D4 | W27 | "PATCH /api/projects/:id should accept name updates" | ❌ Not recorded | ❌ Not recorded | Listed in smoke findings → delivered in W27; no MCP capture chain recorded |
| D5 | W28 | "Add JIS — jump into session feature" | ❌ Not recorded | ❌ Not recorded | W28 summary shows detailed delivery; zero capture() mentions |
| D6 | W28 | "Add 8 missing models to cost table" | ❌ Not recorded | ❌ Not recorded | W28 COST-2 delivered; no intake/close-out capture chain |
| D7 | W29 | "Mini-coordinator stack MC-1..MC-14" | ❌ Not recorded | ❌ Not recorded | W29 summary is 14KB; captures not mentioned |
| D8 | W30 | "Prompt injection mitigation C-4" | ❌ Not recorded | ❌ Not recorded | Commit `8d4942b4c` exists; no MCP dogfood trace |

**Result: 0/8 directives show MCP `capture` intake call. 0/8 show `capture done:` close-out.**

The markdown-file path (`.squad/decisions/inbox/copilot-directive-*.md`) is the only
active capture mechanism for all waves observed.

### 4.1 Positive Evidence (Smoke Test)

The A6 smoke test in `packages/server/src/scripts/smoke-loop-mcp.ts` does prove the
mechanical path works:

```
capture(prompt) → backlog card created
list_issues → card visible
update_issue × 3 → todo → in_progress → done
list_issues(status:done) → card visible
```

`dogfood.md` §Smoke-test findings: "A6 smoke loop: PASS" (run date 2026-05-15). The
script requires `SQUADBOARD_DEFAULT_PROJECT_ID` to be set manually before running.

---

## Section 5 — Recommendations

### R1 (Priority: HIGH) — Wire the intake call in the coordinator [closes P1, P10, P11]

Add a concrete instruction to `squad.agent.md` that makes `capture` non-optional:

```
MUST call MCP tool capture({
  prompt: <first 120 chars of directive summary>,
  hint: 'issue',
  idempotencyKey: sha256(directiveFileTimestamp + ':intake').slice(0,32)
}) immediately after writing the .squad/decisions/inbox/copilot-directive-*.md file.
```

Surface the returned issue ID in the wave dispatch table (one extra line: "📌 Board card:
#abc1234"). This closes the single biggest gap — the MCP call never fires.

### R2 (Priority: HIGH) — Update the `dogfood.md` "Close-out flow" section [spec drift]

The section still says the `capture` tool "does NOT yet have 'find existing card by text
prefix' logic." This has been false since Wave 12 (N1, commit `d2c06218`). Update:

- Remove "close-out flow uses a coordinator-side convention for now."
- Replace with the actual algorithm: token-based fuzzy match (≥2 token overlap, ILIKE
  candidates, score by overlap count).
- Update the "Future enhancement" block — it already shipped.
- Clarify that the stop-word list excludes `fix`, `fixed`, `done` — coordinator should
  use the _original directive keywords_ in the close-out descriptor, not just the
  outcome words, to maximise token overlap.

### R3 (Priority: MEDIUM) — Add close-out call to the coordinator post-batch protocol [closes P5, P6]

The post-batch steps in `squad.agent.md` (§After Agent Work) already mention close-out
capture. Strengthen it with a concrete conditional:

```
IF this wave's work closed a directive that was captured on intake:
  call capture({
    prompt: "done: {original directive title fragment} (sha={commit})",
    hint: 'issue',
    idempotencyKey: sha256(directiveFileTimestamp + ':closeout').slice(0,32)
  })
  Surface returned action (issue_closed or standalone_done_card_created)
```

The code handles both match and no-match cases gracefully; the coordinator just needs to
make the call.

### R4 (Priority: MEDIUM) — Fix `mcp-config.json` env var passthrough [closes P3]

`.copilot/mcp-config.json` line 10: `"${SQUADBOARD_DEFAULT_PROJECT_ID}"`. This relies
on the Copilot CLI host expanding shell variables in the `env` block. Verify this
actually works in the Copilot CLI desktop surface. If not, the fallback is to hardcode
the project UUID for the dogfood project (the "foo" project: `7a9cc07a-d463-4f8c-864a-c733342aa8a8`):

```json
"env": {
  "SQUADBOARD_DEFAULT_PROJECT_ID": "7a9cc07a-d463-4f8c-864a-c733342aa8a8"
}
```

This is documented in `dogfood.md` §Smoke-test findings as the pre-existing project ID.
Hardcoding trades flexibility for guaranteed project resolution in the dogfood context.

### R5 (Priority: LOW) — Add Scribe instrumentation for capture calls [closes P8]

The Scribe charter should include a step: "If coordinator recorded `capture` call results
in the session, append to orchestration log: `📌 Captured: #{id} '{title}' (intake|close-out)`."
This creates an auditable trail so future architecture reviews can verify the loop is
firing. Currently the only way to verify is querying the live SQLite DB.

**Simplest fix to close the biggest gap:** R1 — adding the `capture` call as a required
step immediately after directive-file creation. The server-side code is ready; the
coordinator is simply not calling it.

---

## Section 6 — Open Questions for Brady

**Q1 — Is close-out symmetry strict or best-effort?**

The current code creates a standalone "done" card if no matching open card is found. Is
this acceptable, or should a failed match cause an error that the coordinator must handle?
A strict policy would prevent silent data drift; best-effort is easier for the coordinator
to implement but harder to audit.

**Q2 — Should `hint: 'issue'` always be passed by the coordinator?**

The spec never says "pass `hint`." Without it, prompts with domain words like "project",
"skill", or "ceremony" in the description may still route to `draft_only` despite the
W27 hard-override — because without a hint, only the soft level-1 boost applies. Clarify
whether the coordinator should always send `hint: 'issue'` for work-item captures.

**Q3 — What is the dogfood project ID contract?**

The smoke-test uses `7a9cc07a-d463-4f8c-864a-c733342aa8a8` (the pre-existing "foo"
project). The self-register logic (`A1` in the wave plan) skips renaming because the row
already exists. Should the dogfood project be explicitly seeded, named "Squadboard Dev",
and its UUID documented canonically? Or is the env-var approach the intended contract?

**Q4 — Should the coordinator show the board card in the wave dispatch table?**

When R1 is implemented, the coordinator will have a card ID and URL to display. Is the
intent that Ahmed sees this in the turn output ("📌 Board card: #abc1234") or only in
the orchestration log? If in the turn output, the Coordinator's "keep the post-work turn
LEAN" rule (squad.agent.md ~906) may conflict.

**Q5 — How should the coordinator handle `capture` failures gracefully?**

If the MCP server is not running (e.g., `SQUADBOARD_DEFAULT_PROJECT_ID` not set, server
not started), `capture` will fail. Should the coordinator: (a) silently continue with
markdown-only capture, (b) warn Brady that the board card was not created, or (c) require
the server to be running before proceeding? The spec says nothing about error handling.

---

## Appendix A — File Map

| File | Role | Status |
|---|---|---|
| `.squad/dogfood.md` | Canonical dogfood spec | Live but partially stale (close-out section) |
| `.github/agents/squad.agent.md` ~881 | Coordinator addendum for close-out | Live, accurate |
| `packages/server/src/mcp/server.ts` | MCP server; `capture` + `handleCaptureClose` | Production-quality; fully implemented |
| `packages/server/src/mcp/index.ts` | Stdio entry; reads `SQUADBOARD_DEFAULT_PROJECT_ID` | Production-quality |
| `packages/server/src/services/conjure-classifier.ts` | Conjure intent classifier | W27 hard-override in place |
| `packages/server/src/scripts/smoke-loop-mcp.ts` | E2E smoke test; proves mechanical path | PASS (A6 run date 2026-05-15) |
| `packages/server/src/scripts/seed-wave10-backlog.ts` | Seed script; 26/26 cards loaded | Used for classifier testing |
| `.copilot/mcp-config.json` | MCP server config for Copilot CLI | Shell-var expansion caveat |
| `.squad/log/orchestration.md` | Master orchestration log (W8–W10) | Only covers early waves |
| `.squad/orchestration-log/wave-*.md` | Per-wave summaries (W11–W30) | No MCP capture evidence |

---

## Appendix B — Terminology Drift

The word "dogfood" appears in three distinct contexts across the repo:

| Usage | Context | Document |
|---|---|---|
| W10 intent | Coordinator calls MCP `capture` so each directive lands on the board | `dogfood.md`, `squad.agent.md` §881 |
| W27 "dogfood prompts" | The 26 seed-script items used to validate the Conjure classifier | `wave-27-summary.md`, `dogfood.md` §Smoke-test |
| W10+ general | "Eating our own dogfood" = building squadboard using squadboard tools | Various wave summaries |

The W10 intent (coordinator → MCP → board) is the most precise and actionable definition.
The term's drift into "test data for classifier validation" is an unrelated usage that
does not close the loop Brady originally designed.

---

## Appendix C — Code Flow Diagram (Actual, W30)

```
Ahmed makes a directive
        │
        ▼
Coordinator (squad.agent.md)
        │
        ├─► [ALWAYS] write .squad/decisions/inbox/copilot-directive-*.md   ✅ Active
        │
        ├─► [REQUIRED by P1, MISSING] call MCP capture(prompt, hint:'issue') ❌ Dormant
        │       │
        │       └─► packages/server/src/mcp/server.ts handleCapture()
        │               │
        │               ├─► auto-generate idempotencyKey = sha256(projectId+'\0'+prompt)[0:32]
        │               ├─► check done: prefix → handleCaptureClose()  [if close-out call]
        │               ├─► dedup: query inbox_items by idempotencyKey
        │               ├─► classifyAndDraft(prompt, hint) → intent
        │               │     └─ hint hard-override locks intent if hint passed [W27]
        │               ├─► if intent='issue' AND projectId:
        │               │     INSERT issues (status='backlog')
        │               │     INSERT inbox_items (status='published', idempotencyKey)
        │               │     return {action:'issue_created', issue:{id,title,status}}
        │               └─► else: return {action:'draft_only', classification}
        │
Coordinator dispatches agents
        │
Agents complete work, commit, close-out
        │
        ├─► [ALWAYS] Scribe merges inbox files → decisions.md              ✅ Active
        │
        └─► [REQUIRED by P5, MISSING] call MCP capture('done: ...')       ❌ Dormant
                │
                └─► handleCaptureClose(descriptor, projectId, idempotencyKey)
                        │
                        ├─► dedup: query inbox_items by idempotencyKey
                        ├─► tokenise descriptor (strip stop-words, filter ≥3 chars)
                        ├─► ILIKE query on issues.title for up to 5 tokens
                        ├─► score candidates by token overlap
                        ├─► if bestScore ≥ 2: UPDATE issues SET status='done'
                        │     return {action:'issue_closed', matchedIssue}
                        └─► else: INSERT issues (status='done', body='no match')
                              return {action:'standalone_done_card_created'}
```

The left column (✅ Active) fires every wave. The right column (❌ Dormant) has been
implemented since W10/W12 but never fires in live coordinator sessions.

---

## Appendix D — Key Commit History for Dogfood Loop

| Commit | Wave | What landed |
|---|---|---|
| `85dd8780` | W10 | Diagnostics `resolveSquadDir()` false-negative fix |
| `1838253d` | W10 | MCP tools: `list_projects`, `list_inbox`, `capture`, `get_routing` added |
| `d2c06218` | W12 | N1: `done:` prefix detection + token-based close-out matching + `bin/squad-card-done` CLI |
| W23 SHA (I7) | W23 | Idempotency auto-generation in `handleCapture`; `idempotency_key` column on `inbox_items` |
| W27 SHA | W27 | Conjure hint hard-override in `classifyAndDraft` (fixes 8/26 mis-classifications) |
| W27 SHA | W27 | PATCH `/api/projects/:id` accepts `name` + `description` (fixes project rename limitation) |

All server-side prerequisites for a working dogfood loop are present as of W27. The only
missing piece is the coordinator actually invoking the tools.

---

## Appendix E — Scoring Summary

### MUST/SHOULD compliance scorecard

| Total policies identified | 11 |
|---|---|
| Implemented (fully) | 0 |
| Partial | 3 (P3, P6, P9) |
| Missing | 7 (P1, P5, P7, P8, P10, P11 — and vacuously P2) |
| Superseded | 1 (P4 — idempotency now auto-generated, not manual) |

### Recommendations priority matrix

| ID | Priority | Effort | Impact |
|---|---|---|---|
| R1 | HIGH | Low (2-line change in squad.agent.md + coordinator habit) | High — closes P1, P10, P11 at once |
| R2 | HIGH | Low (edit dogfood.md §Close-out) | Medium — removes spec confusion |
| R3 | MEDIUM | Low (1 conditional in coordinator post-batch protocol) | High — closes P5, P6 |
| R4 | MEDIUM | Low (hardcode UUID or verify shell expansion) | Medium — closes P3 |
| R5 | LOW | Medium (Scribe charter + orchestration log format) | Low — audit trail only |

---

*Report generated by Keaton (architecture/audit) — Wave 30, Batch 3.*
