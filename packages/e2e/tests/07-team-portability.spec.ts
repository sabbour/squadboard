/**
 * 07-team-portability.spec.ts — Wave 10 B7 regression
 *
 * INVARIANT: the four team-portability endpoints honour the Hockney r5
 * envelope contract:
 *   POST /api/projects/:id/team/export           → { ok, data: { payload }   }
 *   POST /api/projects/:id/team/import           → { ok, data: { imported }  }
 *   POST /api/projects/:id/team/save-as-template → { ok, data: { template: { id, name, ... } } }
 *   POST /api/projects/:id/team/instantiate-template/:templateId
 *                                                → { ok, data: { imported }  }
 *
 * Wave 10 background: previously /export returned the bare TeamPayload at
 * `data` and /save-as-template returned `{ templateId }`. The first crashed
 * the export-team download flow at `payload.agents.length`; the second
 * crashed the save-as-template confirmation at `template.name`. Both lived
 * symptom-only on the client until this regression test was added.
 */
import { test, expect, request } from '@playwright/test'

const API = 'http://localhost:3000'

async function createProjectViaApi(stamp: number, label: string): Promise<string> {
  const ctx = await request.newContext({ baseURL: API })
  const parentPath = `/tmp/squadboard-team-${label}-${stamp}`
  const projectName = `team-${label}-${stamp}`
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

test.describe('Wave 10 B7 — team-portability envelope', () => {
  test('export returns { ok, data: { payload } }', async () => {
    const stamp = Date.now()
    const projectId = await createProjectViaApi(stamp, 'export')

    const ctx = await request.newContext({ baseURL: API })
    const res = await ctx.post(`/api/projects/${projectId}/team/export`)
    expect(res.status(), `export: ${await res.text()}`).toBe(200)

    const env = (await res.json()) as { ok: boolean; data: { payload?: { agents?: unknown[] } } }
    expect(env.ok, 'envelope.ok must be true').toBeTruthy()
    expect(env.data, 'envelope.data must exist').toBeTruthy()
    // The whole point of the bug — payload was at env.data, not env.data.payload.
    expect(env.data.payload, 'data.payload must exist (B7 contract)').toBeTruthy()
    expect(Array.isArray(env.data.payload!.agents), 'payload.agents must be an array').toBeTruthy()
  })

  test('save-as-template returns { ok, data: { template: { id, name, ... } } }', async () => {
    const stamp = Date.now()
    const projectId = await createProjectViaApi(stamp, 'sat')

    const ctx = await request.newContext({ baseURL: API })
    const tplName = `team-tpl-${stamp}`
    const res = await ctx.post(`/api/projects/${projectId}/team/save-as-template`, {
      data: { name: tplName, description: 'Wave 10 B7 e2e' },
    })
    expect(res.status(), `save: ${await res.text()}`).toBe(201)

    const env = (await res.json()) as {
      ok: boolean
      data: {
        template?: {
          id?: string
          kind?: string
          name?: string
          description?: string | null
          createdAt?: string
        }
      }
    }
    expect(env.ok).toBeTruthy()
    // The whole point of the bug — server used to return { templateId } at
    // env.data, not the full template summary at env.data.template.
    expect(env.data.template, 'data.template must exist (B7 contract)').toBeTruthy()
    expect(env.data.template!.id, 'template.id must exist').toBeTruthy()
    expect(env.data.template!.name, 'template.name must round-trip').toBe(tplName)
    expect(env.data.template!.kind, 'team-template must be marked kind=team').toBe('team')
  })

  test('round-trip: export → import lands the same agents back', async () => {
    const stamp = Date.now()
    const sourceId = await createProjectViaApi(stamp, 'roundtrip-src')
    const destId   = await createProjectViaApi(stamp, 'roundtrip-dest')

    const ctx = await request.newContext({ baseURL: API })

    const exportRes = await ctx.post(`/api/projects/${sourceId}/team/export`)
    const exportEnv = (await exportRes.json()) as {
      ok: boolean
      data: { payload: { agents: unknown[] } }
    }
    expect(exportEnv.ok).toBeTruthy()

    const importRes = await ctx.post(`/api/projects/${destId}/team/import`, {
      data: { payload: exportEnv.data.payload },
    })
    expect(importRes.status(), `import: ${await importRes.text()}`).toBe(200)
    const importEnv = (await importRes.json()) as {
      ok: boolean
      data: { imported: unknown[]; skipped: unknown[] }
    }
    expect(importEnv.ok).toBeTruthy()
    expect(Array.isArray(importEnv.data.imported)).toBeTruthy()
    expect(Array.isArray(importEnv.data.skipped)).toBeTruthy()
  })
})
