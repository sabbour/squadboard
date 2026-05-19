/**
 * 09-disabled-agent.spec.ts — Wave 10 B9 regression
 *
 * INVARIANT: a non-active agent cannot be invoked from any surface, and
 * is hidden from every picker by default.
 *
 * Wave 10 background: previously, "disabled" was advisory — the UI
 * grayed out the card and that was it. Pickers (Consult, RunButton,
 * SessionSteeringBar, CommentComposer @-mention, MCP list_agents,
 * etc.) still showed disabled agents, and any direct API caller could
 * still POST a run against them. B9 closes the loop:
 *
 *   - GET /api/projects/:id/agents accepts ?status= filter
 *   - useActiveAgents hook → all client pickers
 *   - POST /api/projects/:id/issues/:issueId/runs returns 422 if
 *     agent.status !== 'active'
 *   - MCP list_agents defaults to status='active'; accepts an explicit
 *     status arg ('active'|'disabled'|'retired'|'all')
 *   - MCP run_agent rejects a disabled/retired agentId
 *   - AgentGrid shows three buckets (Active / Disabled / Retired) and
 *     hides retired behind a toggle
 *
 * This spec exercises the server contract end-to-end via the REST API.
 */
import { test, expect, request } from '@playwright/test'

const API = 'http://localhost:3000'

interface AgentRow {
  id: string
  name: string
  role: string
  status: 'active' | 'disabled' | 'retired'
}

async function createProjectViaApi(stamp: number): Promise<string> {
  const ctx = await request.newContext({ baseURL: API })
  const parentPath = `/tmp/squadboard-b9-${stamp}`
  const projectName = `b9-${stamp}`
  const fs = await import('node:fs/promises')
  await fs.mkdir(parentPath, { recursive: true })

  const res = await ctx.post('/api/squad/create', {
    data: { parentPath, projectName },
  })
  expect(res.ok(), `squad create failed: ${res.status()}`).toBeTruthy()
  const env = (await res.json()) as { ok: boolean; data: { projectId: string } }
  expect(env.ok).toBeTruthy()
  const projectId = env.data.projectId

  // Fresh projects have no column_meta rows — calling GET /columns seeds the
  // 5 default columns (backlog, ready, in_progress, in_review, done) automatically.
  // This mirrors what the UI does when a project board is first loaded.
  const colRes = await ctx.get(`/api/projects/${projectId}/columns`)
  expect(colRes.ok(), `seed columns: ${colRes.status()} — ${await colRes.text()}`).toBeTruthy()

  return projectId
}

async function createAgent(projectId: string, name: string): Promise<AgentRow> {
  const ctx = await request.newContext({ baseURL: API })
  const res = await ctx.post(`/api/projects/${projectId}/agents`, {
    data: { name, role: 'B9 e2e test agent' },
  })
  expect(res.status(), `create agent: ${await res.text()}`).toBe(201)
  const env = (await res.json()) as { ok: boolean; data: AgentRow }
  expect(env.ok).toBeTruthy()
  return env.data
}

async function setAgentStatus(
  projectId: string,
  agentId: string,
  status: 'active' | 'disabled' | 'retired',
): Promise<void> {
  const ctx = await request.newContext({ baseURL: API })
  const res = await ctx.patch(`/api/projects/${projectId}/agents/${agentId}`, {
    data: { status },
  })
  expect(res.status(), `patch status: ${await res.text()}`).toBe(200)
}

async function listAgents(
  projectId: string,
  status?: 'active' | 'disabled' | 'retired',
): Promise<AgentRow[]> {
  const ctx = await request.newContext({ baseURL: API })
  const url = status
    ? `/api/projects/${projectId}/agents?status=${status}`
    : `/api/projects/${projectId}/agents`
  const res = await ctx.get(url)
  expect(res.ok()).toBeTruthy()
  const env = (await res.json()) as { ok: boolean; data: AgentRow[] }
  return env.data
}

async function createIssue(projectId: string, title: string): Promise<string> {
  const ctx = await request.newContext({ baseURL: API })
  // Pass column='backlog' explicitly — createProjectViaApi always seeds it.
  // Not passing status would trigger getDefaultColumnId() → 'backlog' anyway,
  // but an explicit column avoids the assertColumnExists fallback ambiguity.
  const res = await ctx.post(`/api/projects/${projectId}/issues`, {
    data: { title, column: 'backlog' },
  })
  expect(res.status(), `create issue: ${await res.text()}`).toBe(201)
  const issue = (await res.json()) as { id: string }
  return issue.id
}

test.describe('Wave 10 B9 — disabled agent enforcement', () => {
  test('PATCH status=disabled hides agent from default GET, includes when ?status=disabled', async () => {
    const stamp = Date.now()
    const projectId = await createProjectViaApi(stamp)
    const agent = await createAgent(projectId, `b9-list-${stamp}`)

    // Created agents start active and appear in active filter.
    const activeBefore = await listAgents(projectId, 'active')
    expect(activeBefore.find((a) => a.id === agent.id), 'should appear in active filter').toBeTruthy()

    await setAgentStatus(projectId, agent.id, 'disabled')

    // No longer in active filter.
    const activeAfter = await listAgents(projectId, 'active')
    expect(
      activeAfter.find((a) => a.id === agent.id),
      'must NOT appear in active filter once disabled',
    ).toBeFalsy()

    // But IS in disabled filter — operator can still find/recover it.
    const disabled = await listAgents(projectId, 'disabled')
    expect(
      disabled.find((a) => a.id === agent.id),
      'must appear in disabled filter',
    ).toBeTruthy()
  })

  test('POST issue run against a disabled agent returns 422', async () => {
    const stamp = Date.now()
    const projectId = await createProjectViaApi(stamp)
    const agent = await createAgent(projectId, `b9-run-${stamp}`)
    const issueId = await createIssue(projectId, `B9 run guard ${stamp}`)
    await setAgentStatus(projectId, agent.id, 'disabled')

    const ctx = await request.newContext({ baseURL: API })
    const res = await ctx.post(`/api/projects/${projectId}/issues/${issueId}/runs`, {
      data: { agentId: agent.id },
    })
    expect(res.status(), `expected 422, body=${await res.text()}`).toBe(422)
    const body = (await res.json()) as { error?: string }
    expect(body.error, 'error must mention the agent state').toMatch(/disabled|active/i)
  })

  test('POST issue run against a retired agent returns 422', async () => {
    const stamp = Date.now()
    const projectId = await createProjectViaApi(stamp)
    const agent = await createAgent(projectId, `b9-retire-${stamp}`)
    const issueId = await createIssue(projectId, `B9 retire guard ${stamp}`)
    await setAgentStatus(projectId, agent.id, 'retired')

    const ctx = await request.newContext({ baseURL: API })
    const res = await ctx.post(`/api/projects/${projectId}/issues/${issueId}/runs`, {
      data: { agentId: agent.id },
    })
    expect(res.status()).toBe(422)
  })

  test('re-enabling a disabled agent restores both visibility AND invocation', async () => {
    const stamp = Date.now()
    const projectId = await createProjectViaApi(stamp)
    const agent = await createAgent(projectId, `b9-restore-${stamp}`)
    const issueId = await createIssue(projectId, `B9 restore ${stamp}`)

    await setAgentStatus(projectId, agent.id, 'disabled')
    await setAgentStatus(projectId, agent.id, 'active')

    // Visible again.
    const active = await listAgents(projectId, 'active')
    expect(active.find((a) => a.id === agent.id)).toBeTruthy()

    // Invocable again.
    const ctx = await request.newContext({ baseURL: API })
    const res = await ctx.post(`/api/projects/${projectId}/issues/${issueId}/runs`, {
      data: { agentId: agent.id },
    })
    expect(res.status(), `expected 201, body=${await res.text()}`).toBe(201)
  })

  test('POST issue run against a non-existent agentId returns 404 (not 422)', async () => {
    const stamp = Date.now()
    const projectId = await createProjectViaApi(stamp)
    const issueId = await createIssue(projectId, `B9 404 ${stamp}`)

    const ctx = await request.newContext({ baseURL: API })
    const res = await ctx.post(`/api/projects/${projectId}/issues/${issueId}/runs`, {
      data: { agentId: '00000000-0000-0000-0000-000000000000' },
    })
    // Distinguishes "agent disabled" from "agent doesn't exist".
    expect(res.status()).toBe(404)
  })
})
