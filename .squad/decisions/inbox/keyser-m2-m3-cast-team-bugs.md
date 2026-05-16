# Decision: M2 apiFetch Content-Type Guard + M3 Cast-Team Label-Toggle Fix

**Date:** 2026-05-15  
**Agent:** Keyser (Frontend)  
**Commit:** c7dde255

---

## M2 — apiFetch Content-Type Guard

**Problem:** When Express serves `index.html` for a missing API route, `JSON.parse('<!doctype...')` throws cryptic "Unexpected token '<'" with no context.

**Decision:** Check `content-type` header on **both** error and success paths in `apiFetch`:

- **Error path (`!res.ok`):** Read body, check `content-type`. If not `application/json`, throw a diagnostic message including the status, actual content-type, and first 200 chars of the body. If it is JSON, throw the existing `API ${status}: ${body}` message.
- **Success path (after `res.text()`):** Same guard — if content-type is not `application/json`, throw the same friendly error before calling `JSON.parse`.

**Effect:** HTML-200 and HTML-4xx/5xx responses both produce human-readable errors pointing at the missing endpoint or server restart need.

---

## M3 — HireTeamModal Checkbox Label-Toggle Bug

**Problem:** Clicking any role label (Developer, PM, Marketing, etc.) checked/unchecked the **Lead** checkbox only.

**Root cause:** `<Field label="Required roles (optional)" hint="...">` wraps all 16 `<Checkbox>` siblings. Fluent's `<Field>` generates a single `htmlFor` pointing at its first form child (`lead`). The OS routes all label clicks to that single input.

**Decision:**
1. **Replace `<Field>` with `<fieldset>` + `<legend>`** — semantically correct for a group of checkboxes, no single `htmlFor` binding. Styled to match Fluent2 Field typography (`font-size: 14px`, `font-weight: 400`, `color: colorNeutralForeground1`). Hint text rendered as a `<span>` below the checkboxes.
2. **Add explicit `id={`role-${r.id}`}` to each `<Checkbox>`** — makes each label↔input binding unambiguous even if Fluent's internal `useId()` collidesunder concurrent renders.
3. **Add `import.meta.env.DEV` uniqueness invariant** after `ROLE_OPTIONS` — throws during development if any two roles share the same `id`, preventing the bug from being reintroduced.

**Note:** Used `import.meta.env.DEV` instead of `process.env.NODE_ENV` — the client is a Vite app and doesn't have `@types/node`; `process` is not in scope.
