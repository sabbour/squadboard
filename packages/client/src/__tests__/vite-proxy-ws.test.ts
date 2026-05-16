/**
 * vite-proxy-ws.test.ts — W27 Bug 3 regression
 *
 * Asserts that the Vite dev server proxy config includes a dedicated
 * '/api/ws' entry with `ws: true` and a ws:// target, so that WebSocket
 * upgrade requests from ws-client.ts are correctly forwarded to the
 * Express server on port 3000 instead of being closed mid-handshake.
 *
 * Root cause: having `ws: true` only on the broad '/api' entry with an
 * http:// target caused Vite to silently close WebSocket upgrade requests
 * before the connection was established. A more-specific '/api/ws' entry
 * with a ws:// target (evaluated first by Vite's proxy router) fixes the
 * upgrade routing.
 *
 * The proxy rules are extracted to src/proxy-config.ts so they can be
 * imported in jsdom vitest without pulling in vite's esbuild internals
 * (which break in jsdom due to TextEncoder invariant).
 */

import { describe, it, expect } from 'vitest'
import { proxyConfig } from '../proxy-config.ts'

describe('Bug 3 — Vite proxy has dedicated /api/ws WebSocket entry', () => {
  it('B3a: /api/ws proxy entry exists', () => {
    expect(Object.keys(proxyConfig)).toContain('/api/ws')
  })

  it('B3b: /api/ws entry has ws: true', () => {
    const wsEntry = proxyConfig['/api/ws']
    expect(wsEntry).toBeDefined()
    expect(wsEntry.ws).toBe(true)
  })

  it('B3c: /api/ws target uses ws:// protocol (explicit WS target)', () => {
    const wsEntry = proxyConfig['/api/ws']
    expect(typeof wsEntry.target).toBe('string')
    expect(wsEntry.target.startsWith('ws://')).toBe(true)
  })

  it('B3d: /api/ws target points to the correct API server port (3000)', () => {
    expect(proxyConfig['/api/ws'].target).toBe('ws://localhost:3000')
  })

  it('B3e: general /api HTTP entry does NOT have ws: true (avoids double-upgrade)', () => {
    const httpEntry = proxyConfig['/api']
    expect(httpEntry).toBeDefined()
    expect(httpEntry.ws).toBeFalsy()
  })
})
