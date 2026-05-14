import { useQuery } from '@tanstack/react-query'
import { apiFetch } from './client.ts'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProjectOverview {
  issuesByStatus: {
    backlog: number
    todo: number
    in_progress: number
    in_review: number
    done: number
  }
  issuesDoneThisWeek: number
  issuesDoneLastWeek: number
  weekOverWeekChange: number
  activeAgents: number
  totalRuns: number
  runsThisWeek: number
  avgRunCostUsd: number
  totalCostMtd: number
  workflowsActive: number
  openReviews: number
}

export interface ThroughputDay {
  date: string
  done: number
  created: number
}

export interface Throughput {
  days: ThroughputDay[]
}

export interface AgentStat {
  id: string
  name: string
  runsTotal: number
  runsThisWeek: number
  avgCostUsd: number
  avgDurationMs: number
  successRate: number
}

export interface AgentStats {
  agents: AgentStat[]
}

export interface WorkflowStat {
  id: string
  name: string
  runsTotal: number
  completedRuns: number
  failedRuns: number
  avgSteps: number
  avgDurationMs: number
}

export interface WorkflowStats {
  workflows: WorkflowStat[]
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function useProjectOverview(projectId: string) {
  return useQuery<ProjectOverview>({
    queryKey: ['analytics', projectId, 'overview'],
    queryFn: () => apiFetch<ProjectOverview>(`/api/projects/${projectId}/analytics/overview`),
    enabled: Boolean(projectId),
    refetchInterval: 30_000,
  })
}

export function useThroughput(projectId: string) {
  return useQuery<Throughput>({
    queryKey: ['analytics', projectId, 'throughput'],
    queryFn: () => apiFetch<Throughput>(`/api/projects/${projectId}/analytics/throughput`),
    enabled: Boolean(projectId),
    refetchInterval: 60_000,
  })
}

export function useAgentStats(projectId: string) {
  return useQuery<AgentStats>({
    queryKey: ['analytics', projectId, 'agents'],
    queryFn: () => apiFetch<AgentStats>(`/api/projects/${projectId}/analytics/agents`),
    enabled: Boolean(projectId),
    refetchInterval: 30_000,
  })
}

export function useWorkflowStats(projectId: string) {
  return useQuery<WorkflowStats>({
    queryKey: ['analytics', projectId, 'workflows'],
    queryFn: () => apiFetch<WorkflowStats>(`/api/projects/${projectId}/analytics/workflows`),
    enabled: Boolean(projectId),
    refetchInterval: 30_000,
  })
}
