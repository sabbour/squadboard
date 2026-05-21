/**
 * Demo recording scenarios for README and marketing assets.
 *
 * Run:    pnpm demo:record          (from repo root or packages/e2e)
 * Output: packages/e2e/demo-results/
 *
 * Scenario A.1 — Cast a team and plan the first card
 *   Home → board with Default Software Project columns → Agents → Cast Team (real LLM)
 *   → Add card to Backlog
 *
 * Scenario A.2 — Board in action (end-to-end ceremony chain)
 *   Card → Ready → Work Pickup auto-fires → agent works → card auto-moves to In Review
 *   → Simple Review ceremony auto-fires → Lead reviews → Lead approves (peer review run)
 *   → card moves to Done → Scribe (wave.closeout) fires
 *
 * Scenario B — Onboard an existing Squad project
 *   Home → Add Project → Connect existing → settings → MCP Config / Connect Copilot
 *
 * No mocks. Every LLM call (Cast Team, Work Pickup coordinator, agent runs,
 * Review ceremony, Scribe) is real.
 */
import { test, expect, request, type Page, type TestInfo } from '@playwright/test'
import {
  API_BASE,
  createE2eProjectParent,
  createProjectViaApiDetails,
} from './fixtures.ts'

test.describe.configure({ mode: 'serial' })

// ── Shared state across serial scenarios ────────────────────────────────────
let squadboardProjectId = ''
let contosoProjectId    = ''
let newProjectId        = ''   // Default Software Project (A.1 → A.2)
let demoCardId          = ''   // Card created in A.1, moved to Ready in A.2

const DEMO_CARD_TITLE = 'Draft the product roadmap'

// ── Seed backdrop projects ───────────────────────────────────────────────────
test.beforeAll(async () => {
  const sq = await createProjectViaApiDetails('Squadboard')
  const co = await createProjectViaApiDetails('Contoso')
  squadboardProjectId = sq.projectId
  contosoProjectId    = co.projectId
})

// ── Helpers ──────────────────────────────────────────────────────────────────
async function pause(page: Page, ms = 900) {
  await page.waitForTimeout(ms)
}

async function capture(page: Page, testInfo: TestInfo, name: string) {
  await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: false })
}

/** Apply the Default Software Project bundle template via API and return the new projectId. */
async function createTemplateProject(name: string): Promise<string> {
  const pathMod  = await import('node:path')
  const parentPath = await createE2eProjectParent(name)
  const squadPath  = pathMod.join(parentPath, name, '.squad')

  const ctx = await request.newContext({ baseURL: API_BASE })
  try {
    const res  = await ctx.post('/api/templates/builtin-projects/default-software-project/apply', {
      data: { squadPath, name },
    })
    const text = await res.text()
    if (!res.ok()) throw new Error(`Template apply failed (${res.status()}): ${text}`)
    const body = JSON.parse(text) as { ok: boolean; data: { project: { id: string } } }
    return body.data.project.id
  } finally {
    await ctx.dispose()
  }
}

// ── Scenario A.1 — Cast a team and add the first card ───────────────────────
test('Scenario A.1 — Cast a team and add the first card', async ({ page }, testInfo) => {
  // Create a fresh project from the Default Software Project template (columns + ceremonies pre-wired)
  newProjectId = await createTemplateProject('My New Project')

  // Home — three projects visible
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible()
  await expect(page.getByText('Squadboard', { exact: true })).toBeVisible()
  await expect(page.getByText('Contoso',    { exact: true })).toBeVisible()
  await expect(page.getByText('My New Project', { exact: true })).toBeVisible()
  await pause(page)
  await capture(page, testInfo, 'a1-00-home')

  // Navigate to board — show all 5 default columns
  await page.goto(`/projects/${newProjectId}/board`)
  await expect(page.getByText('Backlog').first()).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('Ready').first()).toBeVisible()
  await expect(page.getByText('In Progress').first()).toBeVisible()
  await expect(page.getByText('In Review').first()).toBeVisible()
  await expect(page.getByText('Done').first()).toBeVisible()
  await pause(page)
  await capture(page, testInfo, 'a1-01-board-columns')

  // Agents page — empty before cast
  await page.goto(`/projects/${newProjectId}/agents`)
  await expect(
    page.getByRole('heading', { name: 'Squad Members' })
      .or(page.getByRole('heading', { name: 'Agents' }))
  ).toBeVisible({ timeout: 10_000 })
  await pause(page)
  await capture(page, testInfo, 'a1-02-agents-empty')

  // Open Cast Team modal (page-level button)
  await page.getByRole('button', { name: /Cast Team/i }).first().click()
  const modal = page.getByRole('dialog')
  await expect(modal).toBeVisible({ timeout: 8_000 })
  await pause(page)
  await capture(page, testInfo, 'a1-03-cast-team-modal-open')

  // Submit the cast inside the modal (real LLM — coordinator proposes team)
  await modal.getByRole('button', { name: /Cast Team/i }).click()
  await expect(page.getByText('Cast complete', { exact: false })).toBeVisible({ timeout: 90_000 })
  await pause(page, 1200)
  await capture(page, testInfo, 'a1-04-cast-review')

  // Confirm the proposed team
  await modal.getByRole('button', { name: /Cast \d+ Agent/i }).click()
  await expect(page.getByText(/agents cast successfully/i)).toBeVisible({ timeout: 30_000 })
  await pause(page)
  await capture(page, testInfo, 'a1-05-cast-done')

  // Close dialog and show the cast agents
  const closeBtn = modal.getByRole('button', { name: /Close|Done|Dismiss/i }).first()
  if (await closeBtn.isVisible({ timeout: 2_000 }).catch(() => false)) await closeBtn.click()
  await pause(page)
  await capture(page, testInfo, 'a1-06-agents-cast')

  // Navigate back to board and add the first card to Backlog
  await page.goto(`/projects/${newProjectId}/board`)
  await expect(page.getByText('Backlog').first()).toBeVisible({ timeout: 10_000 })

  // Capture the new issue ID from the API response while clicking Create
  const [createResponse] = await Promise.all([
    page.waitForResponse(
      r => {
        const url = r.url()
        return (
          r.request().method() === 'POST' &&
          /\/api\/projects\/[^/]+\/issues$/.test(url)
        )
      },
      { timeout: 15_000 },
    ),
    (async () => {
      await page.getByTitle('Create issue').first().click()
      await page.getByPlaceholder('Issue title').fill(DEMO_CARD_TITLE)
      await pause(page)
      await capture(page, testInfo, 'a1-07-new-card')
      await page.getByRole('button', { name: /^Create Issue$/i }).click()
    })(),
  ])

  const createdIssue = await createResponse.json() as { id?: string }
  if (!createdIssue.id) throw new Error(`Card creation did not return an id: ${JSON.stringify(createdIssue)}`)
  demoCardId = createdIssue.id

  await expect(page.getByText(DEMO_CARD_TITLE)).toBeVisible({ timeout: 8_000 })
  await pause(page)
  await capture(page, testInfo, 'a1-08-card-in-backlog')
})

// ── Scenario A.2 — Board in action ──────────────────────────────────────────
test('Scenario A.2 — Board in action', async ({ page }, testInfo) => {
  // Show card in Backlog
  await page.goto(`/projects/${newProjectId}/board`)
  await expect(page.getByText(DEMO_CARD_TITLE)).toBeVisible({ timeout: 10_000 })
  await pause(page)
  await capture(page, testInfo, 'a2-00-card-in-backlog')

  // Move card to Ready via API — Work Pickup will auto-fire within 30 s
  const ctx = await request.newContext({ baseURL: API_BASE })
  const moveRes = await ctx.patch(`/api/projects/${newProjectId}/issues/${demoCardId}/move`, {
    data: { status: 'ready' },
  })
  if (!moveRes.ok()) {
    const txt = await moveRes.text()
    throw new Error(`Move to ready failed (${moveRes.status()}): ${txt}`)
  }
  await ctx.dispose()

  await page.reload()
  await expect(page.getByText('Ready').first()).toBeVisible()
  await pause(page)
  await capture(page, testInfo, 'a2-01-card-in-ready')

  // Work Pickup assigns an agent — wait for the "Watch run" button (up to 90 s)
  const watchRunBtn = page.getByTestId('watch-run-button')
  await expect(watchRunBtn).toBeVisible({ timeout: 90_000 })
  await pause(page)
  await capture(page, testInfo, 'a2-02-run-assigned')

  // Follow the live run
  await watchRunBtn.click()
  await page.waitForURL(/\/runs\/[^/]+\/live/, { timeout: 15_000 })
  await expect(page.getByRole('log', { name: 'Run event stream' })).toBeVisible({ timeout: 10_000 })
  await pause(page)
  await capture(page, testInfo, 'a2-03-live-run-start')

  // Wait for the agent to finish its work (real LLM — generous timeout)
  await expect(page.getByText('Completed', { exact: false })).toBeVisible({ timeout: 300_000 })
  await pause(page, 1500)
  await capture(page, testInfo, 'a2-04-run-completed')

  // Card auto-moves to In Review after the run — show the board
  await page.goto(`/projects/${newProjectId}/board`)
  await expect(page.getByText('In Review').first()).toBeVisible({ timeout: 10_000 })
  await pause(page, 1500)
  await capture(page, testInfo, 'a2-05-board-in-review')

  // Simple Review ceremony auto-triggered on card entry into In Review
  // Navigate to ceremonies and wait for it to appear as active
  await page.goto(`/projects/${newProjectId}/ceremonies`)
  await expect(page.getByRole('heading', { name: 'Ceremonies' })).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('Simple Review')).toBeVisible({ timeout: 60_000 })
  await pause(page)
  await capture(page, testInfo, 'a2-06-review-ceremony-triggered')

  // Open the Simple Review ceremony
  await page.getByText('Simple Review').click()
  await pause(page, 1200)
  await capture(page, testInfo, 'a2-07-review-ceremony-detail')

  // Wait for the ceremony to complete — Lead's peer review run finishes (real LLM)
  await expect(page.getByText('Completed', { exact: false })).toBeVisible({ timeout: 300_000 })
  await pause(page, 1500)
  await capture(page, testInfo, 'a2-08-review-completed')

  // Move card to Done — triggers Scribe (wave.closeout) automatically
  const ctx2 = await request.newContext({ baseURL: API_BASE })
  await ctx2.patch(`/api/projects/${newProjectId}/issues/${demoCardId}/move`, {
    data: { status: 'done' },
  })
  await ctx2.dispose()

  await page.goto(`/projects/${newProjectId}/board`)
  await expect(page.getByText('Done').first()).toBeVisible({ timeout: 10_000 })
  await pause(page, 1500)
  await capture(page, testInfo, 'a2-09-card-done')

  // Scribe ceremony fires automatically — show it in the ceremonies list
  await page.goto(`/projects/${newProjectId}/ceremonies`)
  await expect(
    page.getByText('Scribe', { exact: false }).or(page.getByText('scribe', { exact: false }))
  ).toBeVisible({ timeout: 60_000 })
  await pause(page, 2000)
  await capture(page, testInfo, 'a2-10-scribe-triggered')
})

// ── Scenario B — Onboard an existing Squad project ──────────────────────────
test('Scenario B — Onboard an existing Squad project', async ({ page }, testInfo) => {
  // Create a local dir to represent an existing project (Connect existing will scaffold .squad/ into it)
  const parentPath   = await createE2eProjectParent('demo-connect')
  const projectFolder = `${parentPath}/my-squad-project`
  const fsMod = await import('node:fs/promises')
  await fsMod.mkdir(projectFolder, { recursive: true })

  // Show home
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible()
  await pause(page)
  await capture(page, testInfo, 'b-00-home')

  // Add Project → Connect existing tab
  await page.getByRole('button', { name: 'Add Project' }).click()
  const connectTab = page.getByRole('button', { name: /Connect existing/i })
  await expect(connectTab).toBeVisible({ timeout: 8_000 })
  await connectTab.click()
  await pause(page)
  await capture(page, testInfo, 'b-01-connect-tab')

  // Fill the project folder path
  await page.getByPlaceholder('/absolute/path/to/project').fill(projectFolder)
  await pause(page)
  await capture(page, testInfo, 'b-02-path-filled')

  // Connect — scaffolds .squad/ and navigates to the board
  await page.getByRole('button', { name: /Connect/i }).click()
  await page.waitForURL(/\/projects\/[^/]+\/board/, { timeout: 30_000 })
  await expect(page.getByText('Backlog').first()).toBeVisible({ timeout: 10_000 })
  await pause(page)
  await capture(page, testInfo, 'b-03-connected-board')

  // Navigate to Settings → MCP Config
  const connectedProjectId = page.url().match(/\/projects\/([^/]+)\//)?.[1] ?? ''
  await page.goto(`/projects/${connectedProjectId}/settings`)
  await expect(
    page.getByText(/MCP Config/i).first()
  ).toBeVisible({ timeout: 10_000 })
  await pause(page)
  await capture(page, testInfo, 'b-04-settings')

  // Show the "Connect Copilot CLI" button
  await expect(
    page.getByRole('button', { name: /Connect Copilot CLI/i })
      .or(page.getByText(/Connect Copilot CLI/i))
  ).toBeVisible({ timeout: 10_000 })
  await pause(page)
  await capture(page, testInfo, 'b-05-connect-copilot')
})
