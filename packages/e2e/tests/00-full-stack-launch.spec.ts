/**
 * 00-full-stack-launch.spec.ts
 *
 * INVARIANT: Playwright owns full-stack startup for the E2E suite.
 *
 * What does the system do when no developer has pre-started the backend?
 * The Playwright webServer config must launch the API and the Vite client,
 * then the browser can reach the real ProjectPicker through the dev proxy.
 */
import { test, expect, request } from '@playwright/test'
import { API_BASE } from './fixtures.ts'

test.describe('Full-stack launch', () => {
  test('API health and ProjectPicker are live under Playwright-owned startup', async ({ page }) => {
    const ctx = await request.newContext({ baseURL: API_BASE })
    const health = await ctx.get('/api/health')
    const healthText = await health.text()
    expect(health.status(), `health: ${healthText}`).toBe(200)
    const body = JSON.parse(healthText) as { status?: string }
    expect(body.status).toBe('ok')
    await ctx.dispose()

    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Add Project' })).toBeVisible()
  })
})
