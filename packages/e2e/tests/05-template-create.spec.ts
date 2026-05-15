/**
 * 05-template-create.spec.ts — Wave 10 B1 regression
 *
 * INVARIANT: "Create project from template" lands the user on the new
 * project's board.
 *
 * Wave 10 background: the server route `POST /api/projects/instantiate-template/:templateId`
 * previously returned `{ data: { projectId } }` while the client expected
 * `{ data: { project: { id, name } } }`. The mismatch silently crashed the
 * happy path AFTER a successful insert: the mutation succeeded server-side,
 * left an orphan project row, then threw client-side at `result.id`. This
 * spec asserts the contract end-to-end using a template seeded via the API.
 */
import { test, expect, request } from '@playwright/test'

const API = 'http://localhost:3000'

async function seedSourceProjectAndTemplate(): Promise<{
  templateId: string
  templateName: string
}> {
  const ctx = await request.newContext({ baseURL: API })

  // 1. Create a source project we can save as a template.
  const stamp = Date.now()
  const parentPath = `/tmp/squadboard-tpl-src-${stamp}`
  const projectName = `tpl-src-${stamp}`

  // The test runner needs the parent dir to actually exist on disk before the
  // server will accept it. Use Node's fs/promises via the NodeJS process.
  const fs = await import('node:fs/promises')
  await fs.mkdir(parentPath, { recursive: true })

  const createRes = await ctx.post('/api/squad/create', {
    data: { parentPath, projectName },
  })
  expect(createRes.ok(), `squad create failed: ${createRes.status()}`).toBeTruthy()
  const createEnv = (await createRes.json()) as {
    ok: boolean
    data: { projectId: string }
  }
  expect(createEnv.ok).toBeTruthy()
  expect(createEnv.data?.projectId, 'response must include projectId').toBeTruthy()

  // 2. Save it as a project template.
  const templateName = `tpl-${stamp}`
  const saveRes = await ctx.post(
    `/api/projects/${createEnv.data.projectId}/save-as-template`,
    {
      data: { name: templateName, description: 'Wave 10 B1 e2e template' },
    },
  )
  expect(saveRes.ok(), `save-as-template failed: ${saveRes.status()}`).toBeTruthy()
  const env = (await saveRes.json()) as { ok: boolean; data: { template: { id: string } } }
  expect(env.ok).toBeTruthy()
  expect(env.data?.template?.id, 'response must include template.id').toBeTruthy()

  return { templateId: env.data.template.id, templateName }
}

test.describe('Wave 10 B1 — Create project from template', () => {
  test('happy path: pick template → fill name+path → land on the new project board', async ({
    page,
  }) => {
    const { templateName } = await seedSourceProjectAndTemplate()

    // Open the "Create from template" modal.
    await page.goto('/')
    await page.getByRole('button', { name: 'Create from template' }).click()

    // The template list comes from GET /api/templates?kind=project — our newly
    // seeded template must appear here. Previously this list silently rendered
    // empty due to the same envelope mismatch this spec exists to prevent.
    await expect(
      page.getByRole('heading', { name: 'Create project from template' }),
    ).toBeVisible({ timeout: 5_000 })
    await expect(page.getByText(templateName)).toBeVisible({ timeout: 5_000 })

    // Pick the seeded template.
    await page.getByText(templateName).click()

    // Override name + provide a target squadPath.
    const newName = `tpl-dest-${Date.now()}`
    const squadPath = `/tmp/squadboard-tpl-dest-${Date.now()}/.squad`
    // The Project name input is first; the squadPath input is second.
    const inputs = page.locator('input[type="text"]')
    await inputs.nth(0).fill(newName)
    await inputs.nth(1).fill(squadPath)

    // Submit and assert we navigate to the new project's board.
    await page.getByRole('button', { name: /^Create project/i }).click()
    await page.waitForURL(/\/projects\/[^/]+\/board/, { timeout: 15_000 })

    expect(page.url()).toMatch(/\/projects\/[^/]+\/board/)
  })
})
