/**
 * Demo recording scenarios for README and marketing assets.
 *
 * Run:    cd packages/e2e && pnpm demo:record
 * Output: packages/e2e/demo-results/
 *
 * The command kills any stale dev servers, wipes .demo-home for a clean
 * PGLite database, seeds "Squadboard" and "Contoso" projects, then records.
 *
 * Convert a captured video to GIF:
 *   ffmpeg -i video.webm -vf "fps=10,scale=1920:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" demo.gif
 *
 * For higher-quality GIFs, prefer gifski:
 *   gifski --fps 15 --quality 90 -o demo.gif video.webm
 */
import { test, expect, request, type Page, type TestInfo } from '@playwright/test'
import {
  API_BASE,
  createE2eProjectParent,
  createIssueViaApi,
  createProjectViaApiDetails,
} from './fixtures.ts'

test.describe.configure({ mode: 'serial' })
// Resolution, video, screenshot, and slowMo are all set in playwright.demo.config.ts.
// This file only contains test logic.

// Seeded project IDs — populated once in beforeAll and shared across all scenarios.
let squadboardProjectId = ''
// eslint-disable-next-line @typescript-eslint/no-unused-vars
let contosoProjectId = ''

interface CeremonyRow {
  id: string
  name: string
  kind: string
  status: string
  triggerKind?: string
}

interface MockRunOptions {
  ceremonyId: string
  ceremonyName: string
  issueId: string
  issueTitle: string
  runId: string
  issueRunStatus: 'running' | 'completed' | 'failed' | 'cancelled' | 'pending'
  workflowStatus: 'running' | 'completed' | 'failed' | 'cancelled' | 'pending'
}

const DEMO_REPO_URL = 'https://github.com/sabbour/squadboard-apps'
const DEMO_APP_PATH = 'squad-doc-review'
const DEMO_ISSUE_TITLE = 'Polish the README demo story'

// Seed the two demo projects before any scenario runs.
// The demo config starts a fresh PGLite DB, so the board is empty until we do this.
test.beforeAll(async () => {
  const sq = await createProjectViaApiDetails('Squadboard')
  const co = await createProjectViaApiDetails('Contoso')
  squadboardProjectId = sq.projectId
  contosoProjectId = co.projectId
})

async function pause(page: Page, ms = 900) {
  await page.waitForTimeout(ms)
}

async function capture(page: Page, testInfo: TestInfo, name: string) {
  await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: false })
}

async function createCeremony(
  projectId: string,
  name: string,
  yamlContent = [
    `name: ${name}`,
    'trigger: manual',
    'steps:',
    '  - type: agent_run',
    '    agent: Squad',
    '    prompt: |',
    '      Review the board and summarise the next best action in one sentence.',
  ].join('\n'),
): Promise<CeremonyRow> {
  const ctx = await request.newContext({ baseURL: API_BASE })
  try {
    const res = await ctx.post(`/api/projects/${projectId}/ceremonies`, {
      data: { name, kind: 'ceremony', triggerKind: 'manual', yamlContent },
    })
    const text = await res.text()
    expect(res.status(), text).toBeLessThan(300)
    const body = JSON.parse(text) as { ceremony?: CeremonyRow } & CeremonyRow
    return body.ceremony ?? body
  } finally {
    await ctx.dispose()
  }
}

async function activateCeremony(projectId: string, ceremonyId: string) {
  const ctx = await request.newContext({ baseURL: API_BASE })
  try {
    const res = await ctx.post(`/api/projects/${projectId}/ceremonies/${ceremonyId}/activate`)
    const text = await res.text()
    expect(res.status(), text).toBeLessThan(300)
  } finally {
    await ctx.dispose()
  }
}

async function mockCeremonyRun(page: Page, projectId: string, options: MockRunOptions) {
  const now = new Date().toISOString()

  await page.route(`**/api/projects/${projectId}/ceremonies/${options.ceremonyId}/run`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ workflowRunId: options.runId, message: 'Demo run started.' }),
    })
  })

  await page.route(`**/api/projects/${projectId}/ceremonies/${options.ceremonyId}/runs**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ceremony: {
          id: options.ceremonyId,
          projectId,
          name: options.ceremonyName,
          slug: options.ceremonyName.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
          triggerKind: 'manual',
          kind: 'ceremony',
        },
        versions: [{ id: 'version-demo-1', version: 1, createdAt: now }],
        runs: [
          {
            id: options.runId,
            issueId: options.issueId,
            issueTitle: options.issueTitle,
            issueStatus: 'in_progress',
            workflowVersionId: 'version-demo-1',
            workflowVersionNumber: 1,
            status: options.workflowStatus,
            currentStepIndex: options.workflowStatus === 'completed' ? 1 : 0,
            triggerSource: { kind: 'manual' },
            premiumRequests: '0',
            createdAt: now,
            updatedAt: now,
            steps: [
              {
                id: 'demo-step-1',
                workflowRunId: options.runId,
                issueRunId: options.runId,
                stepIndex: 0,
                stepType: 'agent_run',
                status: options.workflowStatus,
                output: null,
                reviewDecision: null,
                reviewComment: null,
                sessionId: null,
                startedAt: now,
                createdAt: now,
                updatedAt: now,
                issueRunStatus: options.issueRunStatus,
                issueRunOutput: options.issueRunStatus === 'completed' ? 'Reviewed backlog and suggested the next action.' : null,
                issueRunError: null,
                agentId: 'agent-squad',
                agentName: 'Squad',
                events: [],
              },
              {
                id: 'demo-step-2',
                workflowRunId: options.runId,
                issueRunId: null,
                stepIndex: 1,
                stepType: 'approve',
                status: options.workflowStatus === 'completed' ? 'completed' : 'pending',
                output: options.workflowStatus === 'completed' ? 'Approved for landing page use.' : null,
                reviewDecision: options.workflowStatus === 'completed' ? 'approved' : null,
                reviewComment: options.workflowStatus === 'completed' ? 'Looks good for the README.' : null,
                sessionId: null,
                startedAt: options.workflowStatus === 'completed' ? now : null,
                createdAt: now,
                updatedAt: now,
                issueRunStatus: null,
                issueRunOutput: null,
                issueRunError: null,
                agentId: null,
                agentName: null,
                events: [],
              },
            ],
          },
        ],
      }),
    })
  })
}

function makeLiveEventsResponse(runId: string, issueId: string, status: 'running' | 'completed') {
  const startedAt = '2026-05-21T18:00:00.000Z'
  const finishedAt = '2026-05-21T18:00:12.000Z'
  const events = [
    {
      id: 'evt-1',
      runId,
      seq: 0,
      eventType: 'issue.run.start',
      payload: { runId, issueId, agentName: 'Squad', model: 'claude-sonnet-4.6' },
      createdAt: startedAt,
    },
    {
      id: 'evt-2',
      runId,
      seq: 1,
      eventType: 'issue.run.turn',
      payload: {
        runId,
        issueId,
        role: 'assistant',
        content: 'Inspecting the board and identifying the highest-impact work item.',
      },
      createdAt: '2026-05-21T18:00:03.000Z',
    },
    {
      id: 'evt-3',
      runId,
      seq: 2,
      eventType: 'issue.run.token',
      payload: { runId, issueId, inputTokens: 182, outputTokens: 94, cost: 0.0123 },
      createdAt: '2026-05-21T18:00:05.000Z',
    },
    {
      id: 'evt-4',
      runId,
      seq: 3,
      eventType: 'issue.run.tool_call',
      payload: { runId, issueId, toolName: 'board.summary', command: 'Summarise board state' },
      createdAt: '2026-05-21T18:00:06.000Z',
    },
    {
      id: 'evt-5',
      runId,
      seq: 4,
      eventType: 'issue.run.tool_result',
      payload: { runId, issueId, toolName: 'board.summary', output: '1 card ready for review, 2 in backlog.' },
      createdAt: '2026-05-21T18:00:07.000Z',
    },
  ]

  if (status === 'completed') {
    events.push({
      id: 'evt-6',
      runId,
      seq: 5,
      eventType: 'issue.run.finish',
      payload: {
        runId,
        issueId,
        durationMs: 12000,
        output: 'Recommend starting with the README demo recording follow-up.',
      },
      createdAt: finishedAt,
    })
  }

  return {
    run: {
      id: runId,
      issueId,
      agentId: 'agent-squad',
      kind: 'agent_run',
      status,
      workspaceStrategy: 'scratch',
      workspacePath: null,
      createdAt: startedAt,
      updatedAt: status === 'completed' ? finishedAt : '2026-05-21T18:00:08.000Z',
      startedAt,
      completedAt: status === 'completed' ? finishedAt : null,
      finishedAt: status === 'completed' ? finishedAt : null,
      leaseExpiresAt: null,
      heartbeatAt: '2026-05-21T18:00:08.000Z',
      durationMs: status === 'completed' ? 12000 : null,
      costTokens: 276,
      inputTokens: 182,
      outputTokens: 94,
      cachedInputTokens: 0,
      costUsd: '0.0123',
      premiumRequests: '0',
      output: { available: status === 'completed', length: status === 'completed' ? 58 : 0 },
      errorMessage: null,
      staleReason: null,
      recovery: null,
    },
    events,
    total: events.length,
    nextSeq: events.length,
  }
}

async function mockLiveRunResponses(page: Page, projectId: string, issueId: string, runId: string) {
  let callCount = 0
  await page.route(`**/api/projects/${projectId}/issues/${issueId}/runs/${runId}/events**`, async (route) => {
    callCount += 1
    const body = callCount === 1
      ? makeLiveEventsResponse(runId, issueId, 'running')
      : makeLiveEventsResponse(runId, issueId, 'completed')

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    })
  })
}

test('Scenario A — First run', async ({ page }, testInfo) => {
  const cardTitle = 'Welcome to Squadboard'
  const parentPath = await createE2eProjectParent('demo-first-run')

  // Show the home page — Squadboard and Contoso are already seeded.
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible()
  await expect(page.getByText('Squadboard', { exact: true })).toBeVisible()
  await expect(page.getByText('Contoso', { exact: true })).toBeVisible()
  await pause(page)
  await capture(page, testInfo, 'first-run-00-projects-home')

  // Create a third project to demonstrate the first-run board experience.
  await page.getByRole('button', { name: 'Add Project' }).click()
  const createTab = page.getByRole('button', { name: /Create/i }).first()
  await expect(createTab).toBeVisible()
  await createTab.click()
  await capture(page, testInfo, 'first-run-01-project-picker')

  await page.getByPlaceholder('/absolute/path/to/parent').fill(parentPath)
  await page.getByPlaceholder('my-new-project').fill('My New Project')
  await pause(page)
  await capture(page, testInfo, 'first-run-02-create-project')

  await page.getByRole('button', { name: 'Create project' }).click()
  await page.waitForURL(/\/projects\/[^/]+\/board/, { timeout: 15_000 })
  await expect(page.getByText('Backlog')).toBeVisible()
  await pause(page)
  await capture(page, testInfo, 'first-run-03-empty-board')

  await page.getByTitle('Create issue').first().click()
  await page.getByPlaceholder('Issue title').fill(cardTitle)
  await pause(page)
  await capture(page, testInfo, 'first-run-04-new-card')

  await page.getByRole('button', { name: /Create Issue/i }).click()
  await expect(page.getByText(cardTitle)).toBeVisible({ timeout: 8_000 })
  await pause(page)
  await capture(page, testInfo, 'first-run-05-card-on-board')
})

test('Scenario B — Connect a repo', async ({ page }, testInfo) => {
  const projectPath = await createE2eProjectParent('demo-app-install')

  // Current repo-connection UX lives in Apps > Install from GitHub.
  await page.goto('/apps')
  await expect(page.getByRole('heading', { name: 'Squadboard Apps' })).toBeVisible({ timeout: 10_000 })
  await expect(page.getByRole('heading', { name: 'Install from GitHub' })).toBeVisible()
  await pause(page)
  await capture(page, testInfo, 'repo-connect-01-apps-home')

  await page.getByLabel('GitHub repository URL').fill(DEMO_REPO_URL)
  await page.getByLabel('App folder').fill(DEMO_APP_PATH)
  await page.getByLabel('Project name').fill('README Demo App')
  await page.getByLabel('Absolute project folder or .squad path').fill(projectPath)
  await pause(page)
  const installSection = page.locator('section', { has: page.getByRole('heading', { name: 'Install from GitHub' }) })
  await expect(installSection.getByRole('button', { name: 'Install as project' })).toBeEnabled()
  await capture(page, testInfo, 'repo-connect-02-filled-form')

  await expect(installSection.getByText(/creates a normal project/i)).toBeVisible()
  await expect(installSection.getByText(/Only install Squadboard Apps from sources you trust/i)).toBeVisible()
  await capture(page, testInfo, 'repo-connect-03-install-ready')
})

test('Scenario C — Run a ceremony', async ({ page }, testInfo) => {
  // Use the seeded Squadboard project — no random temp projects.
  const issueId = await createIssueViaApi(squadboardProjectId, {
    title: DEMO_ISSUE_TITLE,
    body: 'Create marketing-friendly product proof points for the README.',
    status: 'in_progress',
  })
  const ceremony = await createCeremony(squadboardProjectId, 'Demo Code Review')
  const runId = 'demo-workflow-run-001'

  await activateCeremony(squadboardProjectId, ceremony.id)
  await mockCeremonyRun(page, squadboardProjectId, {
    ceremonyId: ceremony.id,
    ceremonyName: ceremony.name,
    issueId,
    issueTitle: DEMO_ISSUE_TITLE,
    runId,
    issueRunStatus: 'running',
    workflowStatus: 'running',
  })
  await mockLiveRunResponses(page, squadboardProjectId, issueId, runId)

  await page.goto(`/projects/${squadboardProjectId}/ceremonies`)
  await expect(page.getByRole('heading', { name: 'Ceremonies' })).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText(ceremony.name)).toBeVisible()
  await pause(page)
  await capture(page, testInfo, 'ceremony-01-list')

  await page.getByText(ceremony.name).click()
  await expect(page.getByRole('button', { name: 'Run now' })).toBeVisible({ timeout: 10_000 })
  await pause(page)
  await capture(page, testInfo, 'ceremony-02-editor')

  await page.getByRole('button', { name: 'Run now' }).click()
  await page.waitForURL(new RegExp(`/projects/${squadboardProjectId}/ceremonies/${ceremony.id}/runs\\?run=${runId}`), {
    timeout: 10_000,
  })
  await expect(page.getByText('Manual run')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText(/Step 1: agent_run/i)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Open live log' })).toBeVisible()
  await pause(page)
  await capture(page, testInfo, 'ceremony-03-runs-view')

  await page.getByRole('button', { name: 'Open live log' }).click()
  await page.waitForURL(/\/runs\/[^/]+\/live/, { timeout: 10_000 })
  await expect(page.getByRole('log', { name: 'Run event stream' })).toBeVisible({ timeout: 10_000 })
  await pause(page)
  await capture(page, testInfo, 'ceremony-04-live-log')
})

test('Scenario D — Live run tracking', async ({ page }, testInfo) => {
  // Use the seeded Squadboard project — no random temp projects.
  const issueId = await createIssueViaApi(squadboardProjectId, {
    title: 'Track live README polishing run',
    body: 'Show a realistic run transcript for README video capture.',
    status: 'in_progress',
  })
  const runId = 'demo-live-run-001'

  await mockLiveRunResponses(page, squadboardProjectId, issueId, runId)

  await page.goto(`/projects/${squadboardProjectId}/issues/${issueId}/runs/${runId}/live`)
  await expect(page.getByText('Input tokens')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByRole('log', { name: 'Run event stream' })).toBeVisible()
  await expect(page.getByText('Running')).toBeVisible()
  await pause(page)
  await capture(page, testInfo, 'live-run-01-running')

  await page.reload()
  await expect(page.getByText('Completed')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText(/Recommend starting with the README demo recording follow-up/i)).toBeVisible()
  await pause(page)
  await capture(page, testInfo, 'live-run-02-completed')
})
