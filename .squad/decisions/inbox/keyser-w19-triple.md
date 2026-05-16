# Keyser W19 — Three-item batch decision log

**Date:** 2026-05-15T22:42:29.855-07:00
**Author:** Keyser (Frontend Dev)

---

## O7 — Formulate ceremony grammar bug

### Root cause

`buildProseAuthorPrompt` in `services/ceremony-translator.ts` described step
types using shorthand bullet notation:

```
- agent_run: { agent: ..., prompt: ... }
```

LLMs interpret this as a **YAML mapping-key** syntax (key `agent_run` → value
object), not as `- type: agent_run\n  agent: ...`.  `validateWorkflowYaml`
requires a `type:` field on every step; it threw:

> `step[0]: 'type' must be one of route | agent_run | approve | fan_out | handoff`

That error was then wrapped raw as `API 502: {"error":"..."}` by `apiFetch`,
which showed a confusing JSON envelope to the user.

### Fix

1. **`services/ceremony-translator.ts`** — replaced shorthand bullet schema
   with an explicit, indented YAML example that shows the `type:` field
   verbatim, plus a `CRITICAL:` constraint line reinforcing it.
2. **`api/client.ts`** (`apiFetch`) — added JSON body parsing of error
   responses: extracts `parsed.error` string when the body is
   `{ error: "..." }`, so callers see a clean human message instead of the
   raw JSON envelope.
3. Prompt now also ships a concrete two-step `Daily Standup` YAML example so
   the LLM has an unambiguous template to follow.

### Alternate "from text" path removed

The **narrative → convert** path was the second text-to-ceremony flow:

- Users could set `kind: narrative` in the ceremony form, write prose, then
  click "Convert to executable" (which called `POST /:id/convert`).
- **Removed from UI:** `narrative` option filtered from both kind dropdowns in
  `CeremonyEditor.tsx` (using the existing `deprecated: true` flag on the
  `CEREMONY_KIND_OPTIONS` entry), "Convert to executable" button and
  `handleConvert` callback deleted, `convertToast` state removed,
  `useConvertCeremony` import dropped.
- **Backend kept:** `POST /:id/convert`, `POST /:id/translate`, and
  `POST /api/ceremonies/import-narrative` routes are untouched — they are
  shared infra used by the daemon and SDK.
- Existing ceremonies with `kind='narrative'` in the DB are still rendered
  read-only (`readOnly = kind === 'narrative'`).

---

## W19 Conjure deep-link from card (conjure-workitem-deeplink)

### Mechanism

`CardDetail.tsx` — overflow `…` button added to the top-right of the panel
header (a Fluent2 `Menu`/`MenuTrigger`/`MenuPopover`/`MenuList` with a single
`MenuItem`).

- **Icon:** `MoreHorizontal20Regular` for the trigger; `Lightbulb20Regular`
  for the "Investigate in Conjure" item (consistent with Conjure's brand icon).
- **On click:** `onClose()` first (closes the panel), then
  `navigate(`/projects/${projectId}/consult/new?prefill=issue:${issue.id}`)`.

### Prefill mapping (Consult.tsx — no changes needed)

The existing `?prefill=issue:<id>` handler in `Consult.tsx` (Phase 17) already
does exactly what the spec required:

| Spec requirement | Mapped field |
|---|---|
| Title as Conjure input | `prefill.content` ← `issue.title + body` |
| Body as additional context | Appended to `prefill.content` |
| Labels as tags | Serialised into context block |
| Linked GitHub issue as reference | Latest run output + git branch/PR if present |

No changes to `Consult.tsx` — the existing mechanism is complete.

### Invalid card ID

If the issue fetch fails inside Consult's prefill effect, it catches the error,
logs a warning, and starts a blank Conjure session (existing non-fatal fallback).

---

## Q9 — Manual End-wave button

### Placement

Added to the **CeremonyList** page header toolbar (`actions` prop of
`PageHeader`), to the left of "New ceremony". Chosen because:

- Ceremonies are the mechanism that runs Scribe close-out.
- The toolbar is always visible — no nested settings nav needed.
- Button is labelled "End wave" with a `Flag20Regular` icon.
- Disabled + spinner while running.

### UX flow

1. Click "End wave" → confirmation `Dialog` opens.
2. Dialog body: "End the current wave? This will run Scribe close-out: merge
   inbox decisions into **decisions.md**, archive old history, commit. ~30 seconds."
3. Primary "End wave" button + Cancel.
4. Confirmed → dialog closes; toast appears: "Running Scribe close-out…"
5. On success: "Wave closed ✓ (commit abc1234)" (SHA from `result.commitSha`).
6. On error: error message in the toast.
7. Toast auto-dismisses after 8 seconds.

### Endpoint contract

**`POST /api/projects/:projectId/ceremonies/invoke`**

Request:
```json
{ "ceremonySlug": "scribe-close-out", "context": { "projectId": "..." } }
```

Response (success 200):
```json
{ "ok": true, "result": { "commitSha": "abc1234...", ... } }
```

Response (error 400/502):
```json
{ "error": "no built-in ceremony registered with id 'X'" }
```

The endpoint delegates to `invokeBuiltInCeremony(ceremonySlug, { projectId, extra: context })`.
Errors from `TranslatorError` (which wraps SDK failures) are forwarded as
400 (non-retryable) or 502 (retryable).

### Optional schedule setting

Filed as follow-up (Q9-schedule): per-project "Auto-run end-of-wave Scribe
every N hours" on the Settings page. Non-trivial (needs a new DB column +
daemon integration) — deferred past W19.

---

## Coordination notes

- **McManus W19 Item 4** (Deliverable concept / work item model): if `Issue`
  gains a `deliverable` field, the Conjure prefill in `CardDetail.tsx` will
  pick it up automatically — the `?prefill=issue:` handler in Consult fetches
  the full issue object, so any new fields will be available in the context
  block without a CardDetail change.
- **Verbal W19** (Stream J): no overlapping files this wave.
