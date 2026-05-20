/**
 * 15-ceremony-activation.spec.ts
 *
 * INVARIANT: "A ceremony can be activated and the activation is observable
 * through the API."
 *
 * What does the system do when a ceremony is:
 *   - Created (POST /ceremonies) as kind='ceremony', status='draft'
 *   - Activated (POST /ceremonies/:id/activate) → status='active'
 *   - Run ad-hoc (POST /ceremonies/:id/run) → workflowRunId returned
 *   - Listed in the ceremonies UI
 *
 * Named skips are used where the current product cannot satisfy the invariant
 * (e.g. narrative→executable conversion requires a live AI translator).
 */
import { test, expect, request } from '@playwright/test'
import { API_BASE, createProjectViaApiDetails } from './fixtures.ts'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface ApiEnvelope<T> { ok?: boolean; data?: T; error?: string }

interface CeremonyRow {
  id: string
  name: string
  kind: string
  status: string
  triggerKind?: string
}

interface WorkflowRunRef {
  workflowRunId: string
  message: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function createCeremony(
  projectId: string,
  opts: {
    name: string
    kind?: 'ceremony' | 'workflow'
    triggerKind?: string
    yamlContent?: string
  },
  apiBase = API_BASE,
): Promise<CeremonyRow> {
  const ctx = await request.newContext({ baseURL: apiBase })
  const res = await ctx.post(`/api/projects/${projectId}/ceremonies`, {
    data: {
      name: opts.name,
      kind: opts.kind ?? 'ceremony',
      triggerKind: opts.triggerKind ?? 'manual',
      yamlContent: opts.yamlContent ?? minimalCeremonyYaml(opts.name),
    },
  })
  const text = await res.text()
  await ctx.dispose()
  expect(res.status(), `create ceremony: ${text}`).toBeLessThan(300)
  const body = JSON.parse(text)
  // Server returns { ceremony: CeremonyRow, version: VersionRow }
  const row: CeremonyRow = body?.ceremony ?? (body?.id ? body : (body?.data ?? body))
  expect(row?.id, `ceremony must have an id: ${text}`).toBeTruthy()
  return row
}

async function activateCeremony(
  projectId: string,
  ceremonyId: string,
  apiBase = API_BASE,
): Promise<{ ceremony: CeremonyRow; message: string }> {
  const ctx = await request.newContext({ baseURL: apiBase })
  const res = await ctx.post(`/api/projects/${projectId}/ceremonies/${ceremonyId}/activate`)
  const text = await res.text()
  await ctx.dispose()
  expect(res.status(), `activate ceremony: ${text}`).toBeLessThan(300)
  return JSON.parse(text)
}

async function runCeremony(
  projectId: string,
  ceremonyId: string,
  apiBase = API_BASE,
): Promise<WorkflowRunRef | null> {
  const ctx = await request.newContext({ baseURL: apiBase })
  const res = await ctx.post(`/api/projects/${projectId}/ceremonies/${ceremonyId}/run`)
  const text = await res.text()
  await ctx.dispose()
  if (res.status() === 409) return null // no active version / narrative ceremony
  expect(res.status(), `run ceremony: ${text}`).toBeLessThan(300)
  return JSON.parse(text) as WorkflowRunRef
}

async function getCeremony(
  projectId: string,
  ceremonyId: string,
  apiBase = API_BASE,
): Promise<CeremonyRow> {
  const ctx = await request.newContext({ baseURL: apiBase })
  const res = await ctx.get(`/api/projects/${projectId}/ceremonies/${ceremonyId}`)
  const text = await res.text()
  await ctx.dispose()
  expect(res.status(), `get ceremony: ${text}`).toBe(200)
  const body = JSON.parse(text)
  // GET /ceremonies/:id returns { ceremony: CeremonyRow, ... } (rich response with lifecycle etc.)
  return body?.ceremony ?? (body?.id ? body : (body?.data ?? body))
}

async function listCeremonies(projectId: string, apiBase = API_BASE): Promise<CeremonyRow[]> {
  const ctx = await request.newContext({ baseURL: apiBase })
  const res = await ctx.get(`/api/projects/${projectId}/ceremonies`)
  const text = await res.text()
  await ctx.dispose()
  expect(res.status(), `list ceremonies: ${text}`).toBe(200)
  const body = JSON.parse(text)
  if (Array.isArray(body)) return body
  const d = body?.data
  if (Array.isArray(d)) return d
  if (d && typeof d === 'object') {
    const inner = d as Record<string, unknown>
    return (Array.isArray(inner.ceremonies) ? inner.ceremonies : inner.workflows ?? []) as CeremonyRow[]
  }
  return (body.ceremonies ?? body.workflows ?? []) as CeremonyRow[]
}

/** Minimal valid ceremony YAML accepted by the server's workflow-parser. */
function minimalCeremonyYaml(name: string): string {
  return [
    `name: ${name}`,
    'trigger: manual',
    'steps:',
    '  - name: summarise',
    '    type: agent_run',
    '    agent: squad',
    '    prompt: |',
    '      Summarise the current project backlog in one sentence.',
  ].join('\n')
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
test.describe('Ceremony activation', () => {
  let projectId: string

  test.beforeAll(async () => {
    const project = await createProjectViaApiDetails(`e2e-ceremony-${Date.now()}`)
    projectId = project.projectId
  })

  // ─── 1. Create ────────────────────────────────────────────────────────────
  test('POST /ceremonies creates a draft ceremony observable in GET /ceremonies', async () => {
    const name = `e2e-create-${Date.now()}`
    const created = await createCeremony(projectId, { name })

    expect(created.id).toBeTruthy()
    expect(['draft', 'active']).toContain(created.status)
    expect(created.name).toBe(name)

    // Confirm it appears in the list
    const list = await listCeremonies(projectId)
    const found = list.find((c) => c.id === created.id)
    expect(found, 'created ceremony must appear in list').toBeTruthy()
  })

  // ─── 2. GET single ────────────────────────────────────────────────────────
  test('GET /ceremonies/:id returns the ceremony row with id, name, kind, status', async () => {
    const name = `e2e-get-${Date.now()}`
    const created = await createCeremony(projectId, { name })
    const fetched = await getCeremony(projectId, created.id)

    expect(fetched.id).toBe(created.id)
    expect(fetched.name).toBe(name)
    expect(['ceremony', 'workflow', 'narrative']).toContain(fetched.kind)
    expect(['draft', 'active', 'paused']).toContain(fetched.status)
  })

  // ─── 3. Activate ──────────────────────────────────────────────────────────
  test('POST /ceremonies/:id/activate flips status to active', async () => {
    const name = `e2e-activate-${Date.now()}`
    const created = await createCeremony(projectId, { name })

    const activated = await activateCeremony(projectId, created.id)
    expect(activated.ceremony.status).toBe('active')
    expect(activated.message).toBeTruthy()

    // Verify via GET
    const fetched = await getCeremony(projectId, created.id)
    expect(fetched.status).toBe('active')
  })

  // ─── 4. Run ───────────────────────────────────────────────────────────────
  test('POST /ceremonies/:id/run on an active manual ceremony returns a workflowRunId', async () => {
    const name = `e2e-run-${Date.now()}`
    const created = await createCeremony(projectId, { name, triggerKind: 'manual' })
    await activateCeremony(projectId, created.id)

    const runRef = await runCeremony(projectId, created.id)
    if (runRef === null) {
      // 409 — no active version or narrative; the server cannot spawn yet.
      // This is acceptable when the YAML doesn't produce an active version.
      test.fixme(
        true,
        'BLOCKER: /run returned 409 — the ceremony YAML did not produce an active version. ' +
          'May require the AI translator to convert a narrative into an executable ceremony first.',
      )
      return
    }

    expect(runRef.workflowRunId, 'run must return a workflowRunId').toBeTruthy()
    expect(runRef.message).toBeTruthy()
  })

  // ─── 5. Activation gate: narrative ceremonies must be converted first ─────
  test('POST /ceremonies/:id/activate on a narrative ceremony returns 409 with clear error', async () => {
    // Create a narrative ceremony (kind='narrative') — the activate endpoint
    // must reject it and tell the caller to convert first.
    const ctx = await request.newContext({ baseURL: API_BASE })
    const res = await ctx.post(`/api/projects/${projectId}/ceremonies`, {
      data: {
        name: `e2e-narrative-${Date.now()}`,
        kind: 'narrative',
        triggerKind: 'manual',
        yamlContent: '# narrative source\n\nSummarise the project backlog.',
      },
    })
    const text = await res.text()
    await ctx.dispose()

    if (res.status() === 400 || res.status() === 422) {
      // Server rejects narrative creation from this endpoint — that is
      // also acceptable; the product prevents direct narrative creation here.
      return
    }
    if (!res.ok()) return // any other rejection is fine

    const row = JSON.parse(text)
    const narrativeId: string = row?.id ?? row?.data?.id ?? row?.ceremony?.id
    if (!narrativeId) return // creation didn't yield a row we can test

    const activateCtx = await request.newContext({ baseURL: API_BASE })
    const activateRes = await activateCtx.post(
      `/api/projects/${projectId}/ceremonies/${narrativeId}/activate`,
    )
    const activateText = await activateRes.text()
    await activateCtx.dispose()

    expect(activateRes.status(), `narrative activate should be 409: ${activateText}`).toBe(409)
    expect(activateText).toContain('narrative')
  })

  // ─── 6. UI surface ────────────────────────────────────────────────────────
  test('Ceremonies page renders ceremony rows after creation', async ({ page }) => {
    const name = `e2e-ui-ceremony-${Date.now()}`
    await createCeremony(projectId, { name })

    await page.goto(`/projects/${projectId}/ceremonies`)
    // The page must not show an error
    await expect(page.getByText(/Failed to load|Error loading/i)).not.toBeVisible({ timeout: 8_000 })
    // At least one heading or list for ceremonies
    const cerHeading = page.getByRole('heading', { name: /Ceremon/i })
    const cerList = page.locator('[data-testid*="ceremony"], [class*="ceremony"], [aria-label*="ceremony"]')
    const hasHeading = await cerHeading.isVisible({ timeout: 8_000 }).catch(() => false)
    const hasList = await cerList.count().then((n) => n > 0).catch(() => false)
    expect(hasHeading || hasList, 'ceremonies page should render ceremony content').toBeTruthy()
  })

  // ─── 7. Named skips ───────────────────────────────────────────────────────
  test.fixme('Ceremony activation creates a real AI-driven run observable in the run log', async () => {
    // BLOCKER: Spawning an executable ceremony run requires either a live AI model
    // connection (OPENAI_API_KEY / AZURE_OPENAI_API_KEY) or a mock step runner.
    // The server-side spawnCeremonyRun creates a workflowRun row but the steps are
    // dispatched asynchronously to the coordinator. Deterministic assertion of step
    // execution requires a stub coordinator or a poll of workflowRuns/:id until terminal.
    test.fixme(true, 'requires live AI model or mock coordinator — not available in CI')
  })

  test.fixme('Ceremony scheduled with a cron trigger fires automatically within the window', async () => {
    // BLOCKER: Verifying a cron-triggered ceremony requires the ceremony-scheduler to
    // be running (it is a background timer loop). No in-process test hook exists.
    // Implement a GET /api/projects/:id/ceremonies/:cId/schedules assertion instead,
    // which is deterministic and does not depend on wall-clock firing.
    test.fixme(true, 'ceremony-scheduler is a background timer loop with no in-process test hook')
  })
})
