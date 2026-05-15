import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from './client.ts'

// Widened from a 5-value union to string — columns are now per-project and dynamic.
// Kept as a named alias for call-site clarity and migration safety.
export type ColumnId = string

export interface Label {
  id: string
  name: string
  color: string
}

export interface Assignee {
  id: string
  name: string
  avatarUrl?: string
}

export interface Issue {
  id: string
  projectId: string
  title: string
  body?: string
  column: ColumnId
  labels: Label[]
  assignee?: Assignee
  commentCount: number
  createdAt: string
  updatedAt: string
  /** Set when the issue was assigned by the deterministic routing engine. */
  autoRoutedTo?: string
  /** Human-readable summary of the rule that matched, e.g. "Matched: label:bug → hockney". */
  routingRuleSummary?: string
  /** ID of the workflow attached to this issue, if any. */
  attachedWorkflowId?: string
  /** Display name of the attached workflow. */
  attachedWorkflowName?: string
}

export interface CreateIssueInput {
  title: string
  body?: string
  column?: ColumnId
  labelIds?: string[]
  assigneeId?: string
}

export interface MoveIssueInput {
  column: ColumnId
  position?: number
}

export interface BulkActionInput {
  issueIds: string[]
  action: 'move' | 'label' | 'archive'
  column?: ColumnId
  labelId?: string
}

export function useIssues(projectId: string, filters?: { search?: string; labelId?: string; assigneeId?: string }) {
  const params = new URLSearchParams()
  if (filters?.labelId) params.set('label', filters.labelId)
  if (filters?.assigneeId) params.set('assignee', filters.assigneeId)
  const qs = params.toString() ? `?${params.toString()}` : ''

  return useQuery<Issue[]>({
    queryKey: ['issues', projectId, filters],
    queryFn: () => apiFetch<Issue[]>(`/api/projects/${projectId}/issues${qs}`),
    enabled: Boolean(projectId),
  })
}

export function useCreateIssue(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation<Issue, Error, CreateIssueInput>({
    mutationFn: (input) =>
      apiFetch<Issue>(`/api/projects/${projectId}/issues`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['issues', projectId] })
    },
  })
}

export function useMoveIssue(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation<Issue, Error, { issueId: string } & MoveIssueInput>({
    mutationFn: ({ issueId, ...input }) =>
      apiFetch<Issue>(`/api/projects/${projectId}/issues/${issueId}/move`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['issues', projectId] })
    },
  })
}

export function useBulkAction(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation<void, Error, BulkActionInput>({
    mutationFn: (input) =>
      apiFetch<void>(`/api/projects/${projectId}/issues/bulk`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['issues', projectId] })
    },
  })
}

// ---------------------------------------------------------------------------
// Formulate (AI-author an issue draft from prose)
// ---------------------------------------------------------------------------

export interface FormulateModelInfo {
  model: string
  via: 'session' | 'agent' | 'project' | 'fallback'
}

export interface FormulatedIssueDraft {
  title: string
  body: string
  suggestedColumn: ColumnId
  suggestedLabels: string[]
  rationale: string
}

export interface FormulateIssueResult {
  issue: FormulatedIssueDraft
  modelUsed: FormulateModelInfo
}

type Envelope<T> = { ok: boolean; data: T }

export function useFormulateIssue(projectId: string) {
  return useMutation<FormulateIssueResult, Error, string>({
    mutationFn: (draft) =>
      apiFetch<Envelope<FormulateIssueResult>>(
        `/api/projects/${projectId}/issues/formulate`,
        { method: 'POST', body: JSON.stringify({ draft }) },
      ).then((r) => r.data),
  })
}
