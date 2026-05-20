const BASE = import.meta.env.VITE_API_URL ?? ''

/**
 * Build a user-facing message for a non-JSON (e.g. HTML 500) error response.
 * Raw body is logged to the console for debugging but never surfaced in the UI.
 */
function nonJsonErrorMessage(status: number, ct: string, rawBody: string): string {
  console.error(`[apiFetch] non-JSON error response (${status}, ${ct || 'no content-type'}):`, rawBody)
  if (status >= 500) {
    return `Server error (${status}) — the operation failed. Please try again or check the server logs.`
  }
  return `Request failed (${status}) — unexpected server response. Please try again.`
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  })
  if (!res.ok) {
    const ct = res.headers.get('content-type') || ''
    const body = await res.text()
    if (!ct.toLowerCase().includes('application/json')) {
      throw new Error(nonJsonErrorMessage(res.status, ct, body))
    }
    // Extract the `error` string from { error: "..." } response bodies so
    // callers see a clean message rather than the raw JSON envelope.
    try {
      const parsed = JSON.parse(body) as Record<string, unknown>
      if (typeof parsed.error === 'string') {
        throw new Error(parsed.error)
      }
    } catch (e) {
      if (e instanceof SyntaxError) { /* fall through to raw body throw */ }
      else throw e
    }
    throw new Error(`API ${res.status}: ${body}`)
  }
  // 204 No Content (and other empty-body responses, e.g. some DELETE endpoints)
  // would otherwise cause res.json() to throw "Unexpected end of JSON input",
  // breaking React Query mutations' onSuccess and leaving caches stale.
  if (res.status === 204 || res.headers.get('content-length') === '0') {
    return null as unknown as T
  }
  const text = await res.text()
  if (!text) return null as unknown as T
  const ct = res.headers.get('content-type') || ''
  if (!ct.toLowerCase().includes('application/json')) {
    throw new Error(nonJsonErrorMessage(res.status, ct, text))
  }
  return JSON.parse(text) as T
}
