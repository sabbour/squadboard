import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from './client.ts'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RoutingTier = 'T1' | 'T2' | 'T3'

export interface RoutingLogEntry {
  id: string
  timestamp: string
  issueId: string
  issueTitle: string
  tier: RoutingTier
  matchedRule?: string
  agentAssigned?: string
  agentName?: string
  score?: number
}

export interface RoutingStats {
  tier1Count: number
  tier2Count: number
  tier2AvgScore?: number
  tier3Count: number
  triageCount: number
  total: number
}

export interface TestRoutingResult {
  matched: boolean
  tier?: RoutingTier
  agentName?: string | null
  agentId?: string | null
  matchedRule?: string | null
  score?: number | null
  reasoning?: string | null
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function useRoutingLog(projectId: string) {
  return useQuery<RoutingLogEntry[]>({
    queryKey: ['routing', projectId, 'log'],
    queryFn: () => apiFetch<RoutingLogEntry[]>(`/api/projects/${projectId}/routing/log`),
    enabled: Boolean(projectId),
    refetchInterval: 10_000,
  })
}

export function useRoutingStats(projectId: string) {
  return useQuery<RoutingStats>({
    queryKey: ['routing', projectId, 'stats'],
    queryFn: () => apiFetch<RoutingStats>(`/api/projects/${projectId}/routing/stats`),
    enabled: Boolean(projectId),
    refetchInterval: 15_000,
  })
}

export function useTestRouting(projectId: string) {
  return useMutation<TestRoutingResult, Error, { title: string; labels?: string[] }>({
    mutationFn: ({ title, labels = [] }) =>
      apiFetch<TestRoutingResult>(`/api/projects/${projectId}/routing/test`, {
        method: 'POST',
        body: JSON.stringify({ title, labels }),
      }),
  })
}

export function useRefreshKeywords(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation<void, Error, void>({
    mutationFn: () =>
      apiFetch<void>(`/api/projects/${projectId}/routing/keywords/refresh`, { method: 'POST' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['routing', projectId] })
    },
  })
}
