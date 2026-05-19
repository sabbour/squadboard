import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from './client.ts'

export type RalphMonitorState = 'active' | 'paused' | 'idle' | 'stopped'

export interface RalphMonitorActionSummary {
  type: string
  label: string
  outcome?: string
  targetId?: string
  targetType?: string
  runId?: string
  detail?: string
  at: string
}

export interface RalphMonitorStatus {
  projectId: string
  autonomyEnabled: boolean
  autoMergeEnabled: boolean
  state: RalphMonitorState
  lastAction: RalphMonitorActionSummary | null
  nextAction: RalphMonitorActionSummary | null
  lastDecisionAt: string | null
}

export interface UpdateRalphMonitorInput {
  enabled?: boolean
  autoMergeEnabled?: boolean
  state?: RalphMonitorState
}

export function useRalphMonitor(projectId: string) {
  return useQuery<RalphMonitorStatus>({
    queryKey: ['projects', projectId, 'ralph-monitor'],
    queryFn: () => apiFetch<RalphMonitorStatus>(`/api/projects/${projectId}/ralph-monitor`),
    enabled: Boolean(projectId),
  })
}

export function useUpdateRalphMonitor(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation<RalphMonitorStatus, Error, UpdateRalphMonitorInput>({
    mutationFn: (input) =>
      apiFetch<RalphMonitorStatus>(`/api/projects/${projectId}/ralph-monitor`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'ralph-monitor'] })
      void queryClient.invalidateQueries({ queryKey: ['projects', projectId] })
    },
  })
}

export function useRunRalphMonitorSweep(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () =>
      apiFetch(`/api/projects/${projectId}/ralph-monitor/sweep`, {
        method: 'POST',
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'ralph-monitor'] })
    },
  })
}
