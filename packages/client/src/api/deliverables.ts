import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from './client.ts'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DeliverableKind = 'text' | 'files' | 'links' | 'structured'
export type DeliverableStatus =
  | 'draft'
  | 'submitted'
  | 'approved'
  | 'changes_requested'
  | 'superseded'

export interface DeliverableTextPayload {
  text: string
  format?: 'markdown' | 'plain'
}

export interface DeliverableFilePayload {
  files: Array<{ path: string; language?: string; content: string }>
}

export interface DeliverableLinksPayload {
  links: Array<{ url: string; label?: string }>
}

export interface DeliverableStructuredPayload {
  structured: unknown
  schemaName?: string
}

export type DeliverablePayload =
  | DeliverableTextPayload
  | DeliverableFilePayload
  | DeliverableLinksPayload
  | DeliverableStructuredPayload
  | Record<string, unknown>

export interface Deliverable {
  id: string
  issueId: string
  runId: string | null
  stepRunId: string | null
  kind: DeliverableKind
  title: string
  summary: string | null
  payload: DeliverablePayload
  status: DeliverableStatus
  producedAt: string | null
  supersededByDeliverableId: string | null
  createdAt: string
  updatedAt: string
}

export interface DeliverableReview {
  id: string
  deliverableId: string
  reviewerAgentId: string | null
  reviewerName: string | null
  verb: 'approve' | 'request_changes' | 'comment' | 'dismiss'
  body: string | null
  suggestions: string[] | null
  createdAt: string
}

export interface DeliverableWithReviews extends Deliverable {
  reviews: DeliverableReview[]
}

export interface CreateDeliverableInput {
  issueId: string
  runId?: string | null
  stepRunId?: string | null
  kind: DeliverableKind
  title: string
  summary?: string
  payload: DeliverablePayload
  status?: DeliverableStatus
}

export interface ReviewDeliverableInput {
  verb: 'approve' | 'request_changes' | 'comment' | 'dismiss'
  reviewerAgentId?: string | null
  reviewerName?: string
  body?: string
  suggestions?: string[]
  spawnRevision?: { agentId?: string; body?: string }
}

export interface PeerReviewInput {
  agentId?: string
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function useDeliverables(projectId: string, issueId: string) {
  return useQuery<Deliverable[]>({
    queryKey: ['deliverables', projectId, issueId],
    queryFn: () =>
      apiFetch<Deliverable[]>(
        `/api/projects/${projectId}/issues/${issueId}/deliverables`,
      ),
    enabled: Boolean(projectId && issueId),
    refetchInterval: 5_000,
  })
}

export function useDeliverable(projectId: string, deliverableId: string | null) {
  return useQuery<DeliverableWithReviews>({
    queryKey: ['deliverable', projectId, deliverableId],
    queryFn: () =>
      apiFetch<DeliverableWithReviews>(
        `/api/projects/${projectId}/deliverables/${deliverableId}`,
      ),
    enabled: Boolean(projectId && deliverableId),
    refetchInterval: 5_000,
  })
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export function useCreateDeliverable(projectId: string) {
  const qc = useQueryClient()
  return useMutation<Deliverable, Error, CreateDeliverableInput>({
    mutationFn: (input) =>
      apiFetch<Deliverable>(`/api/projects/${projectId}/deliverables`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['deliverables', projectId, vars.issueId] })
    },
  })
}

export function useReviewDeliverable(projectId: string, deliverableId: string) {
  const qc = useQueryClient()
  return useMutation<
    {
      event: DeliverableReview
      newStatus: DeliverableStatus
      revisionRunId: string | null
    },
    Error,
    ReviewDeliverableInput
  >({
    mutationFn: (input) =>
      apiFetch(`/api/projects/${projectId}/deliverables/${deliverableId}/review`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['deliverable', projectId, deliverableId] })
      void qc.invalidateQueries({ queryKey: ['deliverables', projectId] })
      void qc.invalidateQueries({ queryKey: ['comments', projectId] })
    },
  })
}

export function useRequestPeerReview(projectId: string, deliverableId: string) {
  const qc = useQueryClient()
  return useMutation<{ runId: string; agentId: string; agentName: string }, Error, PeerReviewInput>({
    mutationFn: (input) =>
      apiFetch(`/api/projects/${projectId}/deliverables/${deliverableId}/peer-review`, {
        method: 'POST',
        body: JSON.stringify(input ?? {}),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['deliverable', projectId, deliverableId] })
      void qc.invalidateQueries({ queryKey: ['deliverables', projectId] })
    },
  })
}
