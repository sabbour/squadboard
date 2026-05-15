import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from './client.ts'

export type RequestChangesPolicy = 'first' | 'majority' | 'all'
export type TimeoutAction = 'auto_approve' | 'auto_reject' | 'escalate' | 'notify'
export type ApproverKind = 'agent' | 'human' | 'role'

export interface TypedApprover {
  kind: ApproverKind
  ref: string
}

export interface ReviewPolicyPayload {
  approvers?: string[]
  approver_objects?: TypedApprover[]
  request_changes_policy?: RequestChangesPolicy
  quorum?: { n: number; of: number }
  exclude_author?: boolean
  timeout?: string
  timeout_action?: TimeoutAction
  fallback_reviewer?: string
}

export interface ResolvedReviewPolicy {
  approvers: string[]
  approver_objects: TypedApprover[]
  request_changes_policy: RequestChangesPolicy
  quorum: { n: number; of: number } | null
  exclude_author: boolean
  timeout: string
  timeout_action: TimeoutAction
  fallback_reviewer: string | null
}

export type PolicyFieldSource = 'step' | 'board' | 'project' | 'system_default'

export type PolicySources = Record<keyof ResolvedReviewPolicy, PolicyFieldSource>

export interface ReviewPolicyPreset {
  id: string
  scope: 'system' | 'project'
  projectId: string | null
  slug: string
  name: string
  description: string | null
  payload: ReviewPolicyPayload
  createdAt: string
  updatedAt: string
}

export interface ReviewPolicyDefaultRow {
  id: string
  scope: 'project' | 'board'
  scopeId: string
  payload: ReviewPolicyPayload
  createdAt: string
  updatedAt: string
}

export interface ReviewPolicyDefaultResponse {
  stored: ReviewPolicyPayload | null
  resolved: ResolvedReviewPolicy
  sources: PolicySources
  warnings: string[]
}

type Envelope<T> = { ok: boolean; data: T }
const unwrap = <T>(r: Envelope<T>): T => r.data

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

export function useReviewPolicyPresets(projectId: string) {
  return useQuery<{ system: ReviewPolicyPreset[]; project: ReviewPolicyPreset[] }>({
    queryKey: ['review-policies', projectId, 'presets'],
    queryFn: () =>
      apiFetch<Envelope<{ system: ReviewPolicyPreset[]; project: ReviewPolicyPreset[] }>>(
        `/api/projects/${projectId}/review-policies/presets`,
      ).then(unwrap),
    staleTime: 30_000,
    enabled: Boolean(projectId),
  })
}

export interface CreatePresetInput {
  slug: string
  name: string
  description?: string
  payload: ReviewPolicyPayload
}

export function useCreateReviewPolicyPreset(projectId: string) {
  const qc = useQueryClient()
  return useMutation<ReviewPolicyPreset, Error, CreatePresetInput>({
    mutationFn: (input) =>
      apiFetch<Envelope<ReviewPolicyPreset>>(
        `/api/projects/${projectId}/review-policies/presets`,
        { method: 'POST', body: JSON.stringify(input) },
      ).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['review-policies', projectId, 'presets'] }),
  })
}

export interface UpdatePresetInput {
  slug: string
  name?: string
  description?: string
  payload?: ReviewPolicyPayload
}

export function useUpdateReviewPolicyPreset(projectId: string) {
  const qc = useQueryClient()
  return useMutation<ReviewPolicyPreset, Error, UpdatePresetInput>({
    mutationFn: ({ slug, ...body }) =>
      apiFetch<Envelope<ReviewPolicyPreset>>(
        `/api/projects/${projectId}/review-policies/presets/${slug}`,
        { method: 'PATCH', body: JSON.stringify(body) },
      ).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['review-policies', projectId, 'presets'] }),
  })
}

export function useDeleteReviewPolicyPreset(projectId: string) {
  const qc = useQueryClient()
  return useMutation<{ ok: true }, Error, string>({
    mutationFn: (slug) =>
      apiFetch<{ ok: true }>(
        `/api/projects/${projectId}/review-policies/presets/${slug}`,
        { method: 'DELETE' },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['review-policies', projectId, 'presets'] }),
  })
}

// ---------------------------------------------------------------------------
// Project default
// ---------------------------------------------------------------------------

export function useReviewPolicyDefault(projectId: string) {
  return useQuery<ReviewPolicyDefaultResponse>({
    queryKey: ['review-policies', projectId, 'default'],
    queryFn: () =>
      apiFetch<Envelope<ReviewPolicyDefaultResponse>>(
        `/api/projects/${projectId}/review-policies/default`,
      ).then(unwrap),
    staleTime: 30_000,
    enabled: Boolean(projectId),
  })
}

export function useSetReviewPolicyDefault(projectId: string) {
  const qc = useQueryClient()
  return useMutation<ReviewPolicyDefaultRow, Error, ReviewPolicyPayload>({
    mutationFn: (payload) =>
      apiFetch<Envelope<ReviewPolicyDefaultRow>>(
        `/api/projects/${projectId}/review-policies/default`,
        { method: 'PUT', body: JSON.stringify({ payload }) },
      ).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['review-policies', projectId, 'default'] }),
  })
}

export function useClearReviewPolicyDefault(projectId: string) {
  const qc = useQueryClient()
  return useMutation<{ ok: true }, Error, void>({
    mutationFn: () =>
      apiFetch<{ ok: true }>(
        `/api/projects/${projectId}/review-policies/default`,
        { method: 'DELETE' },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['review-policies', projectId, 'default'] }),
  })
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

export function describePolicy(policy: ResolvedReviewPolicy): string {
  const parts: string[] = []
  if (policy.quorum) {
    parts.push(`quorum ${policy.quorum.n}/${policy.quorum.of}`)
  } else if (policy.approvers.length > 0) {
    parts.push(`${policy.approvers.length} approver${policy.approvers.length === 1 ? '' : 's'}`)
  } else {
    parts.push('any approver')
  }

  if (policy.request_changes_policy === 'all') parts.push('all must approve')
  else if (policy.request_changes_policy === 'majority') parts.push('majority blocks')
  else parts.push('first request_changes blocks')

  if (policy.exclude_author) parts.push('author excluded')

  parts.push(`timeout ${policy.timeout}`)
  if (policy.timeout_action !== 'notify') {
    if (policy.timeout_action === 'escalate' && policy.fallback_reviewer) {
      parts.push(`→ escalate to ${policy.fallback_reviewer}`)
    } else {
      parts.push(`→ ${policy.timeout_action}`)
    }
  }

  return parts.join(' · ')
}
