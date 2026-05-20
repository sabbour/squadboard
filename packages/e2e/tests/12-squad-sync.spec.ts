/**
 * 12-squad-sync.spec.ts
 *
 * INVARIANT: Squadboard and CLI/Copilot are peer clients of one Squad state
 * authority. Missing projections or empty ceremonies are warnings with
 * explicit repair actions, not silent alternate sources of truth.
 */
import { test, expect, request } from '@playwright/test'
import {
  API_BASE,
  createE2eProjectParent,
  createProjectViaApiDetails,
  type CreatedProjectViaApi,
} from './fixtures.ts'

interface ApiEnvelope<T> {
  ok: boolean
  data: T
  error?: { message?: string } | string
}

interface SyncArtifact {
  id: string
  path: string
  status: 'present' | 'missing' | string
  requirement: 'required' | 'recommended' | 'optional' | string
}

interface SyncRepairAction {
  id: string
  available?: boolean
  required?: boolean
  endpoint?: string
  aliases?: string[]
}

interface SyncStatus {
  projectId: string
  authority: {
    storageMode: 'filesystem' | 'postgresql' | string
    sourceOfTruth: 'filesystem' | 'squad_storage' | string
    runtime: { kind: string; note: string }
  }
  bootstrap: {
    status: 'ready' | 'partial' | 'missing' | string
    missingRequired: string[]
    missingRecommended: string[]
  }
  projection: {
    projectRoot: string | null
    squadPath: string | null
    artifacts: SyncArtifact[]
  }
  drift: {
    detected: boolean
    level: 'ready' | 'warning' | 'error' | string
    issues: Array<{ code: string; severity: string; artifactId?: string }>
  }
  repair: {
    actions: SyncRepairAction[]
  }
}

interface RepairResult {
  action: string
  status: string
  reason: string
}

interface RepairResponse {
  projectId: string
  dryRun: boolean
  results: RepairResult[]
  statusAfter?: SyncStatus
}

async function getSyncStatus(projectId: string, apiBase = API_BASE): Promise<SyncStatus> {
  const ctx = await request.newContext({ baseURL: apiBase })
  const res = await ctx.get(`/api/projects/${projectId}/squad-sync/status`)
  const text = await res.text()
  await ctx.dispose()
  expect(res.status(), `status response: ${text}`).toBe(200)
  const env = JSON.parse(text) as ApiEnvelope<SyncStatus>
  expect(env.ok, `status envelope: ${text}`).toBeTruthy()
  return env.data
}

async function postSyncRepair(
  projectId: string,
  endpoint: 'repair' | 'generate-github-agent',
  body: Record<string, unknown>,
  apiBase = API_BASE,
): Promise<RepairResponse> {
  const ctx = await request.newContext({ baseURL: apiBase })
  const res = await ctx.post(`/api/projects/${projectId}/squad-sync/${endpoint}`, { data: body })
  const text = await res.text()
  await ctx.dispose()
  expect(res.status(), `${endpoint} response: ${text}`).toBe(200)
  const env = JSON.parse(text) as ApiEnvelope<RepairResponse>
  expect(env.ok, `${endpoint} envelope: ${text}`).toBeTruthy()
  return env.data
}

function artifact(status: SyncStatus, id: string): SyncArtifact {
  const found = status.projection.artifacts.find((item) => item.id === id)
  expect(found, `projection artifact ${id} must be reported`).toBeTruthy()
  return found!
}

function repairAction(status: SyncStatus, id: string): SyncRepairAction {
  const found = status.repair.actions.find((item) => item.id === id || item.aliases?.includes(id))
  expect(found, `repair action ${id} must be reported`).toBeTruthy()
  return found!
}

async function createCliFirstProject(name: string, apiBase = API_BASE): Promise<CreatedProjectViaApi> {
  const fs = await import('node:fs/promises')
  const path = await import('node:path')
  const parentPath = await createE2eProjectParent(name)
  const projectPath = path.join(parentPath, name)
  const squadPath = path.join(projectPath, '.squad')
  await fs.mkdir(path.join(squadPath, 'agents'), { recursive: true })
  await fs.mkdir(path.join(squadPath, 'decisions', 'inbox'), { recursive: true })
  await fs.mkdir(path.join(projectPath, '.github', 'agents'), { recursive: true })
  await fs.writeFile(path.join(squadPath, 'team.md'), `# ${name}\n\n| Name | Role |\n|------|------|\n| Squad | Coordinator |\n`, 'utf-8')
  await fs.writeFile(path.join(squadPath, 'routing.md'), '# Routing\n\nAll work routes to Squad.\n', 'utf-8')
  await fs.writeFile(path.join(squadPath, 'decisions.md'), '# Decisions\n\n', 'utf-8')
  await fs.writeFile(path.join(squadPath, 'ceremonies.md'), '# Ceremonies\n\n## Design Review\n\nSeeded by CLI-first fixture.\n', 'utf-8')
  await fs.writeFile(
    path.join(projectPath, '.github', 'agents', 'squad.agent.md'),
    'You are Squad. Read .squad/team.md, .squad/routing.md, and .squad/decisions.md before work.\n',
    'utf-8',
  )

  const ctx = await request.newContext({ baseURL: apiBase })
  const res = await ctx.post('/api/squad/register', { data: { path: squadPath, name } })
  const text = await res.text()
  await ctx.dispose()
  expect(res.status(), `register CLI-first project: ${text}`).toBe(201)
  const env = JSON.parse(text) as ApiEnvelope<{ projectId: string; name: string; squadPath: string }>
  expect(env.ok).toBeTruthy()
  return {
    projectId: env.data.projectId,
    projectName: env.data.name,
    parentPath,
    projectPath,
    squadPath,
  }
}

async function createProjectViaBrowser(page: import('@playwright/test').Page, name: string): Promise<string> {
  const parentPath = await createE2eProjectParent(name)
  await page.goto('/')
  const result = await page.evaluate(async ({ parentPath, name }) => {
    const res = await fetch('/api/squad/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parentPath, projectName: name }),
    })
    return { status: res.status, text: await res.text() }
  }, { parentPath, name })
  expect(result.status, `browser create project: ${result.text}`).toBe(201)
  const env = JSON.parse(result.text) as ApiEnvelope<{ projectId: string }>
  expect(env.ok).toBeTruthy()
  return env.data.projectId
}

async function getFreePort(): Promise<number> {
  const { createServer } = await import('node:net')
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Could not allocate an E2E server port')))
        return
      }
      server.close(() => resolve(address.port))
    })
  })
}

async function waitForHealth(apiBase: string, output: () => string): Promise<void> {
  const ctx = await request.newContext({ baseURL: apiBase })
  const deadline = Date.now() + 45_000
  try {
    while (Date.now() < deadline) {
      try {
        const res = await ctx.get('/api/health', { timeout: 1_000 })
        if (res.ok()) return
      } catch {
        // Retry until the server finishes booting.
      }
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  } finally {
    await ctx.dispose()
  }
  throw new Error(`Squadboard server did not become healthy.\n${output()}`)
}

async function launchFilesystemSquadboardServer(): Promise<{ apiBase: string; stop: () => Promise<void> }> {
  const { spawn } = await import('node:child_process')
  const path = await import('node:path')
  const fs = await import('node:fs/promises')
  const port = await getFreePort()
  const home = await createE2eProjectParent(`fs-home-${port}`)
  const apiBase = `http://127.0.0.1:${port}`
  const repoRoot = path.resolve(process.cwd(), '../..')
  const child = spawn('pnpm', ['--filter', '@sabbour/squadboard', 'dev:fs'], {
    cwd: repoRoot,
    detached: process.platform !== 'win32',
    env: {
      ...process.env,
      HOME: home,
      PORT: String(port),
      SQUADBOARD_AUTO_MIGRATE: 'false',
      SQUADBOARD_AUTO_REGISTER_SELF: 'false',
      SQUADBOARD_DISABLE_CSRF: '1',
      SQUADBOARD_SQUAD_STORAGE_PROVIDER: 'fs',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let output = ''
  let exited = false
  const append = (chunk: Buffer) => {
    output = `${output}${chunk.toString('utf8')}`.slice(-12_000)
  }
  child.stdout.on('data', append)
  child.stderr.on('data', append)
  child.once('exit', () => {
    exited = true
  })

  try {
    await waitForHealth(apiBase, () => output)
  } catch (error) {
    if (child.pid) {
      try {
        process.kill(process.platform === 'win32' ? child.pid : -child.pid, 'SIGTERM')
      } catch {
        // Process already exited while health polling failed.
      }
    }
    await fs.rm(home, { recursive: true, force: true })
    throw error
  }

  return {
    apiBase,
    stop: async () => {
      if (!exited && child.pid) {
        const exitPromise = new Promise<void>((resolve) => child.once('exit', () => resolve()))
        try {
          process.kill(process.platform === 'win32' ? child.pid : -child.pid, 'SIGTERM')
        } catch {
          exited = true
        }
        await Promise.race([
          exitPromise,
          new Promise((resolve) => setTimeout(resolve, 5_000)).then(() => {
            if (!exited && child.pid) {
              try {
                process.kill(process.platform === 'win32' ? child.pid : -child.pid, 'SIGKILL')
              } catch {
                // Already gone.
              }
            }
          }),
        ])
      }
      await fs.rm(home, { recursive: true, force: true })
    },
  }
}

test.describe('Team Sync / Squadboard cross-surface paths', () => {
  test('What does the system do when a Squadboard-first project lacks the Copilot projection? It reports a warning and repair action.', async () => {
    const project = await createProjectViaApiDetails(`sync-missing-agent-${Date.now()}`)

    const status = await getSyncStatus(project.projectId)

    expect(['filesystem', 'postgresql']).toContain(status.authority.storageMode)
    expect(['filesystem', 'squad_storage']).toContain(status.authority.sourceOfTruth)
    expect(artifact(status, 'teamMd').status).toBe('present')
    expect(artifact(status, 'copilotAgentMd')).toMatchObject({
      status: 'missing',
      requirement: 'recommended',
    })
    expect(status.bootstrap.missingRecommended).toContain('copilotAgentMd')
    expect(status.drift.detected).toBe(true)
    expect(['warning', 'error']).toContain(status.drift.level)
    expect(repairAction(status, 'generate-github-agent')).toMatchObject({
      available: true,
      endpoint: 'POST /api/projects/:projectId/squad-sync/generate-github-agent',
    })
  })

  test('What does the user see in Settings → Team Sync? The panel renders status evidence from the real API.', async ({ page }) => {
    const projectId = await createProjectViaBrowser(page, `sync-settings-${Date.now()}`)

    await page.goto(`/projects/${projectId}/settings`)
    await expect(page.getByRole('button', { name: 'Team Sync' })).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: 'Team Sync' }).click()

    await expect(page.getByTestId('squad-sync-status-panel')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Source of truth')).toBeVisible()
    await expect(page.getByText(/Squadboard database|Filesystem \.squad/)).toBeVisible()
    await expect(page.getByText('Storage mode')).toBeVisible()
    await expect(page.getByText(/PostgreSQL-backed|Filesystem-backed/)).toBeVisible()
    await expect(page.getByText('CLI/Copilot agent file', { exact: true })).toBeVisible()
    await expect(page.getByTestId('repair-action-generate-github-agent')).toBeVisible()
  })

  test('What does the system do when ceremonies.md is an empty/default placeholder? It repairs seeded defaults.', async () => {
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const project = await createProjectViaApiDetails(`sync-empty-ceremonies-${Date.now()}`)
    const ceremoniesPath = path.join(project.squadPath, 'ceremonies.md')
    await fs.writeFile(ceremoniesPath, '# Ceremonies\n\nProject ceremonies will be listed here.\n', 'utf-8')

    const before = await getSyncStatus(project.projectId)
    expect(artifact(before, 'ceremoniesMd').status).toBe('present')
    expect(artifact(before, 'ceremoniesDefaultsPresent').status).toBe('missing')
    expect(before.bootstrap.missingRequired).toContain('ceremoniesDefaultsPresent')
    expect(repairAction(before, 'seed-ceremony-defaults')).toMatchObject({ available: true })

    const repaired = await postSyncRepair(project.projectId, 'repair', {
      actions: ['seed-ceremony-defaults'],
      dryRun: false,
    })
    expect(repaired.results.find((item) => item.action === 'seed-ceremony-defaults')).toMatchObject({
      status: 'applied',
    })
    const content = await fs.readFile(ceremoniesPath, 'utf-8')
    expect(content).toContain('## Design Review')
    expect(content).toContain('## Retrospective')
    const after = repaired.statusAfter ?? await getSyncStatus(project.projectId)
    expect(artifact(after, 'ceremoniesDefaultsPresent').status).toBe('present')
    expect(after.bootstrap.missingRequired).not.toContain('ceremoniesDefaultsPresent')
  })

  test('What does the system do when asked to generate .github/agents/squad.agent.md? Dry-run is non-mutating, repair creates the projection.', async () => {
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const project = await createProjectViaApiDetails(`sync-generate-agent-${Date.now()}`)
    const agentPath = path.join(project.projectPath, '.github', 'agents', 'squad.agent.md')

    await expect(fs.stat(agentPath)).rejects.toThrow()
    const dryRun = await postSyncRepair(project.projectId, 'generate-github-agent', { dryRun: true })
    expect(dryRun.results.find((item) => item.action === 'generate-github-agent')).toMatchObject({
      status: 'dry-run',
    })
    await expect(fs.stat(agentPath)).rejects.toThrow()

    const repaired = await postSyncRepair(project.projectId, 'generate-github-agent', { dryRun: false })
    expect(repaired.results.find((item) => item.action === 'generate-github-agent')).toMatchObject({
      status: 'applied',
    })
    const content = await fs.readFile(agentPath, 'utf-8')
    expect(content).toContain('You are **Squad (Coordinator)**')
    expect(content).toContain('`.squad/team.md`')
    const after = repaired.statusAfter ?? await getSyncStatus(project.projectId)
    expect(artifact(after, 'copilotAgentMd').status).toBe('present')
  })

  test('What does the system do when a CLI/Copilot-first repository is registered? Filesystem remains authoritative and ready.', async () => {
    test.setTimeout(90_000)
    const server = await launchFilesystemSquadboardServer()
    try {
      const project = await createCliFirstProject(`sync-cli-first-${Date.now()}`, server.apiBase)

      const status = await getSyncStatus(project.projectId, server.apiBase)

      expect(status.authority).toMatchObject({
        storageMode: 'filesystem',
        sourceOfTruth: 'filesystem',
      })
      expect(status.projection.projectRoot).toBe(project.projectPath)
      expect(status.projection.squadPath).toBe(project.squadPath)
      expect(status.bootstrap).toMatchObject({
        status: 'ready',
        missingRequired: [],
        missingRecommended: [],
      })
      expect(artifact(status, 'copilotAgentMd').status).toBe('present')
      expect(status.drift).toMatchObject({ detected: false, level: 'ready' })
    } finally {
      await server.stop()
    }
  })
})
