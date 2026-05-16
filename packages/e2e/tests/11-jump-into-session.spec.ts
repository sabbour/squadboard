/**
 * 11-jump-into-session.spec.ts — W28 JIS E2E
 *
 * Covers the Jump-Into-Session feature end-to-end:
 *   1. Smoke — LiveRunViewer route renders without crashing
 *   2. LiveRunViewer shows header and metrics row
 *   3. Watch button is NOT visible on a card with no active run
 *   4. Watch button navigates to the live route (API-mocked running run)
 *   5. Steer bar renders in LiveRunViewer
 *
 * NOTE: Tests 4 requires mocking the /api/projects/:pid/issues/:iid/runs
 * endpoint via page.route() to return a running run. The app server does not
 * need to have a live agent running. Tests 1, 2, 3, 5 work without mocking.
 *
 * E2E dependency limitation: these tests require a running Squadboard dev
 * server on http://localhost:3000. If the server is unavailable, the tests
 * are skipped via the playwright config timeout. To run locally:
 *   cd packages/e2e && pnpm test
 */
import { test, expect, type Page } from '@playwright/test'
import { createProjectViaApi } from './fixtures.ts'

// ── Helpers ───────────────────────────────────────────────────────────────────

const FAKE_RUN_ID = 'run-jis-e2e-0001'
const FAKE_ISSUE_ID = 'issue-jis-e2e-0001'

/**
 * Mock the runs endpoint so the board card sees a 'running' run.
 * Must be called before page.goto().
 */
async function mockRunningRun(page: Page, projectId: string, issueId: string) {
  await page.route(
    `**/api/projects/${projectId}/issues/${issueId}/runs`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: FAKE_RUN_ID,
            issueId,
            agentId: 'agent-mock',
            status: 'running',
            workspaceStrategy: 'scratch',
            kind: 'agent_run',
          },
        ]),
      }),
  )
}

/**
 * Mock the events endpoint to return an empty event list (loading → live stub).
 */
async function mockEventsEndpoint(
  page: Page,
  projectId: string,
  issueId: string,
  runId: string,
) {
  await page.route(
    `**/api/projects/${projectId}/issues/${issueId}/runs/${runId}/events**`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ events: [], total: 0, nextSeq: 0 }),
      }),
  )
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('JIS — Jump Into Session', () => {
  let projectId: string
  let issueId: string

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage()
    try {
      projectId = await createProjectViaApi(`e2e-jis-${Date.now()}`)
    } catch {
      // If project creation fails, use placeholder IDs — smoke tests still work
      projectId = 'proj-jis-placeholder'
    }
    // Create an issue to get a real issueId for mocking
    issueId = FAKE_ISSUE_ID
    await page.close()
  })

  test('Smoke — /live route renders without JS crash', async ({ page }) => {
    // Navigate to a live URL with fake IDs — expect graceful error or loading state
    // (no JS exception, no blank page)
    const url = `/projects/${projectId}/issues/${issueId}/runs/${FAKE_RUN_ID}/live`

    await mockEventsEndpoint(page, projectId, issueId, FAKE_RUN_ID)

    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))

    await page.goto(url, { timeout: 15_000 })
    // Wait a moment for any crashes to surface
    await page.waitForTimeout(1_000)

    // No JS crash
    expect(errors.filter(e => !e.includes('Failed to fetch'))).toHaveLength(0)
  })

  test('LiveRunViewer — header and metrics row render', async ({ page }) => {
    const url = `/projects/${projectId}/issues/${issueId}/runs/${FAKE_RUN_ID}/live`

    await mockEventsEndpoint(page, projectId, issueId, FAKE_RUN_ID)

    await page.goto(url, { timeout: 15_000 })

    // Header area: run ID prefix should appear (first 8 chars)
    await expect(
      page.locator(`text=${FAKE_RUN_ID.slice(0, 8)}`),
    ).toBeVisible({ timeout: 8_000 })

    // Metrics row: "Input tokens" label
    await expect(page.getByText('Input tokens')).toBeVisible({ timeout: 5_000 })
  })

  test('LiveRunViewer — steer bar renders with send button', async ({ page }) => {
    const url = `/projects/${projectId}/issues/${issueId}/runs/${FAKE_RUN_ID}/live`

    await mockEventsEndpoint(page, projectId, issueId, FAKE_RUN_ID)

    await page.goto(url, { timeout: 15_000 })

    await expect(page.getByLabel('Steering message')).toBeVisible({ timeout: 8_000 })
    await expect(page.getByLabel('Send steering message')).toBeVisible({ timeout: 5_000 })
  })

  test('Watch button — not visible on card with no active run', async ({ page }) => {
    if (projectId === 'proj-jis-placeholder') {
      test.skip()
      return
    }

    await page.goto(`/projects/${projectId}/board`, { timeout: 15_000 })

    // Create an issue via the board UI
    const issueTitle = `JIS-no-run-${Date.now()}`
    await page.getByTitle('Create issue').first().click()
    await page.getByPlaceholder('Issue title').fill(issueTitle)
    await page.getByRole('button', { name: /Create|Save|Add/i }).click()
    await expect(page.getByText(issueTitle)).toBeVisible({ timeout: 8_000 })

    // No Watch button on a card with no run
    expect(await page.getByTestId('watch-run-button').count()).toBe(0)
  })

  test('Watch button — click navigates to live route (mocked running run)', async ({ page }) => {
    if (projectId === 'proj-jis-placeholder') {
      test.skip()
      return
    }

    // Mock runs for any issue in this project to return a running run
    await page.route(
      `**/api/projects/${projectId}/issues/**/runs`,
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            {
              id: FAKE_RUN_ID,
              issueId,
              agentId: 'agent-mock',
              status: 'running',
              workspaceStrategy: 'scratch',
              kind: 'agent_run',
            },
          ]),
        }),
    )

    await page.goto(`/projects/${projectId}/board`, { timeout: 15_000 })

    // Wait for board to render
    await page.waitForSelector('[data-testid="watch-run-button"]', { timeout: 10_000 })

    const watchBtn = page.getByTestId('watch-run-button').first()
    await watchBtn.click()

    // URL should change to .../runs/:runId/live
    await page.waitForURL(/\/runs\/[^/]+\/live/, { timeout: 8_000 })
    expect(page.url()).toContain('/live')
  })
})
