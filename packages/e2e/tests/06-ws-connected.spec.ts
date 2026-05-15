/**
 * 06-ws-connected.spec.ts — Wave 10 B5 regression
 *
 * INVARIANT: the realtime presence badge transitions to "Connected" within
 * 5 seconds of opening a project board.
 *
 * Wave 10 background: the WebSocket server was mounted at `/ws` while the
 * client opened `${WS_BASE}/api/ws`. In dev, Vite's `/api` proxy (with
 * `ws: true`) forwarded the upgrade to the backend at `/api/ws`, which the
 * server didn't recognise → every handshake failed → the badge sat on yellow
 * "Reconnecting…" forever. The fix moved the server path to `/api/ws` to
 * match the client. This spec is a permanent guard for that contract.
 */
import { test, expect } from '@playwright/test'
import { createProject } from './fixtures'

test.describe('Wave 10 B5 — WS handshake reaches Connected', () => {
  test('badge says Connected within 5s of project board load', async ({ page }) => {
    const projectName = `ws-connect-${Date.now()}`
    await createProject(page, projectName)

    // The PresenceBar renders a small status dot with aria-label set to
    // "Connected" / "Reconnecting…" / "Connecting…" / "Disconnected".
    // Reaching "Connected" within 5s means the WS upgrade matched the server
    // path AND the open handler fired AND the state machine fired. If any
    // of those silently breaks, this assertion fails fast.
    await expect(page.locator('[aria-label="Connected"]')).toBeVisible({
      timeout: 5_000,
    })
  })
})
