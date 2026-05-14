import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from './client.ts'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Workflow {
  id: string
  projectId: string
  name: string
  description?: string
  templateSlug?: string
  yamlContent: string
  createdAt: string
}

export interface WorkflowRun {
  id: string
  issueId: string
  workflowId: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  currentStepIndex: number
  createdAt: string
  updatedAt: string
}

export interface WorkflowTemplate {
  slug: string
  name: string
  description: string
}

// ---------------------------------------------------------------------------
// Project workflows
// ---------------------------------------------------------------------------

export function useWorkflows(projectId: string) {
  return useQuery<Workflow[]>({
    queryKey: ['workflows', projectId],
    queryFn: () => apiFetch<Workflow[]>(`/api/projects/${projectId}/workflows`),
    enabled: Boolean(projectId),
  })
}

export function useCreateWorkflow(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation<Workflow, Error, { name: string; description?: string; yamlContent: string; templateSlug?: string }>({
    mutationFn: (input) =>
      apiFetch<Workflow>(`/api/projects/${projectId}/workflows`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['workflows', projectId] })
    },
  })
}

// ---------------------------------------------------------------------------
// Workflow attachment to an issue
// ---------------------------------------------------------------------------

export function useAttachWorkflow(projectId: string, issueId: string) {
  const queryClient = useQueryClient()
  return useMutation<void, Error, { workflowId: string }>({
    mutationFn: ({ workflowId }) =>
      apiFetch<void>(`/api/projects/${projectId}/issues/${issueId}/workflow`, {
        method: 'PUT',
        body: JSON.stringify({ workflowId }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['issues', projectId] })
    },
  })
}

// ---------------------------------------------------------------------------
// Workflow run (start / status)
// ---------------------------------------------------------------------------

export function useStartWorkflow(projectId: string, issueId: string) {
  const queryClient = useQueryClient()
  return useMutation<WorkflowRun, Error, void>({
    mutationFn: () =>
      apiFetch<WorkflowRun>(`/api/projects/${projectId}/issues/${issueId}/workflow/run`, {
        method: 'POST',
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['workflow-run', projectId, issueId] })
      void queryClient.invalidateQueries({ queryKey: ['issues', projectId] })
    },
  })
}

export function useWorkflowRun(projectId: string, issueId: string) {
  return useQuery<WorkflowRun | null>({
    queryKey: ['workflow-run', projectId, issueId],
    queryFn: () => apiFetch<WorkflowRun | null>(`/api/projects/${projectId}/issues/${issueId}/workflow/run`),
    enabled: Boolean(projectId) && Boolean(issueId),
    refetchInterval: (query) => {
      const data = query.state.data
      if (!data) return false
      return data.status === 'running' || data.status === 'pending' ? 3000 : false
    },
  })
}

// ---------------------------------------------------------------------------
// Single workflow (for editor)
// ---------------------------------------------------------------------------

export function useWorkflow(projectId: string, workflowId: string) {
  return useQuery<Workflow>({
    queryKey: ['workflows', projectId, workflowId],
    queryFn: () => apiFetch<Workflow>(`/api/projects/${projectId}/workflows/${workflowId}`),
    enabled: Boolean(projectId) && Boolean(workflowId),
  })
}

export function useUpdateWorkflow(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation<Workflow, Error, { workflowId: string; name?: string; yamlContent?: string }>({
    mutationFn: ({ workflowId, ...body }) =>
      apiFetch<Workflow>(`/api/projects/${projectId}/workflows/${workflowId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: (wf) => {
      void queryClient.invalidateQueries({ queryKey: ['workflows', projectId] })
      void queryClient.invalidateQueries({ queryKey: ['workflows', projectId, wf.id] })
    },
  })
}

// ---------------------------------------------------------------------------
// Bundled templates
// ---------------------------------------------------------------------------

export function useWorkflowTemplates() {
  return useQuery<WorkflowTemplate[]>({
    queryKey: ['workflow-templates'],
    queryFn: () => apiFetch<WorkflowTemplate[]>('/api/workflows/templates'),
  })
}
