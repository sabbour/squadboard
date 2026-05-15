/**
 * api/ceremonies.ts — Phase 10 ceremony hooks.
 *
 * Mirrors the new /api/projects/:projectId/ceremonies surface introduced
 * in Phase 10. The legacy api/workflows.ts file is now a thin re-export
 * shim — new code should import from here.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from './client.ts'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TriggerKind = 'on_issue_entry' | 'on_schedule' | 'on_event' | 'manual'
export type CeremonyKind = 'workflow' | 'ceremony' | 'review_policy' | 'narrative'

export type CeremonyStatus = 'active' | 'draft' | 'paused' | 'archived'

export interface Ceremony {
  id: string
  projectId: string
  name: string
  slug: string
  description?: string | null
  triggerKind: TriggerKind
  triggerConfig: Record<string, unknown>
  kind: CeremonyKind
  // Phase 11
  status?: CeremonyStatus
  parentNarrativeId?: string | null
  lastTranslationError?: string | null
  lastTranslationAttemptAt?: string | null
  createdAt: string
  updatedAt: string
}

export interface CeremonyVersion {
  id: string
  workflowId: string
  version: number
  yamlContent: string
  jsonSchema?: string | null
  pinnedAgentRevisions?: string | null
  isActive: boolean
  createdAt: string
}

export interface CeremonyDetail {
  ceremony: Ceremony
  activeVersion: CeremonyVersion | null
  versions: CeremonyVersion[]
}

export interface CeremonySchedule {
  id: string
  workflowId: string
  cronExpr: string
  timezone: string
  nextFireAt: string
  lastFiredAt: string | null
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export interface CeremonyTemplate {
  slug: string
  name: string
  description: string
  tags?: string[]
  yamlContent?: string
}

// Compatibility re-exports for callers that imported the legacy "Workflow" type
export type Workflow = Ceremony
export type WorkflowTemplate = CeremonyTemplate

export interface WorkflowRun {
  id: string
  issueId: string
  workflowVersionId: string | null
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'splitting' | 'waiting_children'
  currentStepIndex: number | null
  createdAt: string
  updatedAt: string
}

// ---------------------------------------------------------------------------
// Project ceremonies
// ---------------------------------------------------------------------------

export function useCeremonies(projectId: string, filters?: { kind?: CeremonyKind; triggerKind?: TriggerKind }) {
  const params = new URLSearchParams()
  if (filters?.kind) params.set('kind', filters.kind)
  if (filters?.triggerKind) params.set('triggerKind', filters.triggerKind)
  const qs = params.toString()
  return useQuery<Ceremony[]>({
    queryKey: ['ceremonies', projectId, filters ?? null],
    queryFn: () =>
      apiFetch<Ceremony[]>(
        `/api/projects/${projectId}/ceremonies${qs ? `?${qs}` : ''}`,
      ),
    enabled: Boolean(projectId),
  })
}

export function useCeremony(projectId: string, ceremonyId: string) {
  return useQuery<CeremonyDetail>({
    queryKey: ['ceremonies', projectId, ceremonyId],
    queryFn: () =>
      apiFetch<CeremonyDetail>(`/api/projects/${projectId}/ceremonies/${ceremonyId}`),
    enabled: Boolean(projectId) && Boolean(ceremonyId),
  })
}

export interface CeremonyCreateInput {
  yamlContent: string
  triggerKind?: TriggerKind
  triggerConfig?: Record<string, unknown>
  kind?: CeremonyKind
}

export function useCreateCeremony(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation<{ ceremony: Ceremony; version: CeremonyVersion }, Error, CeremonyCreateInput>({
    mutationFn: (input) =>
      apiFetch<{ ceremony: Ceremony; version: CeremonyVersion }>(
        `/api/projects/${projectId}/ceremonies`,
        { method: 'POST', body: JSON.stringify(input) },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ceremonies', projectId] })
    },
  })
}

export interface CeremonyPatchInput {
  ceremonyId: string
  name?: string
  description?: string | null
  triggerKind?: TriggerKind
  triggerConfig?: Record<string, unknown>
  kind?: CeremonyKind
  yamlContent?: string
}

export function useUpdateCeremony(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation<{ ceremony: Ceremony; version: CeremonyVersion | null }, Error, CeremonyPatchInput>({
    mutationFn: ({ ceremonyId, ...body }) =>
      apiFetch<{ ceremony: Ceremony; version: CeremonyVersion | null }>(
        `/api/projects/${projectId}/ceremonies/${ceremonyId}`,
        { method: 'PATCH', body: JSON.stringify(body) },
      ),
    onSuccess: (resp) => {
      void queryClient.invalidateQueries({ queryKey: ['ceremonies', projectId] })
      void queryClient.invalidateQueries({ queryKey: ['ceremonies', projectId, resp.ceremony.id] })
    },
  })
}

export function useDeleteCeremony(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation<void, Error, string>({
    mutationFn: (ceremonyId) =>
      apiFetch<void>(`/api/projects/${projectId}/ceremonies/${ceremonyId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ceremonies', projectId] })
    },
  })
}

export function useRunCeremony(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation<{ workflowRunId: string }, Error, { ceremonyId: string; anchorIssueId?: string }>({
    mutationFn: ({ ceremonyId, anchorIssueId }) =>
      apiFetch<{ workflowRunId: string }>(
        `/api/projects/${projectId}/ceremonies/${ceremonyId}/run`,
        { method: 'POST', body: JSON.stringify(anchorIssueId ? { anchorIssueId } : {}) },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ceremonies', projectId] })
    },
  })
}

export function usePreviewCron(projectId: string) {
  return useMutation<
    { cronExpr: string; timezone: string; next: string[] },
    Error,
    { ceremonyId: string; cronExpr: string; timezone?: string; count?: number }
  >({
    mutationFn: ({ ceremonyId, ...body }) =>
      apiFetch<{ cronExpr: string; timezone: string; next: string[] }>(
        `/api/projects/${projectId}/ceremonies/${ceremonyId}/preview-cron`,
        { method: 'POST', body: JSON.stringify(body) },
      ),
  })
}

export function useConvertCeremony(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation<ConvertCeremonyResult, Error, string>({
    mutationFn: (ceremonyId) =>
      apiFetch<ConvertCeremonyResult>(
        `/api/projects/${projectId}/ceremonies/${ceremonyId}/convert`,
        { method: 'POST' },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ceremonies', projectId] })
    },
  })
}

// Phase 11 — translation result + activate / retry / import hooks.
export interface ConvertCeremonyResult {
  narrativeId: string
  draftCeremonyId: string
  yamlContent: string
  triggerKind: TriggerKind
  triggerConfig: Record<string, unknown>
  rationale: string
  warnings: string[]
}

export function useActivateCeremony(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation<{ ceremony: Ceremony }, Error, string>({
    mutationFn: (ceremonyId) =>
      apiFetch<{ ceremony: Ceremony }>(
        `/api/projects/${projectId}/ceremonies/${ceremonyId}/activate`,
        { method: 'POST' },
      ),
    onSuccess: (resp) => {
      void queryClient.invalidateQueries({ queryKey: ['ceremonies', projectId] })
      void queryClient.invalidateQueries({ queryKey: ['ceremonies', projectId, resp.ceremony.id] })
    },
  })
}

export function useTranslateCeremony(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation<ConvertCeremonyResult, Error, string>({
    mutationFn: (ceremonyId) =>
      apiFetch<ConvertCeremonyResult>(
        `/api/projects/${projectId}/ceremonies/${ceremonyId}/translate`,
        { method: 'POST' },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ceremonies', projectId] })
    },
  })
}

export interface ImportNarrativeInput {
  projectId: string
  name?: string
  markdown: string
  description?: string | null
}

export interface ImportNarrativeResult {
  narrativeId: string
  draftCeremonyId?: string
  yamlContent?: string
  triggerKind?: TriggerKind
  triggerConfig?: Record<string, unknown>
  rationale?: string
  warnings?: string[]
  error?: string
  retryable?: boolean
}

export function useImportNarrative() {
  const queryClient = useQueryClient()
  return useMutation<ImportNarrativeResult, Error, ImportNarrativeInput>({
    mutationFn: (input) =>
      apiFetch<ImportNarrativeResult>(`/api/ceremonies/import-narrative`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: (_resp, input) => {
      void queryClient.invalidateQueries({ queryKey: ['ceremonies', input.projectId] })
    },
  })
}

/**
 * Returns ceremonies in 'draft' status (the review queue) — i.e. translator
 * output that has not yet been activated, plus any narratives whose
 * translations failed and are awaiting retry.
 */
export function useDraftCeremonies(projectId: string) {
  return useQuery<Ceremony[]>({
    queryKey: ['ceremonies', projectId, 'drafts'],
    queryFn: async () => {
      const all = await apiFetch<Ceremony[]>(`/api/projects/${projectId}/ceremonies`)
      return (all ?? []).filter((c) => (c as Ceremony & { status?: string }).status === 'draft')
    },
    enabled: Boolean(projectId),
  })
}

// ---------------------------------------------------------------------------
// Schedules
// ---------------------------------------------------------------------------

export function useCeremonySchedules(projectId: string, ceremonyId: string) {
  return useQuery<CeremonySchedule[]>({
    queryKey: ['ceremony-schedules', projectId, ceremonyId],
    queryFn: () =>
      apiFetch<CeremonySchedule[]>(
        `/api/projects/${projectId}/ceremonies/${ceremonyId}/schedules`,
      ),
    enabled: Boolean(projectId) && Boolean(ceremonyId),
  })
}

export function useCreateSchedule(projectId: string, ceremonyId: string) {
  const queryClient = useQueryClient()
  return useMutation<CeremonySchedule, Error, { cronExpr: string; timezone?: string; enabled?: boolean }>({
    mutationFn: (input) =>
      apiFetch<CeremonySchedule>(
        `/api/projects/${projectId}/ceremonies/${ceremonyId}/schedules`,
        { method: 'POST', body: JSON.stringify(input) },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ceremony-schedules', projectId, ceremonyId] })
    },
  })
}

export function useUpdateSchedule(projectId: string, ceremonyId: string) {
  const queryClient = useQueryClient()
  return useMutation<CeremonySchedule, Error, { scheduleId: string; cronExpr?: string; timezone?: string; enabled?: boolean }>({
    mutationFn: ({ scheduleId, ...body }) =>
      apiFetch<CeremonySchedule>(
        `/api/projects/${projectId}/ceremonies/${ceremonyId}/schedules/${scheduleId}`,
        { method: 'PATCH', body: JSON.stringify(body) },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ceremony-schedules', projectId, ceremonyId] })
    },
  })
}

export function useDeleteSchedule(projectId: string, ceremonyId: string) {
  const queryClient = useQueryClient()
  return useMutation<void, Error, string>({
    mutationFn: (scheduleId) =>
      apiFetch<void>(
        `/api/projects/${projectId}/ceremonies/${ceremonyId}/schedules/${scheduleId}`,
        { method: 'DELETE' },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ceremony-schedules', projectId, ceremonyId] })
    },
  })
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function useValidateCeremony() {
  return useMutation<{ valid: boolean; errors: string[] }, Error, string>({
    mutationFn: (yamlContent) =>
      apiFetch<{ valid: boolean; errors: string[] }>(`/api/ceremonies/validate`, {
        method: 'POST',
        body: JSON.stringify({ yamlContent }),
      }),
  })
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export function useCeremonyTemplates() {
  return useQuery<CeremonyTemplate[]>({
    queryKey: ['ceremony-templates'],
    queryFn: async () => {
      const resp = await apiFetch<{ ok: boolean; data: CeremonyTemplate[] } | CeremonyTemplate[]>(
        '/api/ceremonies/templates',
      )
      if (Array.isArray(resp)) return resp
      return resp.data ?? []
    },
  })
}

// ---------------------------------------------------------------------------
// Per-issue attachment + run (kept on the legacy issueWorkflow surface for now;
// not renamed in Phase 10 since the issue ↔ workflow attachment is its own
// concept that the spec leaves alone).
// ---------------------------------------------------------------------------

export function useAttachCeremony(projectId: string, issueId: string) {
  const queryClient = useQueryClient()
  return useMutation<void, Error, { workflowVersionId: string }>({
    mutationFn: (body) =>
      apiFetch<void>(`/api/projects/${projectId}/issues/${issueId}/workflow`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['issues', projectId] })
    },
  })
}

export function useStartCeremony(projectId: string, issueId: string) {
  const queryClient = useQueryClient()
  return useMutation<{ workflowRunId: string }, Error, void>({
    mutationFn: () =>
      apiFetch<{ workflowRunId: string }>(
        `/api/projects/${projectId}/issues/${issueId}/workflow/start`,
        { method: 'POST' },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['workflow-run', projectId, issueId] })
      void queryClient.invalidateQueries({ queryKey: ['issues', projectId] })
    },
  })
}

export function useCeremonyRun(projectId: string, issueId: string) {
  return useQuery<WorkflowRun | null>({
    queryKey: ['workflow-run', projectId, issueId],
    queryFn: () =>
      apiFetch<WorkflowRun | null>(
        `/api/projects/${projectId}/issues/${issueId}/workflow/run`,
      ),
    enabled: Boolean(projectId) && Boolean(issueId),
    refetchInterval: (query) => {
      const data = query.state.data
      if (!data) return false
      return data.status === 'running' || data.status === 'pending' ? 3000 : false
    },
  })
}
