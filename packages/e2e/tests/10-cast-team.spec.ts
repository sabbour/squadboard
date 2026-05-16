/**
 * 10-cast-team.spec.ts
 *
 * REGRESSION: M1 + M2 + M3 — Cast-a-Team modal full flow
 *
 * M1 (Hockney, 8967ac72): Added /hire-team/propose + /hire-team/confirm routes.
 *   Before M1 those routes were unimplemented; Express served index.html, causing
 *   "Unexpected token '<'" on the client.
 *
 * M2 (Keyser, c7dde255): apiFetch Content-Type guard — both success and error paths
 *   now throw a human-readable error when the server returns HTML instead of JSON.
 *
 * M3 (Keyser, c7dde255): HireTeamModal checkbox label-toggle bug — clicking any
 *   role label was toggling the Lead checkbox (wrong htmlFor binding via Fluent
 *   <Field>). Fixed by replacing <Field> with <fieldset>/<legend> and adding
 *   explicit id={`role-${r.id}`} to every <Checkbox>.
 */
import { test, expect } from '@playwright/test'
import { createProjectViaApi } from './fixtures.ts'

let projectId: string

test.describe('Cast-a-Team modal — M1/M2/M3 regression suite', () => {
  test.beforeAll(async () => {
    projectId = await createProjectViaApi(`e2e-cast-team-${Date.now()}`)
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Test 1: Button visibility
  // ─────────────────────────────────────────────────────────────────────────
  test('Cast a Team button is visible on the agents page', async ({ page }) => {
    await page.goto(`/projects/${projectId}/agents`)
    await page.waitForLoadState('networkidle')

    // The button in Agents.tsx is a native <button> with text "Hire Team"
    await expect(page.getByRole('button', { name: /Hire Team/i })).toBeVisible({ timeout: 10_000 })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Test 2: Opening the modal — crash-free render with role checkboxes
  // ─────────────────────────────────────────────────────────────────────────
  test('Opening Cast a Team modal shows role checkboxes without crashing', async ({ page }) => {
    await page.goto(`/projects/${projectId}/agents`)
    await page.waitForLoadState('networkidle')

    await page.getByRole('button', { name: /Hire Team/i }).click()

    // Modal title
    await expect(page.getByText('Cast a team')).toBeVisible({ timeout: 8_000 })

    // Role checkboxes — check for the three core labels (with emoji as rendered)
    await expect(page.getByLabel('🏗️ Lead')).toBeVisible({ timeout: 5_000 })
    await expect(page.getByLabel('🔧 Developer')).toBeVisible()
    await expect(page.getByLabel('🎯 PM')).toBeVisible()

    // M2 regression: NO "Unexpected token" parse error surfaced in the page body
    await expect(page.getByText(/Unexpected token/i)).not.toBeVisible()
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Test 3: M3 regression — label clicks toggle only the targeted checkbox
  // ─────────────────────────────────────────────────────────────────────────
  test('Clicking a non-Lead role label toggles only that role (M3 regression)', async ({ page }) => {
    await page.goto(`/projects/${projectId}/agents`)
    await page.waitForLoadState('networkidle')

    await page.getByRole('button', { name: /Hire Team/i }).click()
    await expect(page.getByText('Cast a team')).toBeVisible({ timeout: 8_000 })

    const leadCheckbox = page.locator('#role-lead')
    const developerCheckbox = page.locator('#role-developer')
    const pmCheckbox = page.locator('#role-pm')

    // Lead starts checked (default state); Developer + PM start unchecked
    await expect(leadCheckbox).toBeChecked()
    const devInitial = await developerCheckbox.isChecked()

    // Click the Developer label (not the input) — directly tests the htmlFor binding
    await page.locator('label[for="role-developer"]').click()

    // Developer's state must have flipped
    expect(await developerCheckbox.isChecked()).toBe(!devInitial)

    // Lead must NOT have changed — this is the M3 regression guard
    await expect(leadCheckbox).toBeChecked()

    // Repeat for PM
    const pmInitial = await pmCheckbox.isChecked()
    await page.locator('label[for="role-pm"]').click()

    expect(await pmCheckbox.isChecked()).toBe(!pmInitial)
    // Lead still unchanged
    await expect(leadCheckbox).toBeChecked()
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Test 4: M1 + M2 regression — propose route returns 200 JSON + member list
  // ─────────────────────────────────────────────────────────────────────────
  test('Submitting the form calls /hire-team/propose and surfaces a member list (M1 regression)', async ({ page }) => {
    await page.goto(`/projects/${projectId}/agents`)
    await page.waitForLoadState('networkidle')

    await page.getByRole('button', { name: /Hire Team/i }).click()
    await expect(page.getByText('Cast a team')).toBeVisible({ timeout: 8_000 })

    // Ensure Lead + Developer are both selected before casting
    const leadCheckbox = page.locator('#role-lead')
    const developerCheckbox = page.locator('#role-developer')

    if (!(await leadCheckbox.isChecked())) {
      await page.locator('label[for="role-lead"]').click()
    }
    if (!(await developerCheckbox.isChecked())) {
      await page.locator('label[for="role-developer"]').click()
    }

    // Wire up network intercept BEFORE clicking submit
    const proposeResponsePromise = page.waitForResponse(
      (res) => res.url().includes('/hire-team/propose'),
      { timeout: 20_000 },
    )

    // Click "Cast Team" — the primary action button in the configure step
    await page.getByRole('button', { name: /Cast Team/i }).click()

    const proposeResponse = await proposeResponsePromise

    // M1 regression: route must exist and return 200
    expect(proposeResponse.status()).toBe(200)

    // M2 regression: response must be JSON, not HTML
    const contentType = proposeResponse.headers()['content-type'] ?? ''
    expect(contentType).toContain('application/json')

    // M2 regression: NO "Unexpected token" error in page body
    await expect(page.getByText(/Unexpected token/i)).not.toBeVisible()

    // After a successful propose the modal moves to "review" step
    // and renders at least 1 proposed member name (member buttons appear)
    await expect(page.getByText('Cast complete')).toBeVisible({ timeout: 10_000 })

    // At least one member button should be visible in the review step
    // Members render as <button> elements containing the character name
    const memberButtons = page.getByRole('button').filter({ hasNotText: /Hire|Back|Cancel|Cast/i })
    await expect(memberButtons.first()).toBeVisible({ timeout: 8_000 })
  })
})
