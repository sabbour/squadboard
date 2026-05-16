const BASE = import.meta.env.VITE_API_URL ?? ''

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  })
  if (!res.ok) {
    const ct = res.headers.get('content-type') || ''
    const body = await res.text()
    if (!ct.toLowerCase().includes('application/json')) {
      throw new Error(
        `API ${res.status}: expected JSON but got ${ct || 'unknown content-type'}. ` +
        `The endpoint may not exist or the server needs a restart. ` +
        `First 200 chars: ${body.slice(0, 200)}`
      )
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
    throw new Error(
      `API ${res.status}: expected JSON but got ${ct || 'unknown content-type'}. ` +
      `The endpoint may not exist or the server needs a restart. ` +
      `First 200 chars: ${text.slice(0, 200)}`
    )
  }
  return JSON.parse(text) as T
}
