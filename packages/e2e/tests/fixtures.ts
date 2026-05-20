/**
 * Shared helpers for Squadboard E2E tests.
 *
 * These are plain functions (not Playwright fixtures) that wrap common UI
 * journeys so individual spec files stay concise.
 */
import type { Page } from '@playwright/test'
import { request } from '@playwright/test'

export const API_BASE = process.env.SQUADBOARD_E2E_API_BASE ?? 'http://localhost:3000'
const runningFromE2ePackage = process.cwd().endsWith('/packages/e2e')
const defaultE2eRoot = runningFromE2ePackage ? process.cwd() : `${process.cwd()}/packages/e2e`
export const E2E_WORKSPACE_ROOT = process.env.SQUADBOARD_E2E_WORKSPACE_ROOT
  ?? `${defaultE2eRoot}/.e2e-workspaces`

export interface CreatedProjectViaApi {
  projectId: string
  projectName: string
  parentPath: string
  projectPath: string
  squadPath: string
}

function safeSegment(input: string): string {
  const cleaned = input.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return cleaned || 'project'
}

export async function createE2eProjectParent(label = 'project'): Promise<string> {
  const { randomUUID } = await import('node:crypto')
  const fs = await import('node:fs/promises')
  const path = await import('node:path')
  const parentPath = path.join(
    E2E_WORKSPACE_ROOT,
    `${safeSegment(label)}-${Date.now()}-${randomUUID().slice(0, 8)}`,
  )
  await fs.mkdir(parentPath, { recursive: true })
  return parentPath
}

export function workspacePath(...segments: string[]): string {
  return [E2E_WORKSPACE_ROOT, ...segments.map(safeSegment)].join('/')
}

/**
 * Create a new project directly via the REST API.
 *
 * Preferred over `createProject` on WSL/headless environments where the
 * Fluent-UI controlled inputs are unreliable with Playwright's fill().
 * Returns the project ID.
 */
export async function createProjectViaApiDetails(
  name: string,
  apiBase = API_BASE,
): Promise<CreatedProjectViaApi> {
  const ctx = await request.newContext({ baseURL: apiBase })
  const parentPath = await createE2eProjectParent(name)

  const res = await ctx.post('/api/squad/create', {
    data: { parentPath, projectName: name },
  })
  if (!res.ok()) {
    throw new Error(`createProjectViaApi: POST /api/squad/create returned ${res.status()}`)
  }
  const env = (await res.json()) as { ok: boolean; data: { projectId: string } }
  if (!env.ok || !env.data?.projectId) {
    throw new Error(`createProjectViaApi: unexpected response: ${JSON.stringify(env)}`)
  }
  await ctx.dispose()
  const projectPath = `${parentPath}/${name}`
  return {
    projectId: env.data.projectId,
    projectName: name,
    parentPath,
    projectPath,
    squadPath: `${projectPath}/.squad`,
  }
}

export async function createProjectViaApi(name: string): Promise<string> {
  return (await createProjectViaApiDetails(name)).projectId
}

export async function createIssueViaApi(
  projectId: string,
  issue: {
    title: string
    body?: string
    status?: 'backlog' | 'ready' | 'in_progress' | 'in_review' | 'done'
    idempotencyKey?: string
  },
): Promise<string> {
  const ctx = await request.newContext({ baseURL: API_BASE })
  const columns = await ctx.get(`/api/projects/${projectId}/columns`)
  if (!columns.ok()) {
    throw new Error(`createIssueViaApi: GET /api/projects/${projectId}/columns returned ${columns.status()}`)
  }
  const res = await ctx.post(`/api/projects/${projectId}/issues`, {
    data: {
      title: issue.title,
      body: issue.body,
      status: issue.status ?? 'backlog',
      idempotencyKey: issue.idempotencyKey,
    },
  })
  if (!res.ok()) {
    throw new Error(`createIssueViaApi: POST /api/projects/${projectId}/issues returned ${res.status()}: ${await res.text()}`)
  }
  const created = (await res.json()) as { id?: string }
  await ctx.dispose()
  if (!created.id) {
    throw new Error(`createIssueViaApi: unexpected response: ${JSON.stringify(created)}`)
  }
  return created.id
}

export async function createInboxItemViaApi(input: {
  originalDraft: string
  suggestedProjectId?: string | null
  idempotencyKey?: string
}): Promise<string> {
  const ctx = await request.newContext({ baseURL: API_BASE })
  const res = await ctx.post('/api/inbox', {
    data: input,
  })
  if (!res.ok()) {
    throw new Error(`createInboxItemViaApi: POST /api/inbox returned ${res.status()}`)
  }
  const item = (await res.json()) as { id?: string }
  await ctx.dispose()
  if (!item.id) {
    throw new Error(`createInboxItemViaApi: unexpected response: ${JSON.stringify(item)}`)
  }
  return item.id
}

/**
 * Create a new project via the "Create new" tab on the ProjectPicker.
 *
 * Uses a synthetic parentPath under packages/e2e/.e2e-workspaces so the
 * backend can scaffold a fresh .squad/ directory without touching the real
 * workspace.
 * Returns the project ID extracted from the resulting URL.
 */
export async function createProject(page: Page, name: string): Promise<string> {
  await page.goto('/')

  // Open the Add Project dialog
  const addBtn = page.getByRole('button', { name: 'Add Project' })
  if (await addBtn.isVisible()) {
    await addBtn.click()
  } else {
    // Empty state: "Discover .squad/ directories" button also opens the dialog
    await page.getByRole('button', { name: /Discover/i }).click()
  }

  // Switch to the "Create new" tab (use exact: false to avoid ambiguity with "Create from template")
  await page.getByRole('button', { name: 'Create new' }).click()

  // Fill in parent directory (a unique repo-local path per test run)
  const parentPath = await createE2eProjectParent(name)
  await page.getByPlaceholder('/absolute/path/to/parent').fill(parentPath)

  // Fill in project name
  await page.getByPlaceholder('my-new-project').fill(name)

  // Submit
  await page.getByRole('button', { name: 'Create project' }).click()

  // Wait for redirect to the board
  await page.waitForURL(/\/projects\/[^/]+\/board/, { timeout: 15_000 })

  const match = page.url().match(/\/projects\/([^/]+)\/board/)
  if (!match) throw new Error(`Expected URL like /projects/{id}/board, got ${page.url()}`)
  return match[1]
}

/**
 * Create an issue card in the specified column via the kanban board UI.
 * Assumes we're already on the board page for the given project.
 *
 * Returns the issue title (since the ID is not surfaced in the URL).
 */
export async function createIssue(
  page: Page,
  projectId: string,
  title: string,
  column: 'backlog' | 'ready' | 'in_progress' | 'in_review' | 'done' = 'backlog',
): Promise<string> {
  // Navigate to the board if we're not already there
  if (!page.url().includes(`/projects/${projectId}/board`)) {
    await page.goto(`/projects/${projectId}/board`)
  }

  // Each column header has a "+" button with title="Create issue"
  // Click the one whose column label matches
  const columnLabels: Record<string, string> = {
    backlog: 'Backlog',
    ready: 'Ready',
    in_progress: 'In Progress',
    in_review: 'In Review',
    done: 'Done',
  }
  const columnOrder = Object.keys(columnLabels)
  const columnIndex = columnOrder.indexOf(column)

  await page.getByTitle('Create issue').nth(columnIndex).click()

  // Fill in the title in the modal — CreateIssueModal uses placeholder "Issue title"
  await page.getByPlaceholder('Issue title').fill(title)

  await page.getByRole('button', { name: /^Create Issue$/i }).click()

  // Wait for the modal to close
  await page.waitForSelector('[placeholder*="title"]', { state: 'detached', timeout: 8_000 }).catch(() => {
    // Modal may have closed without matching placeholder — that's fine
  })

  return title
}
