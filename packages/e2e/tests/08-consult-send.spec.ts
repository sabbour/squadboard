/**
 * 08-consult-send.spec.ts — Wave 10 B8 regression
 *
 * INVARIANT: sending a message in the Consult page never crashes the app
 * — failures (oversized payload, transient 5xx, network drop) surface
 * inline as a Fluent MessageBar and the user can retry.
 *
 * Wave 10 background: B6 added an "embed recent runs" tail to the issue
 * prefill. That tail occasionally pushed the seedMessage past the
 * Postgres `text` row-overflow boundary, the POST silently failed, and
 * the app crashed at the React error boundary. The B8 fix:
 *   - server caps `content` at 64 KiB (returns 400)
 *   - client wraps send in try/catch + MessageBar
 *   - client clamps the runs-tail prefill at 32 KiB
 *
 * This spec exercises the server cap directly (no UI dependency on
 * Consult internals) plus the happy path.
 */
import { test, expect, request } from '@playwright/test'

const API = 'http://localhost:3000'

async function createProjectViaApi(stamp: number, label: string): Promise<string> {
  const ctx = await request.newContext({ baseURL: API })
  const parentPath = `/tmp/squadboard-consult-${label}-${stamp}`
  const projectName = `consult-${label}-${stamp}`
  const fs = await import('node:fs/promises')
  await fs.mkdir(parentPath, { recursive: true })

  const res = await ctx.post('/api/squad/create', {
    data: { parentPath, projectName },
  })
  expect(res.ok(), `squad create failed: ${res.status()}`).toBeTruthy()
  const env = (await res.json()) as { ok: boolean; data: { projectId: string } }
  expect(env.ok).toBeTruthy()
  return env.data.projectId
}

async function startModelConsult(projectId: string): Promise<string> {
  const ctx = await request.newContext({ baseURL: API })
  // Model mode avoids any agent-required validation so the test stays
  // deterministic regardless of which agents the new project ships with.
  const res = await ctx.post('/api/consult', {
    data: { projectId, mode: 'model', name: 'B8 e2e' },
  })
  expect(res.status(), `start consult: ${await res.text()}`).toBe(201)
  const session = (await res.json()) as { id: string }
  expect(session.id).toBeTruthy()
  return session.id
}

test.describe('Wave 10 B8 — Consult send guards', () => {
  test('POST /messages rejects payloads above 64 KiB with 400', async () => {
    const stamp = Date.now()
    const projectId = await createProjectViaApi(stamp, 'oversize')
    const sessionId = await startModelConsult(projectId)

    const ctx = await request.newContext({ baseURL: API })
    // 64 KiB cap on the server — push 80 KiB to make the violation obvious.
    const oversize = 'x'.repeat(80 * 1024)
    const res = await ctx.post(`/api/consult/${sessionId}/messages`, {
      data: { content: oversize },
    })
    expect(res.status(), `expected 400, body=${await res.text()}`).toBe(400)
    const body = (await res.json()) as { error?: string }
    expect(body.error, 'error must call out the cap').toMatch(/64|exceeds/i)
  })

  test('POST /messages rejects empty content with 400', async () => {
    const stamp = Date.now()
    const projectId = await createProjectViaApi(stamp, 'empty')
    const sessionId = await startModelConsult(projectId)

    const ctx = await request.newContext({ baseURL: API })
    const res = await ctx.post(`/api/consult/${sessionId}/messages`, {
      data: { content: '   ' },
    })
    expect(res.status()).toBe(400)
  })

  test('POST /messages accepts a normal-sized payload (sanity)', async () => {
    const stamp = Date.now()
    const projectId = await createProjectViaApi(stamp, 'happy')
    const sessionId = await startModelConsult(projectId)

    const ctx = await request.newContext({ baseURL: API })
    const res = await ctx.post(`/api/consult/${sessionId}/messages`, {
      data: { content: 'Hello — this is a normal message.' },
    })
    // 202 Accepted — the assistant turn streams asynchronously over WS.
    expect(res.status(), `body=${await res.text()}`).toBe(202)
  })
})
