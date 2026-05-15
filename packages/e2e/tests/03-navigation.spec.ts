/**
 * 03-navigation.spec.ts
 *
 * INVARIANT: "All main navigation pages render without crashing"
 *
 * Smoke tests every page that has a nav entry in Layout.tsx.
 * A page "passes" when it renders at least one meaningful element
 * (heading, section title, table, or content area) and does NOT
 * show an uncaught error boundary.
 */
import { test, expect } from '@playwright/test'
import { createProject } from './fixtures.ts'

let projectId: string

test.describe('Navigation smoke tests', () => {
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage()
    projectId = await createProject(page, `e2e-nav-${Date.now()}`)
    await page.close()
  })

  // Helper: assert no React error boundary message is visible
  async function expectNoCrash(page: import('@playwright/test').Page) {
    // React's default error boundary shows "Something went wrong"
    await expect(page.getByText(/something went wrong/i)).not.toBeVisible()
  }

  test('Board page renders kanban columns', async ({ page }) => {
    await page.goto(`/projects/${projectId}/board`)
    await expectNoCrash(page)
    await expect(page.getByText('Backlog').first()).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('In Progress').first()).toBeVisible()
    await expect(page.getByText('Done').first()).toBeVisible()
  })

  test('Dashboard page renders without crashing', async ({ page }) => {
    await page.goto(`/projects/${projectId}/dashboard`)
    await expectNoCrash(page)
    // Dashboard renders StatCards or a loading spinner — wait for either
    await page.waitForSelector('[style*="padding"]', { timeout: 10_000 })
    // Should not display a hard error state
    await expect(page.getByText('Failed to load project')).not.toBeVisible()
  })

  test('Agents page renders "Agents" heading', async ({ page }) => {
    await page.goto(`/projects/${projectId}/agents`)
    await expectNoCrash(page)
    // The Agents page has a Subtitle1 "Agents" heading
    await expect(page.getByRole('heading', { name: 'Agents' }).or(page.getByText('Agents').first())).toBeVisible({ timeout: 10_000 })
    // "Hire Agent" button is always present on the agents tab
    await expect(page.getByRole('button', { name: /Hire Agent/i })).toBeVisible()
  })

  test('Workflows page renders without crashing', async ({ page }) => {
    await page.goto(`/projects/${projectId}/workflows`)
    await expectNoCrash(page)
    await expect(page.getByText('Failed to load project')).not.toBeVisible({ timeout: 10_000 })
    // Workflows page renders a list or empty state — just ensure no crash
    await page.waitForTimeout(2_000)
    await expectNoCrash(page)
  })

  test('Costs page renders without crashing', async ({ page }) => {
    await page.goto(`/projects/${projectId}/costs`)
    await expectNoCrash(page)
    await expect(page.getByText('Failed to load project')).not.toBeVisible({ timeout: 10_000 })
  })

  test('Settings page renders General / MCP / Budget sections', async ({ page }) => {
    await page.goto(`/projects/${projectId}/settings`)
    await expectNoCrash(page)
    await expect(page.getByText('Failed to load project')).not.toBeVisible({ timeout: 10_000 })
    // Settings has sidebar items General, MCP Config, Budget
    await expect(page.getByText('General').first()).toBeVisible({ timeout: 8_000 })
    await expect(page.getByText('MCP Config')).toBeVisible()
    await expect(page.getByText('Budget')).toBeVisible()
  })

  test('/projects/:id redirects to dashboard', async ({ page }) => {
    await page.goto(`/projects/${projectId}`)
    // The route has <Navigate to="dashboard" replace /> so URL should end in /dashboard
    await page.waitForURL(`/projects/${projectId}/dashboard`, { timeout: 5_000 })
    expect(page.url()).toContain('/dashboard')
  })

  test('Unknown route redirects to ProjectPicker', async ({ page }) => {
    await page.goto('/this-does-not-exist')
    await page.waitForURL('/', { timeout: 5_000 })
    await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible()
  })

  test('Side navigation links are all present', async ({ page }) => {
    await page.goto(`/projects/${projectId}/board`)
    await expectNoCrash(page)

    // The Layout nav renders link text for each section
    for (const label of ['Board', 'Agents', 'Workflows', 'Costs', 'Settings']) {
      await expect(page.getByText(label).first()).toBeVisible({ timeout: 8_000 })
    }
  })
})
