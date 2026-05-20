/**
 * templates.ts — Phase 19 React Query hooks for user-created templates and
 * project/team/workflow portability (export · import · save-as-template).
 *
 * API contract (Hockney r5 — commits 35d5f041 / baebd79e / 3aaf93b0):
 *   All 11 portability endpoints return { ok: true, data: ... } on success
 *   and { ok: false, error: string } on failure (uniform envelope).
 *
 *   squadPath (absolute filesystem path) is REQUIRED on:
 *     POST /api/projects/import
 *     POST /api/projects/instantiate-template/:templateId
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from './client.ts'

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export type TemplateKind = 'workflow' | 'team' | 'project'

export interface TemplateSummary {
  id: string
  kind: TemplateKind
  name: string
  description: string | null
  createdAt: string
  // Stream D — D7: nullable. NULL = built-in / global template, non-null =
  // saved from a specific project. Used by the "My templates" filter on the
  // Templates page.
  projectId?: string | null
}

export interface TemplateDetail extends TemplateSummary {
  payload: unknown
}

/** Uniform server response envelope for all portability endpoints. */
interface ApiEnvelope<T> {
  ok: boolean
  data: T
  error?: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Unwrap the `{ ok, data }` server envelope.
 * Throws with the server's error message when ok === false so React Query
 * treats it as an error automatically.
 */
function unwrapEnvelope<T>(res: ApiEnvelope<T>): T {
  if (!res.ok) {
    throw new Error(res.error ?? 'Server returned ok: false')
  }
  return res.data
}

/** Trigger a browser download for an arbitrary JSON payload. */
function triggerDownload(payload: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/** Trigger a browser download for a plain text / YAML string. */
export function triggerTextDownload(content: string, filename: string, mimeType = 'text/plain'): void {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/** Read a File object and parse it as JSON. */
export function readFileAsJson(file: File): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        resolve(JSON.parse(reader.result as string))
      } catch {
        reject(new Error('File is not valid JSON'))
      }
    }
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsText(file)
  })
}

// ---------------------------------------------------------------------------
// Template catalog
// ---------------------------------------------------------------------------

/** List user-created templates, optionally filtered by kind. */
export function useTemplates(kind?: TemplateKind) {
  return useQuery<TemplateSummary[]>({
    queryKey: ['templates', kind ?? 'all'],
    queryFn: async () => {
      const url = kind ? `/api/templates?kind=${kind}` : '/api/templates'
      const env = await apiFetch<ApiEnvelope<{ templates: TemplateSummary[] }>>(url)
      return unwrapEnvelope(env).templates ?? []
    },
    retry: (failureCount, error) => {
      if (error instanceof Error && error.message.startsWith('API 404')) return false
      return failureCount < 2
    },
  })
}

/** Fetch a single template with its full payload. */
export function useTemplate(id: string) {
  return useQuery<TemplateDetail>({
    queryKey: ['templates', 'detail', id],
    queryFn: async () => {
      const env = await apiFetch<ApiEnvelope<{ template: TemplateDetail }>>(`/api/templates/${id}`)
      return unwrapEnvelope(env).template
    },
    enabled: Boolean(id),
    retry: (failureCount, error) => {
      if (error instanceof Error && error.message.startsWith('API 404')) return false
      return failureCount < 2
    },
  })
}

/** Delete a template by id. Invalidates the ['templates'] cache. */
export function useDeleteTemplate() {
  const queryClient = useQueryClient()
  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      const env = await apiFetch<ApiEnvelope<null>>(`/api/templates/${id}`, { method: 'DELETE' })
      unwrapEnvelope(env)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['templates'] })
    },
  })
}

// ---------------------------------------------------------------------------
// Team portability
// ---------------------------------------------------------------------------

/** Export the current project's team as a JSON blob download. */
export function useExportTeam() {
  return useMutation<void, Error, { projectId: string; filename?: string }>({
    mutationFn: async ({ projectId, filename }) => {
      const env = await apiFetch<ApiEnvelope<{ payload: unknown }>>(
        `/api/projects/${projectId}/team/export`,
        { method: 'POST' },
      )
      triggerDownload(unwrapEnvelope(env).payload, filename ?? `team-export-${projectId}.json`)
    },
  })
}

/** Import a team from a parsed JSON payload. */
export function useImportTeam() {
  const queryClient = useQueryClient()
  return useMutation<{ imported: number }, Error, { projectId: string; payload: unknown }>({
    mutationFn: async ({ projectId, payload }) => {
      const env = await apiFetch<ApiEnvelope<{ imported: number }>>(
        `/api/projects/${projectId}/team/import`,
        { method: 'POST', body: JSON.stringify(payload) },
      )
      return unwrapEnvelope(env)
    },
    onSuccess: (_data, { projectId }) => {
      void queryClient.invalidateQueries({ queryKey: ['agents', projectId] })
    },
  })
}

/** Stream D — D7: result envelope shared by save-as-template hooks. */
export interface SaveAsTemplateResult {
  template: TemplateSummary
  storagePath: string | null
  storageError: string | null
}

/** Save the current team roster as a named template. */
export function useSaveTeamAsTemplate(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation<SaveAsTemplateResult, Error, { name: string; description?: string }>({
    mutationFn: async (input) => {
      const env = await apiFetch<ApiEnvelope<{
        template: TemplateSummary
        storagePath?: string | null
        storageError?: string | null
      }>>(
        `/api/projects/${projectId}/team/save-as-template`,
        { method: 'POST', body: JSON.stringify(input) },
      )
      const data = unwrapEnvelope(env)
      return {
        template: data.template,
        storagePath: data.storagePath ?? null,
        storageError: data.storageError ?? null,
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['templates'] })
    },
  })
}

/** Instantiate a team template into this project. */
export function useInstantiateTeamTemplate(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation<void, Error, { templateId: string }>({
    mutationFn: async ({ templateId }) => {
      const env = await apiFetch<ApiEnvelope<null>>(
        `/api/projects/${projectId}/team/instantiate-template/${templateId}`,
        { method: 'POST' },
      )
      unwrapEnvelope(env)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['agents', projectId] })
    },
  })
}

// ---------------------------------------------------------------------------
// Project portability
// ---------------------------------------------------------------------------

/** Export this project as a JSON blob download. */
export function useExportProject() {
  return useMutation<void, Error, { projectId: string; filename?: string }>({
    mutationFn: async ({ projectId, filename }) => {
      const env = await apiFetch<ApiEnvelope<{ payload: unknown }>>(
        `/api/projects/${projectId}/export`,
        { method: 'POST' },
      )
      triggerDownload(unwrapEnvelope(env).payload, filename ?? `project-export-${projectId}.json`)
    },
  })
}

/**
 * Import a project from a parsed JSON payload.
 *
 * squadPath (required by Hockney r5): absolute filesystem path where the new
 * project's .squad/ directory will be created, e.g. /home/you/projects/foo/.squad
 */
export function useImportProject() {
  const queryClient = useQueryClient()
  return useMutation<
    { id: string; name: string },
    Error,
    { payload: unknown; squadPath: string }
  >({
    mutationFn: async ({ payload, squadPath }) => {
      const env = await apiFetch<ApiEnvelope<{ project: { id: string; name: string } }>>(
        '/api/projects/import',
        { method: 'POST', body: JSON.stringify({ squadPath, payload }) },
      )
      return unwrapEnvelope(env).project
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projects'] })
    },
  })
}

/** Save this project as a named template. */
export function useSaveProjectAsTemplate(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation<SaveAsTemplateResult, Error, { name: string; description?: string }>({
    mutationFn: async (input) => {
      const env = await apiFetch<ApiEnvelope<{
        template: TemplateSummary
        storagePath?: string | null
        storageError?: string | null
      }>>(
        `/api/projects/${projectId}/save-as-template`,
        { method: 'POST', body: JSON.stringify(input) },
      )
      const data = unwrapEnvelope(env)
      return {
        template: data.template,
        storagePath: data.storagePath ?? null,
        storageError: data.storageError ?? null,
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['templates'] })
    },
  })
}

/**
 * Create a new project from a project template.
 *
 * squadPath (required by Hockney r5): absolute filesystem path where the new
 * project's .squad/ directory will be created, e.g. /home/you/projects/foo/.squad
 */
export function useInstantiateProjectTemplate() {
  const queryClient = useQueryClient()
  return useMutation<
    { id: string; name: string },
    Error,
    { templateId: string; name: string; squadPath: string }
  >({
    mutationFn: async ({ templateId, name, squadPath }) => {
      const env = await apiFetch<ApiEnvelope<{ project: { id: string; name: string } }>>(
        `/api/projects/instantiate-template/${templateId}`,
        { method: 'POST', body: JSON.stringify({ name, squadPath }) },
      )
      return unwrapEnvelope(env).project
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projects'] })
    },
  })
}

// ---------------------------------------------------------------------------
// Workflow (ceremony) portability
// ---------------------------------------------------------------------------

/** Save a ceremony as a named workflow template. */
export function useSaveWorkflowAsTemplate(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation<
    TemplateSummary,
    Error,
    { ceremonyId: string; name: string; description?: string }
  >({
    mutationFn: async ({ ceremonyId, name, description }) => {
      const env = await apiFetch<ApiEnvelope<{ template: TemplateSummary }>>(
        `/api/projects/${projectId}/ceremonies/${ceremonyId}/save-as-template`,
        { method: 'POST', body: JSON.stringify({ name, description }) },
      )
      return unwrapEnvelope(env).template
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['templates'] })
    },
  })
}

/** Create a new ceremony from a workflow template. */
export function useInstantiateWorkflowTemplate(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation<void, Error, { templateId: string; name: string }>({
    mutationFn: async ({ templateId, name }) => {
      const env = await apiFetch<ApiEnvelope<null>>(
        `/api/projects/${projectId}/ceremonies/instantiate-template/${templateId}`,
        { method: 'POST', body: JSON.stringify({ name }) },
      )
      unwrapEnvelope(env)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ceremonies', projectId] })
    },
  })
}

/** Import a workflow from a raw JSON payload (drops into ceremonies list). */
export function useImportWorkflow() {
  const queryClient = useQueryClient()
  return useMutation<void, Error, { projectId: string; payload: unknown }>({
    mutationFn: async ({ projectId, payload }) => {
      const env = await apiFetch<ApiEnvelope<null>>(
        `/api/projects/${projectId}/ceremonies/import`,
        { method: 'POST', body: JSON.stringify(payload) },
      )
      unwrapEnvelope(env)
    },
    onSuccess: (_data, { projectId }) => {
      void queryClient.invalidateQueries({ queryKey: ['ceremonies', projectId] })
    },
  })
}

// ---------------------------------------------------------------------------
// Built-in project bundle templates  (Wave 16 — Hockney)
// ---------------------------------------------------------------------------

export interface BuiltinProjectTemplate {
  bundleId: string
  name: string
  description: string
  icon?: string
  version: string
  /** Tags sourced from squadapp.json (empty array if absent). */
  tags?: string[]
  /** App kind from squadapp.json — e.g. 'project-template'. */
  kind?: string
  /** Catalog surface: generic project template or Squadboard App. */
  catalog?: 'template' | 'squadboard-app'
  homepage?: string
}

export type SquadboardAppTemplate = BuiltinProjectTemplate

/** List built-in project bundle templates scanned from the server's bundles/ directory. */
export function useBuiltinProjectTemplates() {
  return useQuery<BuiltinProjectTemplate[], Error>({
    queryKey: ['templates', 'builtin-projects'],
    queryFn: async () => {
      const env = await apiFetch<ApiEnvelope<{ templates: BuiltinProjectTemplate[] }>>(
        '/api/templates/builtin-projects',
      )
      return unwrapEnvelope(env).templates
    },
    staleTime: 60_000,
  })
}

/** List installable Squadboard Apps. These are domain-specific app packages, not generic project templates. */
export function useSquadboardApps() {
  return useQuery<SquadboardAppTemplate[], Error>({
    queryKey: ['templates', 'squadboard-apps'],
    queryFn: async () => {
      const env = await apiFetch<ApiEnvelope<{ apps: SquadboardAppTemplate[] }>>(
        '/api/templates/squadboard-apps',
      )
      return unwrapEnvelope(env).apps
    },
    staleTime: 60_000,
  })
}

/**
 * Apply a built-in project bundle template to create a new project.
 * Body: { bundleId, name, squadPath }
 */
export function useApplyBuiltinProjectTemplate() {
  const queryClient = useQueryClient()
  return useMutation<
    { id: string; name: string },
    Error,
    { bundleId: string; name: string; squadPath: string }
  >({
    mutationFn: async ({ bundleId, name, squadPath }) => {
      const env = await apiFetch<ApiEnvelope<{ project: { id: string; name: string } }>>(
        `/api/templates/builtin-projects/${bundleId}/apply`,
        { method: 'POST', body: JSON.stringify({ name, squadPath }) },
      )
      return unwrapEnvelope(env).project
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projects'] })
    },
  })
}

export function useApplySquadboardApp() {
  const queryClient = useQueryClient()
  return useMutation<
    { id: string; name: string },
    Error,
    { bundleId: string; name: string; squadPath: string }
  >({
    mutationFn: async ({ bundleId, name, squadPath }) => {
      const env = await apiFetch<ApiEnvelope<{ project: { id: string; name: string } }>>(
        `/api/templates/squadboard-apps/${bundleId}/apply`,
        { method: 'POST', body: JSON.stringify({ name, squadPath }) },
      )
      return unwrapEnvelope(env).project
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projects'] })
    },
  })
}

export function useInstallSquadboardAppFromGithub() {
  const queryClient = useQueryClient()
  return useMutation<
    { id: string; name: string },
    Error,
    { repoUrl: string; appPath?: string; ref?: string; name: string; squadPath: string }
  >({
    mutationFn: async ({ repoUrl, appPath, ref, name, squadPath }) => {
      const env = await apiFetch<ApiEnvelope<{ project: { id: string; name: string } }>>(
        '/api/templates/squadboard-apps/install-from-github',
        { method: 'POST', body: JSON.stringify({ repoUrl, appPath, ref, name, squadPath }) },
      )
      return unwrapEnvelope(env).project
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projects'] })
    },
  })
}

