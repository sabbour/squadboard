import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { apiFetch } from './client.ts'

export type RunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
export type WorkspaceStrategy = 'scratch' | 'dir' | 'worktree'
export type RunKind = 'agent_run' | 'route' | 'peer_review' | 'approve'
export type RoutingTier = 'T1' | 'T2' | 'T3'

export interface RunOwnershipContext {
  project: {
    id: string
    name: string
    path: string
  }
  issue: {
    id: string
    title: string
    status: string
    githubIssueNumber?: number | null
    githubIssueUrl?: string | null
  }
  workflow: {
    id: string
    name: string | null
    slug: string | null
    kind: string | null
    triggerKind: string | null
    versionId: string | null
    version: number | null
  } | null
  workflowRun: {
    id: string
    status: string | null
    currentStepIndex: number | null
    parentWorkflowRunId: string | null
    triggerSource: unknown
  } | null
  stepRun: {
    id: string
    stepIndex: number | null
    stepType: string | null
    status: string | null
  } | null
  parent: {
    workflowRunId: string | null
    issueRunId: string | null
  }
  actions: {
    canRetrigger: boolean
    retriggerBlockedReason: string | null
    retriggerUrl: string
    liveUrl: string
    issueUrl: string
    projectUrl: string
  }
}

export interface IssueRun {
  id: string
  issueId: string
  agentId: string
  status: RunStatus
  kind?: RunKind
  routingTier?: RoutingTier
  workspaceStrategy: WorkspaceStrategy
  workspacePath?: string
  output?: string
  errorMessage?: string
  costTokens?: number
  costUsd?: string
  createdAt?: string | null
  updatedAt?: string | null
  startedAt?: string | null
  completedAt?: string | null
  finishedAt?: string | null
  durationMs?: number | null
  leaseExpiresAt?: string | null
  heartbeatAt?: string | null
  context?: RunOwnershipContext | null
}

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

export function useIssueRuns(projectId: string, issueId: string) {
  return useQuery<IssueRun[]>({
    queryKey: ['runs', projectId, issueId],
    queryFn: () => apiFetch<IssueRun[]>(`/api/projects/${projectId}/issues/${issueId}/runs`),
    enabled: Boolean(projectId) && Boolean(issueId),
    refetchInterval: 5000,
  })
}

export function useRun(projectId: string, runId: string) {
  return useQuery<IssueRun>({
    queryKey: ['runs', projectId, 'detail', runId],
    queryFn: () => apiFetch<IssueRun>(`/api/projects/${projectId}/runs/${runId}`),
    enabled: Boolean(projectId) && Boolean(runId),
    refetchInterval: (query) => {
      const data = query.state.data
      if (!data) return 3000
      return data.status === 'running' || data.status === 'pending' ? 3000 : false
    },
  })
}

export function useStartRun(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation<IssueRun, Error, { issueId: string; agentId: string; workspaceStrategy?: WorkspaceStrategy }>({
    mutationFn: ({ issueId, ...body }) =>
      apiFetch<IssueRun>(`/api/projects/${projectId}/issues/${issueId}/runs`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: (run) => {
      void queryClient.invalidateQueries({ queryKey: ['runs', projectId, run.issueId] })
    },
  })
}

export function useCancelRun(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation<void, Error, { runId: string; issueId: string }>({
    mutationFn: ({ runId }) =>
      apiFetch<void>(`/api/projects/${projectId}/runs/${runId}/cancel`, { method: 'POST' }),
    onSuccess: (_, { issueId }) => {
      void queryClient.invalidateQueries({ queryKey: ['runs', projectId, issueId] })
      void queryClient.invalidateQueries({ queryKey: ['runs', projectId, 'detail'] })
    },
  })
}

export function useRetriggerRun(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation<IssueRun & { retriggeredFromRunId?: string }, Error, { runId: string; issueId: string }>({
    mutationFn: ({ runId, issueId }) =>
      apiFetch<IssueRun & { retriggeredFromRunId?: string }>(
        `/api/projects/${projectId}/issues/${issueId}/runs/${runId}/retrigger`,
        { method: 'POST' },
      ),
    onSuccess: (run, { issueId }) => {
      void queryClient.invalidateQueries({ queryKey: ['runs', projectId, issueId] })
      void queryClient.invalidateQueries({ queryKey: ['runs', projectId, 'detail', run.id] })
    },
  })
}

export function useRunStream(projectId: string, runId: string, enabled: boolean) {
  const [lines, setLines] = useState<string[]>([])

  useEffect(() => {
    if (!enabled || !runId || !projectId) return
    setLines([])
    const es = new EventSource(`${BASE}/api/projects/${projectId}/runs/${runId}/stream`)
    es.onmessage = (e) => setLines((prev) => [...prev, e.data as string])
    es.onerror = () => es.close()
    return () => es.close()
  }, [projectId, runId, enabled])

  return lines
}
