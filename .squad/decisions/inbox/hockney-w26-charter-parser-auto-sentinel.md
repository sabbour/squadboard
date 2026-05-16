# Decision: Charter Parser — `auto` Is a Sentinel (W26)

**Date:** 2026-05-16  
**Author:** Hockney  
**Status:** Accepted  
**Wave:** 26  
**Severity:** P0 bug fix

---

## Bug Report

Runs were failing with:

```
Request session.create failed with message: Model "**Preferred:** auto" is not available.
```

The platform API received the literal string `**Preferred:** auto` as the `model` field and rejected it.

---

## Root Cause

**File:** `packages/server/src/services/charter-compiler.ts`  
**Function:** `parseCharterContent()` — `case 'model':` branch

When a charter's `## Model` section contains:

```markdown
## Model

- **Preferred:** auto
```

The original parser only stripped the leading `- ` bullet marker:

```typescript
model = trimmed.replace(/^-\s*/, '').trim();
// result: "**Preferred:** auto"  ← raw markdown, including bold prefix
```

This raw string — including the markdown bold syntax — was then stored in `CharterMetadata.model` and passed directly to the spawn payload as the `model` field.

`model-defaults.ts`'s `isUnspecified()` only handles the exact string `'auto'`, not `'**Preferred:** auto'`, so the malformed value passed through the resolution chain unchanged and reached the platform API.

---

## The Rule (from `.github/agents/squad.agent.md`)

> **Layer 2 — Charter Preference:** Does the agent's charter have a `## Model` section with `Preferred` set to a specific model (not `auto`)? If yes, use that model.
>
> If charter says `Preferred: auto`, treat as sentinel — OMIT the `model` param entirely. Only set `model` when it differs from default.

---

## Fix

**File:** `packages/server/src/services/charter-compiler.ts`

### `case 'model':` block

After stripping the leading bullet marker, the parser now:

1. Detects `**Key:** value` (bold markdown) pattern and extracts just `value`
2. Falls back to `Key: value` (plain text) pattern and extracts just `value`
3. Strips trailing annotations after `→` or `>` (e.g. `auto → coordinator selected …`)
4. Treats the result as sentinel if it is `auto`, `default`, or empty — leaves `model` as `undefined`
5. Otherwise assigns the cleaned value as `model`

### `identity_table` section

Added the same sentinel guard for `Model` entries in markdown tables and bold-key list items, so `| Model | auto |` also returns `undefined`.

---

## Affected Paths

- `packages/server/src/services/charter-compiler.ts` — fix
- `packages/server/src/__tests__/charter-parser.test.ts` — 12 new regression tests

---

## Verification

```
12/12 vitest cases green
pnpm -r build exit 0
```

---

## Rule Going Forward

`auto` and `default` in the `## Model` charter section are **sentinels**. The parser MUST NOT forward them to the platform API. The spawn payload must omit `model` entirely when these values are present, allowing the platform to pick. Only concrete model IDs (e.g. `claude-sonnet-4.6`, `gpt-5.4`) should be forwarded.
