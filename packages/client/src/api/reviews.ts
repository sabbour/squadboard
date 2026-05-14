import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from './client.ts'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReviewVerb = 'approve' | 'request_changes' | 'comment' | 'dismiss'
export type ReviewDecision = 'approved' | 'changes_requested' | 'pending'

export interface ReviewEvent {
  id: string
  agentId: string
  agentName: string
  verb: ReviewVerb
  comment?: string
  suggestions?: string[]
  createdAt: string
}

export interface ReviewPolicy {
  kind: 'first_veto' | 'majority' | 'all_must_approve'
  required?: number
  total?: number
}

export interface WorkflowRunReviews {
  stepRunId: string
  stepLabel?: string
  policy?: ReviewPolicy
  decision: ReviewDecision
  events: ReviewEvent[]
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function useWorkflowRunReviews(workflowRunId: string) {
  return useQuery<WorkflowRunReviews[]>({
    queryKey: ['reviews', 'workflow-run', workflowRunId],
    queryFn: () => apiFetch<WorkflowRunReviews[]>(`/api/workflow-runs/${workflowRunId}/reviews`),
    enabled: Boolean(workflowRunId),
    refetchInterval: 5_000,
  })
}

export function useSubmitReview(stepRunId: string) {
  const queryClient = useQueryClient()
  return useMutation<ReviewEvent, Error, { verb: ReviewVerb; comment?: string; suggestions?: string[] }>({
    mutationFn: (body) =>
      apiFetch<ReviewEvent>(`/api/step-runs/${stepRunId}/review`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['reviews'] })
    },
  })
}
