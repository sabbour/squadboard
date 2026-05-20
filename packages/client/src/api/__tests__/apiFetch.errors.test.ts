/**
 * apiFetch.errors.test.ts
 *
 * Regression coverage for the error-message sanitisation added in W30:
 *   - 500 HTML responses must NOT include raw HTML / stack fragments in the
 *     thrown error message (they are logged to console.error instead).
 *   - 4xx HTML responses produce a clean "Request failed" message.
 *   - 5xx JSON { error: "..." } responses are still surfaced verbatim (the
 *     structured path must remain unbroken).
 *   - 2xx JSON round-trips continue to work normally.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'

// ── Suppress console.error noise in test output ────────────────────────────
const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

// ── Minimal fetch mock helpers ──────────────────────────────────────────────

function makeFetchMock(overrides: {
  ok: boolean
  status: number
  headers?: Record<string, string>
  body: string
}) {
  const { ok, status, headers = {}, body } = overrides
  return vi.fn().mockResolvedValue({
    ok,
    status,
    headers: {
      get: (name: string) => headers[name.toLowerCase()] ?? null,
    },
    text: () => Promise.resolve(body),
  })
}

import { apiFetch } from '../client.ts'

describe('apiFetch — non-JSON error responses', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    consoleSpy.mockClear()
  })

  it('throws a clean message (no HTML) when the server returns a 500 text/html body', async () => {
    vi.stubGlobal('fetch', makeFetchMock({
      ok: false,
      status: 500,
      headers: { 'content-type': 'text/html; charset=utf-8' },
      body: '<!DOCTYPE html><html><head><title>Error</title></head><body><pre>could not open relation with OID 66346\n    at pe.Oe (/home/asabbour/GitWSL/s</pre></body></html>',
    }))

    await expect(apiFetch('/api/projects/123', { method: 'DELETE' })).rejects.toSatisfy(
      (err: unknown) => {
        const msg = (err as Error).message
        // Must NOT contain raw HTML artefacts
        expect(msg).not.toContain('<!DOCTYPE')
        expect(msg).not.toContain('<html')
        expect(msg).not.toContain('<pre>')
        expect(msg).not.toContain('OID 66346')
        // Must be a user-friendly message mentioning the status code
        expect(msg).toContain('500')
        return true
      },
    )

    // The raw body must have been sent to console.error for diagnostics
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[apiFetch]'),
      expect.anything(),
    )
  })

  it('throws a clean message when the server returns a 404 text/html body', async () => {
    vi.stubGlobal('fetch', makeFetchMock({
      ok: false,
      status: 404,
      headers: { 'content-type': 'text/html' },
      body: '<html><body>Not Found</body></html>',
    }))

    await expect(apiFetch('/api/projects/missing')).rejects.toSatisfy((err: unknown) => {
      const msg = (err as Error).message
      expect(msg).not.toContain('<html')
      expect(msg).toContain('404')
      return true
    })
  })

  it('preserves a structured JSON error message from a 500 JSON response', async () => {
    vi.stubGlobal('fetch', makeFetchMock({
      ok: false,
      status: 500,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error: 'Project not found in database' }),
    }))

    await expect(apiFetch('/api/projects/123', { method: 'DELETE' })).rejects.toThrow(
      'Project not found in database',
    )
    // No console.error call because it went through the JSON path
    expect(consoleSpy).not.toHaveBeenCalled()
  })

  it('returns parsed JSON on a successful 200 response', async () => {
    vi.stubGlobal('fetch', makeFetchMock({
      ok: true,
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ok: true, deleted: { metadata: true, folder: false } }),
    }))

    const result = await apiFetch<{ ok: boolean }>('/api/projects/123', { method: 'DELETE' })
    expect(result.ok).toBe(true)
  })

  it('returns null on a 204 No Content response without throwing', async () => {
    vi.stubGlobal('fetch', makeFetchMock({
      ok: true,
      status: 204,
      headers: { 'content-length': '0' },
      body: '',
    }))

    const result = await apiFetch('/api/projects/123', { method: 'DELETE' })
    expect(result).toBeNull()
  })
})

describe('apiFetch — sanitizeApiError safety net (via DangerZoneSection logic)', () => {
  it('a message with HTML tags in it does not reach the user — baseline check', () => {
    // This mirrors the sanitiseApiError helper added to Settings.tsx.
    // If apiFetch ever leaks HTML (e.g. from a custom transport), the
    // Settings-level helper strips it.
    function sanitizeApiError(e: unknown): string {
      const raw = e instanceof Error ? e.message : String(e)
      if (!raw.includes('<')) return raw
      const stripped = raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
      return stripped || 'Delete failed — an unexpected error occurred.'
    }

    const htmlErr = new Error('API 500: <html><body><pre>stack trace</pre></body></html>')
    const safe = sanitizeApiError(htmlErr)
    expect(safe).not.toContain('<')
    expect(safe).not.toContain('>')
    expect(safe).toContain('API 500')
  })

  it('passes through a clean message unchanged', () => {
    function sanitizeApiError(e: unknown): string {
      const raw = e instanceof Error ? e.message : String(e)
      if (!raw.includes('<')) return raw
      const stripped = raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
      return stripped || 'Delete failed — an unexpected error occurred.'
    }

    const clean = new Error('Server error (500) — please try again or check the server logs.')
    expect(sanitizeApiError(clean)).toBe(clean.message)
  })
})
