const BASE = import.meta.env.VITE_API_URL ?? ''

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  })
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`)
  // 204 No Content (and other empty-body responses, e.g. some DELETE endpoints)
  // would otherwise cause res.json() to throw "Unexpected end of JSON input",
  // breaking React Query mutations' onSuccess and leaving caches stale.
  if (res.status === 204 || res.headers.get('content-length') === '0') {
    return null as unknown as T
  }
  const text = await res.text()
  if (!text) return null as unknown as T
  return JSON.parse(text) as T
}
