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
}

export interface ServerCostByModel {
  modelId: string
  runCount: number
  inputTokens: number
  outputTokens: number
  costUsd: number
}

export type CostSource = 'run' | 'live_session' | 'consult'

export interface ServerCostBySource {
  source: CostSource
  runCount: number
  inputTokens: number
  outputTokens: number
  costUsd: number
}

export interface ServerCostBucket {
  totalInputTokens: number
  totalOutputTokens: number
  totalCostUsd: number
  byAgent: ServerCostByAgent[]
  byModel: ServerCostByModel[]
  bySource?: ServerCostBySource[]
}

export interface ServerCostSummary {
  projectId: string
  sources?: CostSource[]
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
}

export interface ModelCost {
  model: string
  runs: number
  tokensIn: number
  tokensOut: number
  totalUsd: number
}

export interface SourceCost {
  source: CostSource
  runs: number
  totalUsd: number
  tokensIn: number
  tokensOut: number
}

export interface CostSummary {
  byAgent: AgentCost[]
  byModel: ModelCost[]
  bySource: SourceCost[]
  totalMtd: number
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
  const mtd = raw?.mtd ?? { totalCostUsd: 0, byAgent: [], byModel: [], bySource: [] }
  const byAgent: AgentCost[] = (mtd.byAgent ?? []).map((a) => {
    const total = Number(a.costUsd ?? 0)
    const runs = Number(a.runCount ?? 0)
    return {
      agentId: a.agentId,
      agentName: a.agentName,
      runs,
      totalUsd: total,
      avgUsdPerRun: runs > 0 ? total / runs : 0,
    }
  })
  const byModel: ModelCost[] = (mtd.byModel ?? []).map((m) => ({
    model: m.modelId,
    runs: Number(m.runCount ?? 0),
    tokensIn: Number(m.inputTokens ?? 0),
    tokensOut: Number(m.outputTokens ?? 0),
    totalUsd: Number(m.costUsd ?? 0),
  }))
  const bySource: SourceCost[] = (mtd.bySource ?? []).map((s) => ({
    source: s.source,
    runs: Number(s.runCount ?? 0),
    totalUsd: Number(s.costUsd ?? 0),
    tokensIn: Number(s.inputTokens ?? 0),
    tokensOut: Number(s.outputTokens ?? 0),
  }))
  return {
    byAgent,
    byModel,
    bySource,
    totalMtd: Number(mtd.totalCostUsd ?? 0),
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
