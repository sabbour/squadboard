import { test, expect, type Page } from '@playwright/test'
import path from 'node:path'
import fs from 'node:fs/promises'
import {
  API_BASE,
  createInboxItemViaApi,
  createIssueViaApi,
  createProjectViaApi,
} from './fixtures.ts'

const repoRoot = process.cwd().endsWith(`${path.sep}packages${path.sep}e2e`)
  ? path.resolve(process.cwd(), '../..')
  : process.cwd()
const screenshotDir = path.join(repoRoot, 'packages/docs-site/static/img/scenarios')

async function prepareDocsPage(page: Page) {
  await page.setViewportSize({ width: 1680, height: 1000 })
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' })
}

async function docsScreenshot(page: Page, name: string) {
  await fs.mkdir(screenshotDir, { recursive: true })
  await page.screenshot({
    path: path.join(screenshotDir, name),
    fullPage: true,
    animations: 'disabled',
  })
}

async function createAgentViaApi(projectId: string, agent: {
  name: string
  role: string
  expertise: string[]
}) {
  const { request } = await import('@playwright/test')
  const ctx = await request.newContext({ baseURL: API_BASE })
  const res = await ctx.post(`/api/projects/${projectId}/agents`, { data: agent })
  if (!res.ok() && res.status() !== 409) {
    throw new Error(`createAgentViaApi: ${res.status()}: ${await res.text()}`)
  }
  await ctx.dispose()
}

async function createCeremonyViaApi(projectId: string) {
  const { request } = await import('@playwright/test')
  const ctx = await request.newContext({ baseURL: API_BASE })
  const yamlContent = [
    'name: "Spark Launch Review"',
    'description: "Review the launch checklist, collect blockers, and record the next handoff."',
    'steps:',
    '  - type: route',
    '    label: "Pick launch owner"',
    '    prompt: "Pick the best launch owner from the Spark team."',
    '  - type: agent_run',
    '    label: "Summarize launch risk"',
    '    prompt: |',
    '      Review the Spark launch board and summarize blockers, owners, and next actions.',
    '  - type: approve',
    '    label: "Approve launch handoff"',
    '    approvers: [lead]',
  ].join('\n')
  const res = await ctx.post(`/api/projects/${projectId}/ceremonies`, {
    data: {
      yamlContent,
      triggerKind: 'manual',
      triggerConfig: {},
      kind: 'ceremony',
    },
  })
  if (!res.ok() && res.status() !== 409) {
    throw new Error(`createCeremonyViaApi: ${res.status()}: ${await res.text()}`)
  }
  await ctx.dispose()
}

async function waitForIssueRun(projectId: string, issueId: string) {
  const { request } = await import('@playwright/test')
  const ctx = await request.newContext({ baseURL: API_BASE })
  await expect.poll(async () => {
    const res = await ctx.get(`/api/projects/${projectId}/issues/${issueId}/runs`)
    if (!res.ok()) return 0
    const runs = await res.json() as unknown[]
    return runs.length
  }, {
    message: 'Ready pickup should create an issue run',
    timeout: 15_000,
  }).toBeGreaterThan(0)
  await ctx.dispose()
}

test.describe.serial('Docs scenario screenshots', () => {
  let projectId: string
  let readyIssueId: string
  const projectName = 'Spark'

  test.beforeAll(async () => {
    projectId = await createProjectViaApi(projectName)
    await createAgentViaApi(projectId, {
      name: 'lina-chen',
      role: 'Launch lead',
      expertise: ['release planning', 'customer-facing messaging', 'risk triage'],
    })
    await createAgentViaApi(projectId, {
      name: 'omar-reyes',
      role: 'Integration engineer',
      expertise: ['MCP configuration', 'GitHub automation', 'import validation'],
    })
    await createCeremonyViaApi(projectId)
    await createIssueViaApi(projectId, {
      title: 'Draft Spark launch checklist',
      body: [
        '## Launch story',
        'Spark needs a clean first launch wave with a small project team, a reusable operating model, and a visible handoff path.',
        '',
        '## Notes',
        '- Keep coordinator decisions auditable.',
        '- Capture ambiguous work in the inbox first.',
        '- Review imported ceremonies before routing work.',
      ].join('\n'),
      status: 'backlog',
      idempotencyKey: 'docs-spark-launch-checklist',
    })
    readyIssueId = await createIssueViaApi(projectId, {
      title: 'Validate Squad App import path',
      body: 'Confirm templates, agents, ceremonies, skills, tools, MCP servers, and seed issues import cleanly.',
      status: 'ready',
      idempotencyKey: 'docs-spark-import-path',
    })
    await createIssueViaApi(projectId, {
      title: 'Prepare launch-readiness review',
      body: 'Summarize open risks, review policy, and handoff notes before the first automated run.',
      status: 'in_review',
      idempotencyKey: 'docs-spark-launch-readiness',
    })
    await createInboxItemViaApi({
      originalDraft: 'Spark needs a short launch note explaining how Squadboard works with upstream Squad and where imports live.',
      suggestedProjectId: projectId,
      idempotencyKey: 'docs-spark-launch-note',
    })
  })

  test('captures project entry points', async ({ page }) => {
    await prepareDocsPage(page)
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible()
    await expect(page.getByText(projectName).first()).toBeVisible({ timeout: 10_000 })
    await docsScreenshot(page, 'spark-01-projects.png')

    await page.goto(`/projects/${projectId}/dashboard`)
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 10_000 })
    await docsScreenshot(page, 'spark-02-dashboard.png')
  })

  test('captures board planning', async ({ page }) => {
    await prepareDocsPage(page)
    await page.goto(`/projects/${projectId}/board`)
    await expect(page.getByText('Draft Spark launch checklist')).toBeVisible({ timeout: 10_000 })
    await docsScreenshot(page, 'spark-03-board-plan.png')

    await waitForIssueRun(projectId, readyIssueId)
    await page.reload()
    await expect(page.getByText('Validate Squad App import path')).toBeVisible({ timeout: 10_000 })
    await docsScreenshot(page, 'spark-19-ready-pickup.png')

    await page.getByText('Validate Squad App import path').first().click()
    await expect(page.getByText('Active Run')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('Default plan: Work Pickup')).toBeVisible()
    await docsScreenshot(page, 'spark-20-run-detail.png')
    await page.mouse.click(20, 20)

    await page.getByTitle('Create issue').first().click()
    await expect(page.getByText('New Issue')).toBeVisible()
    await page.getByPlaceholder('Issue title').fill('Publish Spark launch note')
    await page.getByPlaceholder('Describe the issue… (Markdown supported)').fill('Draft the short launch note, explain how Squadboard and upstream Squad work together, and link the import guide.')
    await docsScreenshot(page, 'spark-04-new-card.png')

    const title = 'Publish Spark launch note'
    await page.getByRole('button', { name: /^Create Issue$/i }).click()
    await expect(page.getByText(title)).toBeVisible({ timeout: 10_000 })
    await docsScreenshot(page, 'spark-05-board-after-create.png')
  })

  test('captures team and consult flows', async ({ page }) => {
    await prepareDocsPage(page)
    await page.goto(`/projects/${projectId}/agents`)
    await expect(page.getByText('Lina Chen')).toBeVisible({ timeout: 10_000 })
    await docsScreenshot(page, 'spark-06-agents.png')

    await page.waitForLoadState('networkidle')
    await page.getByRole('button', { name: /Cast Team/i }).click()
    await expect(page.getByText('Cast a team')).toBeVisible({ timeout: 8_000 })
    await docsScreenshot(page, 'spark-07-team-casting.png')

    await page.goto(`/projects/${projectId}/consult/new`)
    await page.getByRole('button', { name: 'Model' }).click()
    await expect(page.getByText('New consult')).toBeVisible()
    await expect(page.getByText(/Brainstorm with a project agent or a raw model/)).toBeVisible()
    await docsScreenshot(page, 'spark-08-consult.png')
  })

  test('captures imports and ceremonies', async ({ page }) => {
    await prepareDocsPage(page)
    await page.goto(`/projects/${projectId}/ceremonies/templates?tab=ceremonies`)
    await expect(page.getByRole('heading', { name: 'Templates' })).toBeVisible({ timeout: 10_000 })
    await docsScreenshot(page, 'spark-09-templates-ceremonies.png')

    await page.goto(`/projects/${projectId}/ceremonies/templates?tab=projects`)
    await expect(page.getByRole('heading', { name: 'Templates' })).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('tab', { name: 'Projects' })).toBeVisible()
    await docsScreenshot(page, 'spark-10-templates-projects.png')

    await page.goto(`/projects/${projectId}/ceremonies`)
    await expect(page.getByRole('heading', { name: 'Ceremonies' })).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('Spark Launch Review')).toBeVisible()
    await docsScreenshot(page, 'spark-11-ceremonies.png')
  })

  test('captures inbox and MCP setup', async ({ page }) => {
    await prepareDocsPage(page)
    await page.goto(`/projects/${projectId}/inbox`)
    await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText(/Spark needs a short launch note/).first()).toBeVisible()
    await docsScreenshot(page, 'spark-12-inbox.png')

    await page.goto(`/projects/${projectId}/mcp-servers`)
    await expect(page.getByRole('heading', { name: 'MCP Servers' })).toBeVisible({ timeout: 10_000 })
    await docsScreenshot(page, 'spark-13-mcp-list.png')

    await page.getByRole('button', { name: 'New MCP server' }).click()
    await expect(page.getByRole('heading', { name: 'New MCP server' })).toBeVisible()
    await page.getByPlaceholder('e.g. GitHub MCP').fill('Spark docs MCP')
    await page.getByPlaceholder('https://api.example.com/mcp/').fill('https://example.invalid/mcp')
    await docsScreenshot(page, 'spark-14-mcp-dialog.png')
  })

  test('captures settings and cost controls', async ({ page }) => {
    await prepareDocsPage(page)
    await page.goto(`/projects/${projectId}/settings`)
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({ timeout: 10_000 })
    await docsScreenshot(page, 'spark-15-settings-general.png')

    await page.getByRole('button', { name: 'Portability' }).click()
    await expect(page.getByRole('button', { name: 'Save as template' })).toBeVisible()
    await docsScreenshot(page, 'spark-16-settings-portability.png')

    await page.getByRole('button', { name: 'GitHub' }).click()
    await expect(page.getByText('GitHub Integration')).toBeVisible()
    await docsScreenshot(page, 'spark-17-settings-github.png')

    await page.goto(`/projects/${projectId}/costs`)
    await expect(page.getByRole('heading', { name: 'Costs' })).toBeVisible({ timeout: 10_000 })
    await docsScreenshot(page, 'spark-18-costs.png')
  })
})
