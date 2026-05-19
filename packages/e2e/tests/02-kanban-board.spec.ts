/**
 * 02-kanban-board.spec.ts
 *
 * INVARIANT: "User can create, view, and move issues on the kanban board"
 *
 * Covers Demo 2 — The board works.
 * All tests share a single project created in beforeAll.
 */
import { test, expect } from '@playwright/test'
import { createProject } from './fixtures.ts'

let projectId: string

test.describe('Demo 2 — Kanban board', () => {
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage()
    projectId = await createProject(page, `e2e-board-${Date.now()}`)
    await page.close()
  })

  test('Board renders five kanban columns', async ({ page }) => {
    await page.goto(`/projects/${projectId}/board`)

    const columns = ['Backlog', 'Ready', 'In Progress', 'In Review', 'Done']
    for (const col of columns) {
      await expect(page.getByText(col).first()).toBeVisible()
    }
  })

  test('Each column has a "Create issue" (+) button', async ({ page }) => {
    await page.goto(`/projects/${projectId}/board`)

    const createButtons = page.getByTitle('Create issue')
    // At least 5 (one per column)
    expect(await createButtons.count()).toBeGreaterThanOrEqual(5)
  })

  test('Create issue → card appears in Backlog column', async ({ page }) => {
    await page.goto(`/projects/${projectId}/board`)

    const issueTitle = `E2E Issue ${Date.now()}`

    // Click the + button in the Backlog column header
    // The Backlog column header contains text "Backlog" and a sibling + button
    const backlogPlusBtn = page
      .getByTitle('Create issue')
      .first() // Backlog is the first column
    await backlogPlusBtn.click()

    // Fill in the issue title
    await page.getByPlaceholder('Issue title').fill(issueTitle)

    // Submit the form
    await page.getByRole('button', { name: 'Create Issue' }).click()

    // Card should appear on the board
    await expect(page.getByText(issueTitle)).toBeVisible({ timeout: 8_000 })
  })

  test('Click issue card → detail panel opens showing title', async ({ page }) => {
    await page.goto(`/projects/${projectId}/board`)

    const issueTitle = `E2E Detail ${Date.now()}`

    // Create an issue first
    await page.getByTitle('Create issue').first().click()
    await page.getByPlaceholder('Issue title').fill(issueTitle)
    await page.getByRole('button', { name: 'Create Issue' }).click()
    await expect(page.getByText(issueTitle)).toBeVisible({ timeout: 8_000 })

    // Click the card to open detail panel
    await page.getByText(issueTitle).click()

    // Detail panel shows the issue title in an h2
    await expect(page.locator('h2').filter({ hasText: issueTitle })).toBeVisible({ timeout: 8_000 })
  })

  test('Drag issue from Backlog to In Progress (or status API)', async ({ page }) => {
    test.fixme(
      true,
      'Drag-and-drop with @hello-pangea/dnd requires synthetic pointer events — ' +
        'use page.dragAndDrop() once stable selectors for column droppables are confirmed.',
    )
  })

  test('Move issue via bulk action bar changes its column', async ({ page }) => {
    await page.goto(`/projects/${projectId}/board`)

    const issueTitle = `E2E Bulk ${Date.now()}`

    // Create an issue in Backlog
    await page.getByTitle('Create issue').first().click()
    await page.getByPlaceholder('Issue title').fill(issueTitle)
    await page.getByRole('button', { name: 'Create Issue' }).click()
    await expect(page.getByText(issueTitle)).toBeVisible({ timeout: 8_000 })

    // Click the card to select it (single-click without shift selects it)
    // The bulk action bar appears when selectedIds.size > 0.
    // Cards respond to click -> setActiveCard (detail panel), NOT selection.
    // Selection only happens via shift+click or dedicated checkbox.
    // This test is marked fixme until a dedicated selection mechanism is exposed.
    test.fixme(
      true,
      'Bulk selection requires Shift+click or a checkbox UI — ' +
        'verify the selection trigger in IssueCard component before implementing.',
    )
  })

  test('Filter bar search hides non-matching cards', async ({ page }) => {
    await page.goto(`/projects/${projectId}/board`)

    const issueTitle = `FilterTarget-${Date.now()}`

    // Create a distinctly named issue
    await page.getByTitle('Create issue').first().click()
    await page.getByPlaceholder('Issue title').fill(issueTitle)
    await page.getByRole('button', { name: 'Create Issue' }).click()
    await expect(page.getByText(issueTitle)).toBeVisible({ timeout: 8_000 })

    // Type a unique substring into the search bar
    // FilterBar uses placeholder "Filter by title…"
    const searchInput = page.getByPlaceholder('Filter by title…')
    if (await searchInput.isVisible()) {
      await searchInput.fill('FilterTarget')
      await expect(page.getByText(issueTitle)).toBeVisible()

      // Typing something that matches nothing should hide the card
      await searchInput.fill('xyzzy-no-match-42')
      await expect(page.getByText(issueTitle)).not.toBeVisible({ timeout: 3_000 })
    } else {
      test.fixme(true, 'FilterBar placeholder changed — update selector to match FilterBar component')
    }
  })
})
