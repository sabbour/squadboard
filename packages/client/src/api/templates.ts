/**
 * templates.ts — Phase 19 React Query hooks for user-created templates and
 * project/team/workflow portability (export · import · save-as-template).
 *
 * API contract (Hockney parallel):
 *   GET  /api/templates?kind=workflow|team|project
 *   GET  /api/templates/:id
 *   DELETE /api/templates/:id
 *   POST /api/projects/:id/team/export
 *   POST /api/projects/:id/team/import
 *   POST /api/projects/:id/team/save-as-template
 *   POST /api/projects/:id/team/instantiate-template/:templateId
 *   POST /api/projects/:id/export
 *   POST /api/projects/import
 *   POST /api/projects/:id/save-as-template
 *   POST /api/projects/instantiate-template/:templateId
 *   POST /api/projects/:id/ceremonies/:ceremonyId/save-as-template
 *   POST /api/projects/:id/ceremonies/instantiate-template/:templateId
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
}

export interface TemplateDetail extends TemplateSummary {
  payload: unknown
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
      const res = await apiFetch<{ templates: TemplateSummary[] }>(url)
      return res.templates ?? []
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
      const res = await apiFetch<{ template: TemplateDetail }>(`/api/templates/${id}`)
      return res.template
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
  return useMutation<{ ok: boolean }, Error, string>({
    mutationFn: (id) =>
      apiFetch<{ ok: boolean }>(`/api/templates/${id}`, { method: 'DELETE' }),
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
      const res = await apiFetch<{ payload: unknown }>(
        `/api/projects/${projectId}/team/export`,
        { method: 'POST' },
      )
      triggerDownload(res.payload, filename ?? `team-export-${projectId}.json`)
    },
  })
}

/** Import a team from a parsed JSON payload. */
export function useImportTeam() {
  const queryClient = useQueryClient()
  return useMutation<{ ok: boolean; imported: number }, Error, { projectId: string; payload: unknown }>({
    mutationFn: ({ projectId, payload }) =>
      apiFetch<{ ok: boolean; imported: number }>(
        `/api/projects/${projectId}/team/import`,
        { method: 'POST', body: JSON.stringify(payload) },
      ),
    onSuccess: (_data, { projectId }) => {
      void queryClient.invalidateQueries({ queryKey: ['agents', projectId] })
    },
  })
}

/** Save the current team roster as a named template. */
export function useSaveTeamAsTemplate(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation<
    { template: TemplateSummary },
    Error,
    { name: string; description?: string }
  >({
    mutationFn: (input) =>
      apiFetch<{ template: TemplateSummary }>(
        `/api/projects/${projectId}/team/save-as-template`,
        { method: 'POST', body: JSON.stringify(input) },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['templates'] })
    },
  })
}

/** Instantiate a team template into this project. */
export function useInstantiateTeamTemplate(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation<{ ok: boolean }, Error, { templateId: string }>({
    mutationFn: ({ templateId }) =>
      apiFetch<{ ok: boolean }>(
        `/api/projects/${projectId}/team/instantiate-template/${templateId}`,
        { method: 'POST' },
      ),
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
      const res = await apiFetch<{ payload: unknown }>(
        `/api/projects/${projectId}/export`,
        { method: 'POST' },
      )
      triggerDownload(res.payload, filename ?? `project-export-${projectId}.json`)
    },
  })
}

/** Import a project from a parsed JSON payload. Returns the created project. */
export function useImportProject() {
  const queryClient = useQueryClient()
  return useMutation<{ project: { id: string; name: string } }, Error, { payload: unknown }>({
    mutationFn: ({ payload }) =>
      apiFetch<{ project: { id: string; name: string } }>('/api/projects/import', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projects'] })
    },
  })
}

/** Save this project as a named template. */
export function useSaveProjectAsTemplate(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation<
    { template: TemplateSummary },
    Error,
    { name: string; description?: string }
  >({
    mutationFn: (input) =>
      apiFetch<{ template: TemplateSummary }>(
        `/api/projects/${projectId}/save-as-template`,
        { method: 'POST', body: JSON.stringify(input) },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['templates'] })
    },
  })
}

/** Create a new project from a project template. */
export function useInstantiateProjectTemplate() {
  const queryClient = useQueryClient()
  return useMutation<
    { project: { id: string; name: string } },
    Error,
    { templateId: string; name: string }
  >({
    mutationFn: ({ templateId, name }) =>
      apiFetch<{ project: { id: string; name: string } }>(
        `/api/projects/instantiate-template/${templateId}`,
        { method: 'POST', body: JSON.stringify({ name }) },
      ),
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
    { template: TemplateSummary },
    Error,
    { ceremonyId: string; name: string; description?: string }
  >({
    mutationFn: ({ ceremonyId, name, description }) =>
      apiFetch<{ template: TemplateSummary }>(
        `/api/projects/${projectId}/ceremonies/${ceremonyId}/save-as-template`,
        { method: 'POST', body: JSON.stringify({ name, description }) },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['templates'] })
    },
  })
}

/** Create a new ceremony from a workflow template. */
export function useInstantiateWorkflowTemplate(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation<{ ok: boolean }, Error, { templateId: string; name: string }>({
    mutationFn: ({ templateId, name }) =>
      apiFetch<{ ok: boolean }>(
        `/api/projects/${projectId}/ceremonies/instantiate-template/${templateId}`,
        { method: 'POST', body: JSON.stringify({ name }) },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ceremonies', projectId] })
    },
  })
}

/** Import a workflow from a raw JSON payload (drops into ceremonies list). */
export function useImportWorkflow() {
  const queryClient = useQueryClient()
  return useMutation<{ ok: boolean }, Error, { projectId: string; payload: unknown }>({
    mutationFn: ({ projectId, payload }) =>
      apiFetch<{ ok: boolean }>(
        `/api/projects/${projectId}/ceremonies/import`,
        { method: 'POST', body: JSON.stringify(payload) },
      ),
    onSuccess: (_data, { projectId }) => {
      void queryClient.invalidateQueries({ queryKey: ['ceremonies', projectId] })
    },
  })
}
