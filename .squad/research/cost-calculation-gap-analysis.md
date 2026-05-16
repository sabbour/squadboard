# W28 Cost Calculation Gap Analysis — Squadboard vs GitHub Copilot Billing Model

**Date:** 2026-05-16  
**Status:** Research-only (QA/Hockney)  
**Sources:** 
- Squadboard: `packages/server/src/sdk/{cost-tracker,pricing}.ts`, `packages/server/src/db/schema.ts`
- GitHub Copilot billing: https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing (fetched 2026-05-16)

---

## Executive Summary

Squadboard computes cost using a hardcoded per-model rate table (USD per 1M tokens for input + output). A secondary "premium requests" model mirrors GitHub's billing multiplier system. Both are persisted in the database and rendered by the Costs page.

**The problem:** Squadboard's pricing tables are **substantially outdated** vs GitHub's 2026 billing model. Key issues:
- **Wrong rates** for Claude Haiku (off by 4–5×), missing entirely for GPT-5.5, incomplete for Gemini.
- **No cached-token pricing** (GitHub now charges separately for cached input and cache write).
- **Missing new models** (Claude Opus 4.7 variants, Gemini 3.x, Raptor mini, Goldeneye).
- **Schema misalignment** (costUsd as text instead of decimal; premium_requests as numeric(12,4) for whole numbers).
- **No free-tier vs paid-tier distinction** — Squadboard treats all projects uniformly.

**Scope of fix:** Medium-term refactor. Quick wins available for Q2, but full realignment (cached tokens + new models + tier support) spans Q3.

---

## Section 1: Current Implementation Audit

### 1.1 Cost Calculation Sites

| File | Function | What it computes | Input | Storage |
|------|----------|------------------|-------|---------|
| `packages/server/src/sdk/cost-tracker.ts:14–35` | MODEL_PRICING lookup | USD per 1M tokens (input + output only) | modelId, inputTokens, outputTokens | Hardcoded |
| `packages/server/src/sdk/cost-tracker.ts:47–50` | computeCost() | USD = (input/1M) × inputPerM + (output/1M) × outputPerM | inputTokens, outputTokens, ModelPricing | In-memory |
| `packages/server/src/sdk/cost-tracker.ts:70–94` | CostTracker.recordCost() | Stamps input/output split + premium requests estimate | modelId, PremiumRequestOptions | `issue_runs` table |
| `packages/server/src/sdk/pricing.ts:57–60` | estimateCost() | USD cost estimate for a turn | model, inputTokens, outputTokens | In-memory |
| `packages/server/src/sdk/pricing.ts:137–151` | estimatePremiumRequests() | Premium request count w/ auto-select / FedRAMP adjustments | model, PremiumRequestOptions | In-memory |
| `packages/server/src/sdk/cost-tracker.ts:177–394` | getCostSummary() | Aggregates by agent, model, source across month/all-time | SQL from issue_runs, live_sessions, consult_sessions | In-memory summary |

### 1.2 Rate Tables

**Primary: `cost-tracker.ts:14–35` — MODEL_PRICING (USD per 1M tokens)**

```typescript
// Current subset (as of codebase snapshot):
'claude-opus-4.x': { inputPerM: 15.00, outputPerM: 75.00 }
'claude-sonnet-4.x': { inputPerM: 3.00, outputPerM: 15.00 }
'claude-haiku-4-5': { inputPerM: 0.25, outputPerM: 1.25 }  // ← ERROR
'gpt-4.1': { inputPerM: 10.00, outputPerM: 30.00 }  // ← ERROR (should be 2.00/8.00)
'gpt-5-mini': { inputPerM: 0.15, outputPerM: 0.60 }  // ← WRONG UNIT + WRONG RATES
'gpt-5.4': { inputPerM: 2.5, outputPerM: 10.0 }  // ← OK
```

**Secondary: `pricing.ts:78–101` — MODEL_MULTIPLIERS (premium requests per prompt)**

```typescript
// Current subset:
'gpt-5-mini': 0         // ✓ Correct (included)
'gpt-4.1': 0            // ✓ Correct (included)  
'gpt-4o': 0             // ✓ Correct (included)
'gpt-5.4': 1            // ✓ Correct (1×)
'claude-opus-4.5': 10   // ✓ Correct (10×)
'claude-haiku-4.5': 0.25  // ✓ Correct (0.25×)
```

**Cached pricing: NONE** — Both tables ignore cached input tokens entirely.

### 1.3 Schema & Storage

**`issue_runs` table:**
- `inputTokens: integer` — stores input token count
- `outputTokens: integer` — stores output token count
- `costUsd: text` — stores USD cost as string (e.g. "0.001234")
- `premiumRequests: numeric(12, 4)` — stores premium request estimate
- `costTokens: integer` — stores input + output total (legacy)

**`live_sessions` table:**
- `input_tokens: integer`
- `output_tokens: integer`
- `cost_usd: numeric(12, 6)` — different precision than issue_runs
- No premium_requests column (aggregated null in getCostSummary)

**`consult_sessions` table:**
- `input_tokens: integer`
- `output_tokens: integer`
- `cost_usd: numeric(12, 6)`
- `premium_requests: numeric(12, 4)`

**`projects` table:**
- `cost_model: text` — enum ('usd' | 'gh_multipliers') — which cost model to render
- No tier tracking (free vs paid)

### 1.4 Cost Display Surfaces

**Pages:**
- `packages/client/src/pages/Costs.tsx` — Project cost dashboard
- `packages/client/src/components/costs/CostDashboard.tsx` — Table breakdown (by agent, model, source, MTD vs all-time)
- `packages/client/src/components/runs/CostDisplay.tsx` — Card/tooltip display (model + USD + token counts)

**Rendering logic:**
- USD formatted to 4 decimals in details, 2 decimals in short form (BudgetBar)
- Token counts shown with K suffix (e.g. "123k in / 456k out")
- Premium requests shown as 0 decimals if ≥100, else 2 decimals
- Budget bar shows MTD spend as percentage of project budget (no budget = no bar)

**Missing:**
- Cost model indicator (which model is Costs.tsx rendering? USD or premium requests?)
- Free-tier vs paid-tier badges
- Cached token breakdown

---

## Section 2: GitHub Copilot Billing Model — Current State (2026)

### 2.1 Token Pricing (USD per 1M tokens)

Source: https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing

**Anthropic (Claude):**

| Model | Input | Cached Input | Cache Write | Output |
|-------|-------|--------------|-------------|--------|
| Haiku 4.5 | **$1.00** | $0.10 | $1.25 | **$5.00** |
| Sonnet 4.x | $3.00 | $0.30 | $3.75 | $15.00 |
| Opus 4.5+ | $5.00 | $0.50 | $6.25 | $25.00 |

**OpenAI (GPT):**

| Model | Input | Cached Input | Output |
|-------|-------|--------------|--------|
| GPT-4.1 | $2.00 | $0.50 | $8.00 |
| GPT-5 mini | **$0.25** | $0.025 | **$2.00** |
| GPT-5.2 | $1.75 | $0.175 | $14.00 |
| GPT-5.3-Codex | $1.75 | $0.175 | $14.00 |
| **GPT-5.4** | **$2.50** | $0.25 | **$15.00** |
| **GPT-5.4 mini** | **$0.75** | $0.075 | **$4.50** |
| **GPT-5.5** | **$5.00** | $0.50 | **$30.00** |

**Google (Gemini):**

| Model | Input | Cached Input | Output |
|-------|-------|--------------|--------|
| Gemini 2.5 Pro | $1.25 | $0.125 | $10.00 |
| Gemini 3 Flash (preview) | $0.50 | $0.05 | $3.00 |
| Gemini 3.1 Pro (preview) | $2.00 | $0.20 | $12.00 |

**Fine-tuned (GitHub):**

| Model | Input | Cached Input | Output |
|-------|-------|--------------|--------|
| Raptor mini | $0.25 | $0.025 | $2.00 |
| Goldeneye | $1.25 | $0.125 | $10.00 |

### 2.2 Key Billing Concepts

1. **AI Credits:** 1 AI credit = $0.01 USD. Prices in tables are per 1M tokens, converted to credits for billing.
2. **Cached Tokens:** Separate pricing for cached input (10% of regular input cost) and cache write (Anthropic only, 1.25× input cost).
3. **Code Completions:** Unlimited for all paid plans; not billed in AI credits.
4. **Code Review:** Billed in both AI credits (token consumption) and GitHub Actions minutes. Starting June 1, 2026, uses standard GitHub-hosted runner minutes.
5. **Included Models:** GPT-4.1, GPT-5 mini (0 premium requests on paid plans).
6. **Free vs Paid Tiers:** Individual plans (Free/Pro/Pro+) have included allowances; Business/Enterprise have per-user pooled allowances. Overage is billed at per-token rates.

### 2.3 Premium Request Billing (Alternative Model)

GitHub now offers model multipliers for annual subscribers on request-based billing:
- Each model has a "premium request" multiplier (0, 1, 10, etc.).
- 1 premium request per prompt; multiplier determines cost in premium credits.
- Included models (GPT-4.1, mini variants) = 0 multiplier (free on paid plans).
- Auto-select discount: 10% (0.9×).
- FedRAMP / data residency surcharge: 10% (1.1×).

---

## Section 3: Gap Analysis — Detailed

### Table: Issue-by-Issue Gaps

| ID | Gap | Severity | Current Behavior | Correct Behavior | Fix Difficulty | W28 Priority |
|----|----|----------|-------------------|------------------|-----------------|--------------|
| G-1 | Claude Haiku 4.5 rate | CRITICAL | input: 0.25, output: 1.25 | input: **1.00**, output: **5.00** | S | W28 |
| G-2 | GPT-4.1 rate | HIGH | input: 10.00, output: 30.00 | input: **2.00**, output: **8.00** | S | W28 |
| G-3 | GPT-5-mini rate | HIGH | input: 0.15, output: 0.60 | input: **0.25**, output: **2.00** | S | W28 |
| G-4 | GPT-5.4-mini missing | HIGH | not in table | input: 0.75, output: 4.50 | S | W28 |
| G-5 | GPT-5.5 missing entirely | HIGH | not in table | input: 5.00, output: 30.00 (powerful tier) | S | W28 |
| G-6 | Cached token pricing missing | HIGH | ignored completely | track cached_input separately; apply 10% of input cost | M | W29 |
| G-7 | Cache write cost missing (Anthropic) | MEDIUM | ignored | apply 1.25× input cost for Claude models on cache write | M | W29 |
| G-8 | Gemini models incomplete | MEDIUM | 1 entry (3-pro-preview); missing 2.5, 3-flash, 3.1 | add gemini-2.5-pro, gemini-3-flash, gemini-3.1-pro | S | W29 |
| G-9 | Claude Opus 4.7 variants missing | MEDIUM | only 4.5/4.6; missing 4.7, 4.7-1m-internal, 4.7-high, 4.7-xhigh | add all four 4.7 variants with same rates as 4.6 | S | W29 |
| G-10 | Raptor mini + Goldeneye missing | MEDIUM | not in table | raptor-mini: $0.25/$2.00; goldeneye: $1.25/$10.00 | S | W29 |
| G-11 | costUsd stored as text | MEDIUM | `issue_runs.cost_usd: text('cost_usd')` | should be `numeric(12, 6)` like live_sessions | M | W29 |
| G-12 | Premium requests precision mismatch | LOW | numeric(12, 4) for whole numbers | numeric(12, 2) would be sufficient | S | Post-W28 |
| G-13 | No cached token schema | HIGH | issue_runs lacks cachedInputTokens column | add `cachedInputTokens: integer()` to issue_runs | S | W29 |
| G-14 | No cache write cost tracking | MEDIUM | no schema or computation for cache write | add `cacheWriteCostUsd: numeric(12, 6)` to live_sessions/consult_sessions | M | W29 |
| G-15 | Free-tier vs paid-tier not distinguished | MEDIUM | all projects treated uniformly | add `tier: text ('free' \| 'paid')` to projects; compute free/premium multiplier separately | M | Post-W28 |
| G-16 | Cost model not displayed in UI | LOW | Costs.tsx renders but doesn't show "(USD model)" or "(Premium model)" | add badge/indicator in CostDashboard | S | Post-W28 |
| G-17 | live_sessions missing input/output split in getCostSummary | MEDIUM | line 243 sums input + output as cost_tokens | already have separate input_tokens / output_tokens; expose both in getCostSummary return | S | W29 |
| G-18 | consult_sessions premium_requests aggregation | LOW | some consult turns may not have premium_requests populated | ensure all consult_messages stamp cost via estimatePremiumRequests | S | W28 |

### Summary by Severity

- **CRITICAL (1):** Claude Haiku 4.5 — off by 4–5×.
- **HIGH (6):** GPT rates, cached tokens, missing models (5.5, 5.4-mini).
- **MEDIUM (8):** Schema precision, cache write, tier distinction, etc.
- **LOW (3):** Premium precision, UI badges, consult aggregation.

### Impact on Brady's Question

Brady asked: "How are costs calculated? Are you using the new GitHub AI credits model?"

**Answer:** Partially. Squadboard *does* persist premium request counts (Stream D — D6 shows awareness). But:
1. Rate tables are **2025 or earlier** and missing new models.
2. **Cached token pricing completely absent** — GitHub now charges for cache usage; Squadboard ignores it.
3. **Free-tier behavior unknown** — no tracking whether a project is on free or paid Copilot plan.
4. **Display doesn't clarify which model is active** — Costs.tsx can render either USD or premium requests, but no indicator shown.

---

## Section 4: Recommendations

### 4.1 Quick Wins (Single Commit, W28)

1. **Fix high-priority rates** (cost-tracker.ts + pricing.ts):
   - Claude Haiku 4.5: 0.25 → 1.00 (input), 1.25 → 5.00 (output)
   - GPT-4.1: 10.00 → 2.00 (input), 30.00 → 8.00 (output)
   - GPT-5-mini: 0.15 → 0.25 (input), 0.60 → 2.00 (output)
   - Add GPT-5.4-mini: 0.75 / 4.50
   - **Files:** `cost-tracker.ts:14–35`, `pricing.ts:23–49`
   - **Test:** Unit tests for computeCost() with new rates; spot-check a few runs.

2. **Add missing models to both tables** (cost-tracker.ts + pricing.ts):
   - GPT-5.5: 5.00 / 30.00 (input/output)
   - Gemini 2.5 Pro, 3 Flash, 3.1 Pro
   - Claude Opus 4.7 (assume same as 4.6 for now: 15.00 / 75.00)
   - Raptor mini, Goldeneye
   - **Files:** Same
   - **Test:** Ensure fallback still works for unknown models.

3. **Schema: Add cachedInputTokens** (db/schema.ts):
   - `cachedInputTokens: integer('cached_input_tokens').default(0)` on issue_runs, live_sessions, consult_sessions
   - **Backward compatibility:** Default to 0 for existing rows; no data migration needed yet.
   - **Files:** `db/schema.ts`
   - **Test:** Drizzle schema validation; ensure migration doesn't break.

4. **Fix consult_sessions premium_requests** (cost-tracker.ts + any consult mutation site):
   - Ensure `estimatePremiumRequests()` is called every time a consult turn is logged.
   - **Files:** Grep for "consult_sessions" mutations; add premium_requests stamp if missing.

5. **Ensure live_sessions cost aggregation includes input/output split** (cost-tracker.ts:231–252):
   - Already pulls input_tokens, output_tokens from live_sessions — just verify they're used in aggregate() function.
   - **Files:** cost-tracker.ts (no change needed; verify in line 239–250).

### 4.2 Medium-Term Refactor (W29–W30)

1. **Add cached token computation** (pricing.ts + cost-tracker.ts):
   - Extend CostTracker.recordCost() to accept cachedInputTokens.
   - Compute cached cost: (cachedInputTokens / 1M) × (inputPrice × 0.1)
   - Store in new column `cachedInputCostUsd`.
   - Extend MODEL_PRICING to include cache write cost for Anthropic.
   - **Files:** pricing.ts (new function), cost-tracker.ts (CostTracker.recordCost), schema.ts (new columns).

2. **Tier-aware pricing**:
   - Add `tier: 'free' | 'paid'` to projects table.
   - Modify estimatePremiumRequests() to return 0 for free tier.
   - Update Costs page to show tier badge.
   - **Files:** db/schema.ts, pricing.ts, CostDashboard.tsx.

3. **UI clarity**:
   - Add cost-model indicator to CostDashboard header.
   - Add "free tier" badge next to free runs.
   - Show cached token breakdown in tables if present.
   - **Files:** CostDashboard.tsx, CostDisplay.tsx.

4. **Schema alignment**:
   - Convert issue_runs.costUsd from text to numeric(12, 6).
   - Adjust premium_requests precision as needed.
   - Create migration script.
   - **Files:** db/schema.ts, migration file.

### 4.3 Long-Term Architecture

1. **Separate billing from run engine**: Cost should not be computed at run-time; instead, batch-import rates from a central config or GitHub API.
2. **Support historical re-pricing**: When rates change, allow re-compute of past runs using new rates (opt-in).
3. **Integrate with GitHub Copilot API**: Fetch actual billing data from GitHub instead of estimating.

---

## Section 5: Implementation TODOs for W28/W29

### W28 (Quick Wins)

```
[TODO-1] Fix Claude Haiku 4.5 rates (critical)
  Title: Update Claude Haiku 4.5 pricing in cost-tracker + pricing tables
  Description: Claude Haiku input price: 0.25 → 1.00 USD/M tokens; output: 1.25 → 5.00.
               Also update multiplier table to 0.25 (already correct).
  Files: packages/server/src/sdk/cost-tracker.ts:14-35, pricing.ts:23-49
  Estimate: 15 min (2 edits, 1 test update)

[TODO-2] Fix GPT-4.1 and mini rates (high)
  Title: Update OpenAI GPT-4.1 and mini model pricing
  Description: GPT-4.1: 10.00 → 2.00 (input), 30.00 → 8.00 (output).
               GPT-5-mini: 0.15 → 0.25 (input), 0.60 → 2.00 (output).
               Ensure multipliers remain 0 (included models).
  Files: cost-tracker.ts, pricing.ts
  Estimate: 20 min

[TODO-3] Add missing model entries (high)
  Title: Add GPT-5.5, GPT-5.4-mini, Gemini variants, Claude 4.7, Raptor mini, Goldeneye
  Description: Add 8 model entries to both MODEL_PRICING and MODEL_MULTIPLIERS.
               Rates: GPT-5.5 (5.00/30.00), GPT-5.4-mini (0.75/4.50),
                      Gemini variants per docs, Claude 4.7 (assume 4.6 rates),
                      Raptor/Goldeneye per docs.
  Files: cost-tracker.ts, pricing.ts
  Estimate: 30 min (8 entries, 1 test update)

[TODO-4] Add cachedInputTokens to schema (high)
  Title: Add cached input token column to issue_runs, live_sessions, consult_sessions
  Description: Add `cachedInputTokens: integer().default(0)` to each table.
               No data migration; default to 0 for backward compat.
               Update CostTracker constructor & recordCost() to accept cached token param.
  Files: db/schema.ts, cost-tracker.ts
  Estimate: 20 min

[TODO-5] Ensure consult_sessions premium tracking (low)
  Title: Verify consult_sessions premium_requests always populated
  Description: Grep for all sites where consult_sessions rows are inserted.
               Ensure estimatePremiumRequests() is called and stored in premium_requests column.
               Add tests if any sites missing the stamp.
  Files: grep -r consult_sessions for mutations, add tests as needed
  Estimate: 25 min

[TODO-6] Add test: rate verification (medium)
  Title: Add unit tests for model rates vs GitHub docs
  Description: Test matrix of all models: verify rates match GitHub pricing tables.
               Spot-check a real run with new rates.
  Files: packages/server/src/__tests__/cost-*.test.ts
  Estimate: 45 min
```

### W29 (Medium-Term)

```
[TODO-7] Implement cached token cost computation (medium)
  Title: Add cached input cost calculation to CostTracker
  Description: Extend recordCost() to accept cachedInputTokens param.
               Compute cachedInputCostUsd = (cachedInputTokens / 1M) × (inputPrice × 0.1).
               Persist to new cachedInputCostUsd column.
               Update getCostSummary() to include in totalCostUsd.
  Files: cost-tracker.ts (CostTracker class + computeCost function),
         pricing.ts (add cachedTokenCost function),
         db/schema.ts (add cachedInputCostUsd column)
  Estimate: 2 hours

[TODO-8] Add cache write cost for Anthropic (medium)
  Title: Track and compute cache write costs for Claude models
  Description: Extend recordCost() to accept cacheWriteTokens (Anthropic only).
               Compute cacheWriteCostUsd = (cacheWriteTokens / 1M) × (inputPrice × 1.25).
               Update MODEL_PRICING to include cacheWriteMultiplier for Anthropic.
               Store in new cacheWriteCostUsd column on live_sessions / consult_sessions.
  Files: pricing.ts, cost-tracker.ts, db/schema.ts
  Estimate: 2.5 hours

[TODO-9] UI: Add cost-model indicator (low)
  Title: Display which cost model (USD vs premium) is active in Costs page
  Description: Update CostDashboard.tsx to show badge (e.g. "💵 USD model" vs "📊 Premium model").
               Pull costModel from project settings or SQUADBOARD_COST_MODEL env.
  Files: CostDashboard.tsx
  Estimate: 30 min

[TODO-10] Schema: Normalize costUsd type (medium)
  Title: Convert issue_runs.costUsd from text to numeric(12, 6)
  Description: Create migration to convert text → numeric. Backfill existing runs.
               Update CostTracker to store numeric instead of stringified.
               Test aggregate queries still work.
  Files: db/schema.ts, migration file, cost-tracker.ts
  Estimate: 1.5 hours
```

---

## Section 6: Open Questions for Brady

1. **Cached token accounting:** Should cached input tokens be tracked and displayed separately in the Costs dashboard, or rolled into total cost silently?

2. **Free-tier display:** When a project is on a free Copilot plan, should Squadboard show a "free" badge on runs, or only track premium requests?

3. **Historical re-pricing:** If GitHub releases new rates mid-month, should Squadboard re-price old runs (changing their historical cost), or freeze at run-time rates? (Current behavior: frozen; is this intended?)

4. **Cache write surfacing:** For Anthropic models, should cache write cost be shown as a separate line in cost tables, or merged into total cost?

5. **Code review billing:** Code review is now billed in both AI credits AND GitHub Actions minutes (starting June 1, 2026). Should Squadboard add a separate "GitHub Actions" cost column for code review runs?

6. **Tier auto-detection:** Should Squadboard infer free vs paid tier from project settings, or require explicit configuration in project settings?

---

## Section 7: Glossary

- **AI Credit:** GitHub's unified billing unit. 1 credit = $0.01 USD.
- **Cached Input Tokens:** Prompt tokens that the model has cached and can reuse; billed at 10% of regular input rate.
- **Cache Write Cost:** (Anthropic only) Tokens written to cache; billed at 1.25× input rate.
- **Premium Request:** GitHub's alternative billing unit for model multipliers (used for annual plans on request-based billing). Each model has a multiplier (0, 1, 10, etc.); 1 premium request per prompt × multiplier.
- **Included Model:** A model offered free on paid Copilot plans (e.g., GPT-4.1). Zero premium requests.
- **Stream D — D6:** Squadboard's wave task ID for adding GitHub Copilot premium-request tracking.
- **Fallback Pricing:** Default rate applied to unknown models (currently Claude Sonnet 4.5 at $3/$15).

---

## Appendix: Files Touched (By Priority)

### W28 Quick Wins
- `packages/server/src/sdk/cost-tracker.ts` (MODEL_PRICING table)
- `packages/server/src/sdk/pricing.ts` (MODEL_PRICING + MODEL_MULTIPLIERS tables)
- `packages/server/src/db/schema.ts` (add cachedInputTokens)
- `packages/server/src/__tests__/*cost*.test.ts` (update tests)

### W29 Medium-Term
- `packages/server/src/sdk/cost-tracker.ts` (recordCost + computeCost)
- `packages/server/src/sdk/pricing.ts` (cached token functions)
- `packages/server/src/db/schema.ts` (schema changes)
- `packages/client/src/components/costs/CostDashboard.tsx` (UI improvements)
- Migration files (text → numeric conversion)

---

**End of Research Report**
