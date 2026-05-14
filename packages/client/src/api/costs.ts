import { useQuery } from '@tanstack/react-query'
import { apiFetch } from './client.ts'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentCost {
  agentId: string
  agentName: string
  runs: number
  totalUsd: number
  avgUsdPerRun: number
}

export interface ModelCost {
  model: string
  runs: number
  tokensIn: number
  tokensOut: number
  totalUsd: number
}

export interface CostSummary {
  byAgent: AgentCost[]
  byModel: ModelCost[]
  totalMtd: number
}

export interface Budget {
  monthlyBudgetUsd: number | null
  mtdSpend: number
  percentUsed: number
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function useCostSummary(projectId: string) {
  return useQuery<CostSummary>({
    queryKey: ['costs', projectId, 'summary'],
    queryFn: () => apiFetch<CostSummary>(`/api/projects/${projectId}/costs`),
    enabled: Boolean(projectId),
    refetchInterval: 30_000,
  })
}

export function useBudget(projectId: string) {
  return useQuery<Budget>({
    queryKey: ['costs', projectId, 'budget'],
    queryFn: () => apiFetch<Budget>(`/api/projects/${projectId}/costs/budget`),
    enabled: Boolean(projectId),
    refetchInterval: 30_000,
  })
}
