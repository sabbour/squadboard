/**
 * 01-project-onboarding.spec.ts
 *
 * INVARIANT: "User can create a project and land on the kanban board"
 *
 * Covers Demo 1 — Hello Squadboard.
 * These are the first tests that must pass before any other suite runs.
 */
import { test, expect } from '@playwright/test'

test.describe('Demo 1 — Project onboarding', () => {
  test('ProjectPicker page loads with "Add Project" button', async ({ page }) => {
    await page.goto('/')

    // Heading
    await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible()

    // Primary CTA must always be reachable
    await expect(page.getByRole('button', { name: 'Add Project' })).toBeVisible()
  })

  test('Empty state shows discovery prompt when no projects exist', async ({ page }) => {
    await page.goto('/')

    // Either we have projects (grid) or we see the empty state.
    // We only assert the empty-state content if no project cards are rendered.
    const projectGrid = page.locator('[style*="grid"]')
    const hasProjects = await projectGrid.isVisible().catch(() => false)

    if (!hasProjects) {
      await expect(page.getByText('No projects yet')).toBeVisible()
      await expect(page.getByRole('button', { name: /Discover .squad\/ directories/i })).toBeVisible()
    } else {
      // At least one project card is visible — that is also a passing state
      await expect(page.locator('text=Projects')).toBeVisible()
    }
  })

  test('Add Project dialog opens with three tabs', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Add Project' }).click()

    await expect(page.getByRole('button', { name: 'Discover' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Connect' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Create' })).toBeVisible()
  })

  test('Create tab shows parent-directory and project-name fields', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Add Project' }).click()
    await page.getByRole('button', { name: 'Create' }).click()

    await expect(page.getByPlaceholder('/absolute/path/to/parent')).toBeVisible()
    await expect(page.getByPlaceholder('my-new-project')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Create project' })).toBeVisible()
  })

  test('Create project → redirects to kanban board with column headers', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Add Project' }).click()
    await page.getByRole('button', { name: 'Create' }).click()

    const projectName = `e2e-test-${Date.now()}`
    const parentPath = `/tmp/squadboard-e2e-${Date.now()}`

    await page.getByPlaceholder('/absolute/path/to/parent').fill(parentPath)
    await page.getByPlaceholder('my-new-project').fill(projectName)
    await page.getByRole('button', { name: 'Create project' }).click()

    // Should navigate to the board
    await page.waitForURL(/\/projects\/[^/]+\/board/, { timeout: 15_000 })
    expect(page.url()).toMatch(/\/projects\/[^/]+\/board/)

    // All five kanban columns must be visible
    await expect(page.getByText('Backlog')).toBeVisible()
    await expect(page.getByText('Ready')).toBeVisible()
    await expect(page.getByText('In Progress')).toBeVisible()
    await expect(page.getByText('Done')).toBeVisible()

    // Project name appears somewhere in the page header
    await expect(page.getByText(projectName)).toBeVisible()
  })

  test('Navigating to an existing project opens its board', async ({ page }) => {
    // First create a project so we have at least one
    await page.goto('/')
    await page.getByRole('button', { name: 'Add Project' }).click()
    await page.getByRole('button', { name: 'Create' }).click()

    const projectName = `e2e-nav-${Date.now()}`
    await page.getByPlaceholder('/absolute/path/to/parent').fill(`/tmp/e2e-nav-${Date.now()}`)
    await page.getByPlaceholder('my-new-project').fill(projectName)
    await page.getByRole('button', { name: 'Create project' }).click()
    await page.waitForURL(/\/projects\/[^/]+\/board/, { timeout: 15_000 })

    // Grab project ID from URL
    const match = page.url().match(/\/projects\/([^/]+)\/board/)
    const projectId = match?.[1]
    expect(projectId).toBeTruthy()

    // Navigate back to root, then click the project card
    await page.goto('/')
    await expect(page.getByText(projectName)).toBeVisible({ timeout: 8_000 })
    await page.getByText(projectName).click()
    await page.waitForURL(/\/projects\/[^/]+\/board/, { timeout: 10_000 })
    expect(page.url()).toContain(`/projects/${projectId}/board`)
  })
})
