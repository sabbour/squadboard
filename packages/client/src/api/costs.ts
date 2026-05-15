import { useQuery } from '@tanstack/react-query'
import { apiFetch } from './client.ts'

// ---------------------------------------------------------------------------
// Server response types (raw shape from `/api/projects/:id/costs`)
// ---------------------------------------------------------------------------

export interface ServerCostByAgent {
  agentId: string
  agentName: string
  runCount: number
  inputTokens: number
  outputTokens: number
  costUsd: number
  premiumRequests?: number
}

export interface ServerCostByModel {
  modelId: string
  runCount: number
  inputTokens: number
  outputTokens: number
  costUsd: number
  premiumRequests?: number
}

export type CostSource = 'run' | 'live_session' | 'consult'

export interface ServerCostBySource {
  source: CostSource
  runCount: number
  inputTokens: number
  outputTokens: number
  costUsd: number
  premiumRequests?: number
}

export interface ServerCostBucket {
  totalInputTokens: number
  totalOutputTokens: number
  totalCostUsd: number
  totalPremiumRequests?: number
  byAgent: ServerCostByAgent[]
  byModel: ServerCostByModel[]
  bySource?: ServerCostBySource[]
}

export type CostModel = 'usd' | 'gh_multipliers'

export interface ServerCostSummary {
  projectId: string
  sources?: CostSource[]
  costModel?: CostModel
  mtd: ServerCostBucket
  allTime: ServerCostBucket
}

// ---------------------------------------------------------------------------
// Client view types (flat MTD view used by CostDashboard)
// ---------------------------------------------------------------------------

export interface AgentCost {
  agentId: string
  agentName: string
  runs: number
  totalUsd: number
  avgUsdPerRun: number
  totalPremiumRequests: number
  avgPremiumRequestsPerRun: number
}

export interface ModelCost {
  model: string
  runs: number
  tokensIn: number
  tokensOut: number
  totalUsd: number
  totalPremiumRequests: number
}

export interface SourceCost {
  source: CostSource
  runs: number
  totalUsd: number
  tokensIn: number
  tokensOut: number
  totalPremiumRequests: number
}

export interface CostSummary {
  byAgent: AgentCost[]
  byModel: ModelCost[]
  bySource: SourceCost[]
  totalMtd: number
  totalMtdPremiumRequests: number
  costModel: CostModel
}

export interface ServerBudget {
  projectId: string
  budgetUsd: number | null
  spendUsd: number
  percentUsed: number | null
  isConfigured: boolean
}

export interface Budget {
  monthlyBudgetUsd: number | null
  mtdSpend: number
  percentUsed: number
}

// ---------------------------------------------------------------------------
// Adapters — defensive against missing/null fields so the UI never crashes
// even if the server contract drifts.
// ---------------------------------------------------------------------------

function adaptSummary(raw: ServerCostSummary | undefined | null): CostSummary {
  const fallbackBucket: ServerCostBucket = {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCostUsd: 0,
    totalPremiumRequests: 0,
    byAgent: [],
    byModel: [],
    bySource: [],
  }
  const mtd = raw?.mtd ?? fallbackBucket
  const byAgent: AgentCost[] = (mtd.byAgent ?? []).map((a) => {
    const total = Number(a.costUsd ?? 0)
    const runs = Number(a.runCount ?? 0)
    const premium = Number(a.premiumRequests ?? 0)
    return {
      agentId: a.agentId,
      agentName: a.agentName,
      runs,
      totalUsd: total,
      avgUsdPerRun: runs > 0 ? total / runs : 0,
      totalPremiumRequests: premium,
      avgPremiumRequestsPerRun: runs > 0 ? premium / runs : 0,
    }
  })
  const byModel: ModelCost[] = (mtd.byModel ?? []).map((m) => ({
    model: m.modelId,
    runs: Number(m.runCount ?? 0),
    tokensIn: Number(m.inputTokens ?? 0),
    tokensOut: Number(m.outputTokens ?? 0),
    totalUsd: Number(m.costUsd ?? 0),
    totalPremiumRequests: Number(m.premiumRequests ?? 0),
  }))
  const bySource: SourceCost[] = (mtd.bySource ?? []).map((s) => ({
    source: s.source,
    runs: Number(s.runCount ?? 0),
    totalUsd: Number(s.costUsd ?? 0),
    tokensIn: Number(s.inputTokens ?? 0),
    tokensOut: Number(s.outputTokens ?? 0),
    totalPremiumRequests: Number(s.premiumRequests ?? 0),
  }))
  return {
    byAgent,
    byModel,
    bySource,
    totalMtd: Number(mtd.totalCostUsd ?? 0),
    totalMtdPremiumRequests: Number(mtd.totalPremiumRequests ?? 0),
    costModel: raw?.costModel ?? 'usd',
  }
}

function adaptBudget(raw: ServerBudget | undefined | null): Budget {
  return {
    monthlyBudgetUsd: raw?.budgetUsd ?? null,
    mtdSpend: Number(raw?.spendUsd ?? 0),
    percentUsed: Number(raw?.percentUsed ?? 0),
  }
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function useCostSummary(projectId: string, opts?: { sources?: CostSource[] }) {
  const sources = opts?.sources
  const sourcesKey = sources && sources.length ? [...sources].sort().join(',') : 'default'
  return useQuery<CostSummary>({
    queryKey: ['costs', projectId, 'summary', sourcesKey],
    queryFn: async () => {
      const qs = sources && sources.length ? `?sources=${encodeURIComponent(sources.join(','))}` : ''
      const raw = await apiFetch<ServerCostSummary>(`/api/projects/${projectId}/costs${qs}`)
      return adaptSummary(raw)
    },
    enabled: Boolean(projectId),
    refetchInterval: 30_000,
  })
}

export function useBudget(projectId: string) {
  return useQuery<Budget>({
    queryKey: ['costs', projectId, 'budget'],
    queryFn: async () => {
      const raw = await apiFetch<ServerBudget>(`/api/projects/${projectId}/costs/budget`)
      return adaptBudget(raw)
    },
    enabled: Boolean(projectId),
    refetchInterval: 30_000,
  })
}
