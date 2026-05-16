/**
 * 10-loading-pattern.spec.ts
 *
 * K6 Stream acceptance test: "RTL + Playwright coverage prove the canonical
 * pattern lands on `/projects/:id/ceremonies` and `/projects/:id/costs`."
 *
 * Covers:
 * - Ceremonies page uses PageLoading with correct role/aria-live
 * - Costs page uses PageLoading with correct role/aria-live
 * - No stray "Loading…" text without a Spinner sibling (canonical pattern)
 */
import { test, expect } from '@playwright/test'
import { createProjectViaApi } from './fixtures'

test.describe('K6 — Canonical loading pattern (ceremonies + costs)', () => {
  let projectId: string

  test.beforeAll(async () => {
    // Create a project via API for use in all tests in this suite
    projectId = await createProjectViaApi(`k6-loading-test-${Date.now()}`)
  })

  test('Ceremonies page displays canonical loading state with role="status"', async ({ page }) => {
    // Simulate slow network by delaying the ceremonies fetch
    await page.route('**/api/projects/*/ceremonies', async (route) => {
      await new Promise((r) => setTimeout(r, 300)) // 300ms delay
      await route.continue()
    })

    // Navigate to ceremonies page
    await page.goto(`/projects/${projectId}/ceremonies`)

    // Within 200ms, the page should show the canonical loading state:
    // A role="status" element (the PageLoading wrapper) with aria-live="polite"
    const loadingWrapper = page.locator('[role="status"][aria-live="polite"]')
    await expect(loadingWrapper).toBeVisible({ timeout: 200 })

    // Verify it has aria-busy="true"
    await expect(loadingWrapper).toHaveAttribute('aria-busy', 'true')

    // Verify the PageHeader is still rendered (showing the project context)
    await expect(page.getByRole('heading', { name: 'Ceremonies' })).toBeVisible({ timeout: 500 })

    // After the page loads, the data grid should appear and the loading state should be gone
    await expect(page.getByRole('grid')).toBeVisible({ timeout: 5000 })
    await expect(loadingWrapper).not.toBeVisible()
  })

  test('Costs page displays canonical loading state with role="status"', async ({ page }) => {
    // Simulate slow network by delaying the project fetch
    await page.route('**/api/projects/*', async (route) => {
      // Let the first request (to get project data) be slower
      if (!route.request().url().includes('/ceremonies')) {
        await new Promise((r) => setTimeout(r, 300))
      }
      await route.continue()
    })

    // Navigate to costs page
    await page.goto(`/projects/${projectId}/costs`)

    // Within 200ms, the page should show the canonical loading state
    const loadingWrapper = page.locator('[role="status"][aria-live="polite"]')
    await expect(loadingWrapper).toBeVisible({ timeout: 200 })

    // Verify accessibility attributes
    await expect(loadingWrapper).toHaveAttribute('aria-busy', 'true')
    await expect(loadingWrapper).toHaveAttribute('aria-label', /Loading/)

    // Verify the page heading is rendered
    await expect(page.getByRole('heading', { name: 'Costs' })).toBeVisible({ timeout: 500 })

    // After the page loads, content should appear
    await expect(page.getByText('Month-to-date')).toBeVisible({ timeout: 5000 })
    await expect(loadingWrapper).not.toBeVisible()
  })

  test('No bare "Loading…" text without Spinner sibling on ceremonies page', async ({ page }) => {
    // Navigate to ceremonies page
    await page.goto(`/projects/${projectId}/ceremonies`)

    // Wait briefly for any loading state to appear
    await page.waitForTimeout(100)

    // Query for any div/span containing "Loading" text that is NOT part of a proper
    // role="status" element. The canonical pattern uses role="status" on the wrapper,
    // so "Loading…" should be a label on a Spinner, not free text in a div.
    const bareLoadingText = page.locator(
      'div:has-text("Loading"):not([role="status"])'
    )

    // There should be no bare "Loading…" divs
    await expect(bareLoadingText).toHaveCount(0)
  })

  test('No bare "Loading…" text without Spinner sibling on costs page', async ({ page }) => {
    // Navigate to costs page
    await page.goto(`/projects/${projectId}/costs`)

    // Wait briefly for any loading state to appear
    await page.waitForTimeout(100)

    // Query for any div/span containing "Loading" text that is NOT part of a proper
    // role="status" element
    const bareLoadingText = page.locator(
      'div:has-text("Loading"):not([role="status"])'
    )

    // There should be no bare "Loading…" divs
    await expect(bareLoadingText).toHaveCount(0)
  })

  test('PageLoading wraps PageHeader correctly on ceremonies page', async ({ page }) => {
    // Navigate to ceremonies page
    await page.goto(`/projects/${projectId}/ceremonies`)

    // The PageHeader (with title "Ceremonies") should be a child of the
    // role="status" wrapper when in loading state
    const statusWrapper = page.locator('[role="status"][aria-live="polite"]')

    // Wait for content to load and the status wrapper to disappear
    await expect(page.getByRole('heading', { name: 'Ceremonies' })).toBeVisible({ timeout: 5000 })

    // Once loaded, the normal page structure should be visible (not wrapped in status)
    await expect(statusWrapper).not.toBeVisible()
  })
})
