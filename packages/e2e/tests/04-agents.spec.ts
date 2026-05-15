/**
 * 04-agents.spec.ts
 *
 * INVARIANT: "User can view and manage agents"
 *
 * Covers Demo 3 — Squad onboarding (basic coverage).
 * Full agent lifecycle tests (discover from .squad/, enable/disable) are
 * deferred until the backend fixtures are in place.
 */
import { test, expect } from '@playwright/test'
import { createProject } from './fixtures.ts'

let projectId: string

test.describe('Demo 3 — Agent management', () => {
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage()
    projectId = await createProject(page, `e2e-agents-${Date.now()}`)
    await page.close()
  })

  test('Agents page renders heading and agent count badge', async ({ page }) => {
    await page.goto(`/projects/${projectId}/agents`)

    // The Subtitle1 "Agents" heading
    await expect(page.getByText('Agents').first()).toBeVisible({ timeout: 10_000 })

    // Agent count badge renders (even if 0)
    // It's a span next to the heading — we just assert no crash
    await expect(page.getByText('Failed to load agents.')).not.toBeVisible()
  })

  test('"Hire Agent" button is visible on the agents tab', async ({ page }) => {
    await page.goto(`/projects/${projectId}/agents`)
    await expect(page.getByRole('button', { name: /Hire Agent/i })).toBeVisible({ timeout: 8_000 })
  })

  test('"Hire Agent" dialog opens with Name, Role, Model, Expertise fields', async ({ page }) => {
    await page.goto(`/projects/${projectId}/agents`)
    await page.getByRole('button', { name: /Hire Agent/i }).click()

    // Dialog title
    await expect(page.getByText('Hire Agent').first()).toBeVisible({ timeout: 5_000 })

    // Fields
    await expect(page.getByPlaceholder('e.g. design-lead')).toBeVisible()
    await expect(page.getByPlaceholder('e.g. Frontend Developer')).toBeVisible()
    await expect(page.getByPlaceholder('e.g. React, TypeScript, CSS')).toBeVisible()

    // Hire Agent submit button (in the modal footer)
    await expect(page.getByRole('button', { name: 'Hire Agent' }).last()).toBeVisible()
  })

  test('Create agent via Hire Agent modal → agent appears in the grid', async ({ page }) => {
    await page.goto(`/projects/${projectId}/agents`)
    await page.getByRole('button', { name: /Hire Agent/i }).click()

    const agentName = `e2e-agent-${Date.now()}`
    await page.getByPlaceholder('e.g. design-lead').fill(agentName)
    await page.getByPlaceholder('e.g. Frontend Developer').fill('QA Engineer')

    // Submit
    await page.getByRole('button', { name: 'Hire Agent' }).last().click()

    // Dialog should close and agent should appear in the grid
    await expect(page.getByText(agentName)).toBeVisible({ timeout: 10_000 })
  })

  test('Agents page has Routing tab that renders routing stats', async ({ page }) => {
    await page.goto(`/projects/${projectId}/agents`)

    // Switch to the Routing tab
    await page.getByRole('button', { name: /Routing/i }).click()

    // Routing tab shows "Routing Stats" and "Routing Log" section headers
    await expect(page.getByText('Routing Stats')).toBeVisible({ timeout: 8_000 })
    await expect(page.getByText('Routing Log')).toBeVisible()
  })

  test('Agent detail panel opens on card click', async ({ page }) => {
    // This test depends on at least one agent existing.
    // If none, it creates one first.
    await page.goto(`/projects/${projectId}/agents`)

    let agentName: string | null = null

    // Check if any agent card is already visible
    const agentCards = page.locator('[style*="grid"]').locator('[style*="border"]')
    if ((await agentCards.count()) === 0) {
      // Create one
      await page.getByRole('button', { name: /Hire Agent/i }).click()
      agentName = `e2e-detail-agent-${Date.now()}`
      await page.getByPlaceholder('e.g. design-lead').fill(agentName)
      await page.getByPlaceholder('e.g. Frontend Developer').fill('Test Agent')
      await page.getByRole('button', { name: 'Hire Agent' }).last().click()
      await expect(page.getByText(agentName)).toBeVisible({ timeout: 10_000 })
    }

    // Click the first visible agent name text to open detail panel
    const targetText = agentName ?? (await page.locator('text=/e2e-/').first().textContent()) ?? ''
    if (targetText) {
      await page.getByText(targetText).first().click()
      // Detail panel slides in — it contains the agent name in a heading or title area
      await expect(page.getByText(targetText).nth(1)).toBeVisible({ timeout: 5_000 })
    } else {
      test.fixme(true, 'No agent name found to click — seed the project with an agent first')
    }
  })

  test.fixme(
    'Discover agents from .squad/ directory populates the agent grid',
    'Requires a .squad/agents/ directory on the test machine with YAML definitions. ' +
      'Implement once the test fixture seed script is in place.',
  )

  test.fixme(
    'Disable agent hides it from the active grid',
    'Requires AgentCard to expose a disable/enable toggle in the detail panel. ' +
      'Verify the PATCH /api/projects/:id/agents/:agentId endpoint and UI.',
  )
})
