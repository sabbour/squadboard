---
name: "api-error-sanitization"
description: "Prevent raw HTTP error bodies (HTML 500 pages, stack traces) from reaching the UI"
domain: "frontend,api,ux"
confidence: "high"
source: "Keyser delete-error-ux fix on 2026-05-19T23:37:54.700-07:00"
---

# API Error Sanitization

## Context

Use this pattern whenever a fetch-wrapper throws errors that might contain raw HTML, XML, or multiline stack traces. Without sanitisation these strings render verbatim inside UI labels.

## Pattern

### Layer 1 — at the fetch wrapper (`apiFetch`)

Never include the raw response body in the thrown `Error.message`.

```ts
function nonJsonErrorMessage(status: number, ct: string, rawBody: string): string {
  console.error(`[apiFetch] non-JSON error response (${status}, ${ct}):`, rawBody)
  if (status >= 500) {
    return `Server error (${status}) — the operation failed. Please try again or check the server logs.`
  }
  return `Request failed (${status}) — unexpected server response. Please try again.`
}
```

Key rules:
- **Log** the raw body to `console.error` (keeps it visible in devtools).
- **Throw** only a human-readable message (status code + plain sentence).
- Structured JSON `{ error: "string" }` bodies are **surfaced verbatim** — do not sanitise those.

### Layer 2 — at the render site (safety net)

```ts
function sanitizeApiError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e)
  if (!raw.includes('<')) return raw
  const stripped = raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  return stripped || 'Operation failed — an unexpected error occurred.'
}
```

Wire it into the mutation `onError` handler:
```ts
onError: (e) => {
  console.error('[Feature] operation error:', e)
  setError(sanitizeApiError(e))
},
```

## Testing

Mock `fetch` with `vi.stubGlobal('fetch', mockFn)` — avoids TypeScript `global` errors under strict mode.

Cover:
- 5xx HTML → message has no `<` tags, body is NOT in message
- 4xx HTML → same
- JSON `{ error }` → message is exact error string, `console.error` NOT called
- 2xx JSON → resolves correctly
- 204 No Content → resolves `null`
