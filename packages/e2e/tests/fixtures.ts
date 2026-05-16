/**
 * Shared helpers for Squadboard E2E tests.
 *
 * These are plain functions (not Playwright fixtures) that wrap common UI
 * journeys so individual spec files stay concise.
 */
import type { Page } from '@playwright/test'
import { request } from '@playwright/test'

const API_BASE = 'http://localhost:3000'

/**
 * Create a new project directly via the REST API.
 *
 * Preferred over `createProject` on WSL/headless environments where the
 * Fluent-UI controlled inputs are unreliable with Playwright's fill().
 * Returns the project ID.
 */
export async function createProjectViaApi(name: string): Promise<string> {
  const ctx = await request.newContext({ baseURL: API_BASE })
  const stamp = Date.now()
  const parentPath = `/tmp/squadboard-e2e-api-${stamp}`
  const fs = await import('node:fs/promises')
  await fs.mkdir(parentPath, { recursive: true })

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
  return env.data.projectId
}

/**
 * Create a new project via the "Create new" tab on the ProjectPicker.
 *
 * Uses a synthetic parentPath under /tmp so the backend can scaffold
 * a fresh .squad/ directory without touching the real workspace.
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

  // Fill in parent directory (a unique temp path per test run)
  const parentPath = `/tmp/squadboard-e2e-${Date.now()}`
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
  column: 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'done' = 'backlog',
): Promise<string> {
  // Navigate to the board if we're not already there
  if (!page.url().includes(`/projects/${projectId}/board`)) {
    await page.goto(`/projects/${projectId}/board`)
  }

  // Each column header has a "+" button with title="Create issue"
  // Click the one whose column label matches
  const columnLabels: Record<string, string> = {
    backlog: 'Backlog',
    todo: 'Todo',
    in_progress: 'In Progress',
    in_review: 'In Review',
    done: 'Done',
  }
  const label = columnLabels[column]

  // The column header contains the label text; the + button is a sibling
  const columnHeader = page.locator('div').filter({ hasText: new RegExp(`^${label}`) }).first()
  await columnHeader.getByTitle('Create issue').click()

  // Fill in the title in the modal — CreateIssueModal uses placeholder "Issue title"
  await page.getByPlaceholder('Issue title').fill(title)

  // Submit (the modal has a submit button or pressing Enter works)
  await page.getByRole('button', { name: /Create|Save|Add/i }).click()

  // Wait for the modal to close
  await page.waitForSelector('[placeholder*="title"]', { state: 'detached', timeout: 8_000 }).catch(() => {
    // Modal may have closed without matching placeholder — that's fine
  })

  return title
}
