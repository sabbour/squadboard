import { request } from '@playwright/test'

const API_BASE = process.env.SQUADBOARD_E2E_API_BASE ?? 'http://localhost:3000'
const runningFromE2ePackage = process.cwd().endsWith('/packages/e2e')
const defaultE2eRoot = runningFromE2ePackage ? process.cwd() : `${process.cwd()}/packages/e2e`
const E2E_WORKSPACE_ROOT = process.env.SQUADBOARD_E2E_WORKSPACE_ROOT
  ?? `${defaultE2eRoot}/.e2e-workspaces`

interface ProjectRow {
  id?: string
  name?: string
  path?: string
  squadPath?: string
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '')
}

function isE2eWorkspaceProject(project: ProjectRow): boolean {
  const root = normalizePath(E2E_WORKSPACE_ROOT)
  const squadPath = normalizePath(project.squadPath ?? project.path ?? '')
  return Boolean(project.id && squadPath && (squadPath === root || squadPath.startsWith(`${root}/`)))
}

export default async function globalTeardown() {
  const ctx = await request.newContext({ baseURL: API_BASE })
  try {
    const projectsRes = await ctx.get('/api/projects')
    if (!projectsRes.ok()) return

    const projects = (await projectsRes.json()) as ProjectRow[]
    const e2eProjects = projects.filter(isE2eWorkspaceProject)
    for (const project of e2eProjects) {
      const res = await ctx.delete(`/api/projects/${project.id}`)
      if (!res.ok() && res.status() !== 404) {
        console.warn(`[e2e-cleanup] metadata cleanup failed for project ${project.id}: ${res.status()} ${await res.text()}`)
      }
    }
  } finally {
    await ctx.dispose()
  }
}
