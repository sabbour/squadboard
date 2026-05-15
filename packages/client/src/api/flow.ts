/**
 * api/flow.ts — Phase 12 client hooks for flow visualisation endpoints.
 *
 * Mirrors public types from packages/server/src/services/flow.ts.
 */
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from './client.ts'

export type FlowEdgeKind = 'sequence' | 'fan_out' | 'review'

export interface FlowEdge {
  from: string
  to: string
  kind: FlowEdgeKind
}

export interface FlowDeliverable {
  id: string
  title: string
  status: string
  kind: string
}

export interface FlowReviewEvent {
  stepRunId: string | null
  kind: string
  actorName: string | null
  ts: string
}

export interface FlowStepRun {
  id: string
  stepIndex: number
  kind: string
  label: string
  status: string
  startedAt: string | null
  completedAt: string | null
  agentName: string | null
  agentRole: string | null
  parentStepRunId: string | null
  childIds: string[]
  outputSummary: string | null
  reviewState: 'pending' | 'approved' | 'changes_requested' | null
  deliverables: FlowDeliverable[]
}

export interface FlowWorkflowVersion {
  id: string
  name: string
}

export interface IssueFlow {
  issue: {
    id: string
    title: string
    columnSlug: string
    status: string
  }
  workflowVersion: FlowWorkflowVersion | null
  stepRuns: FlowStepRun[]
  edges: FlowEdge[]
  reviewEvents: FlowReviewEvent[]
}

export interface ProjectFlowIssue {
  id: string
  title: string
  status: string
  activeRunSummary: {
    runId: string
    kind: string
    status: string
    agentName: string | null
    startedAt: string | null
  } | null
  lastDeliverable: {
    id: string
    title: string
    kind: string
    status: string
    createdAt: string
  } | null
}

export interface ProjectFlowColumn {
  slug: string
  name: string
  color: string
  issues: ProjectFlowIssue[]
}

export interface ProjectFlow {
  columns: ProjectFlowColumn[]
  activeRunsCount: number
  pendingReviewsCount: number
}

export function useIssueFlow(projectId: string, issueId: string) {
  return useQuery<IssueFlow>({
    queryKey: ['flow', 'issue', projectId, issueId],
    queryFn: () =>
      apiFetch<IssueFlow>(
        `/api/projects/${projectId}/issues/${issueId}/flow`,
      ),
    enabled: Boolean(projectId) && Boolean(issueId),
  })
}

export function useProjectFlow(projectId: string) {
  return useQuery<ProjectFlow>({
    queryKey: ['flow', 'project', projectId],
    queryFn: () => apiFetch<ProjectFlow>(`/api/projects/${projectId}/flow`),
    enabled: Boolean(projectId),
    refetchInterval: 10000,
  })
}

// ---------------------------------------------------------------------------
// Stream D — D8: agent-centric flow graph (Phase 12 reframe).
//
// Backed by GET /api/projects/:projectId/flow/graph which returns
// { agents: FlowAgent[], edges: FlowLineageEdge[] }. These types mirror
// the server's flow-agents.ts public types.
// ---------------------------------------------------------------------------

export type FlowAgentInstanceKind =
  | 'workflow_run'
  | 'issue_run'
  | 'live_session'
  | 'consult_session'

export type FlowAgentInstanceStatus =
  | 'active'
  | 'idle'
  | 'completed'
  | 'failed'
  | 'pending'

export interface FlowAgentInstance {
  instanceId: string
  instanceKind: FlowAgentInstanceKind
  status: FlowAgentInstanceStatus
  currentStep?: { stepId: string; label: string; startedAt: string }
  currentIssue?: { issueId: string; title: string }
  startedAt: string
  lastHeartbeatAt?: string
  endedAt?: string
  model?: string
}

export interface FlowAgent {
  agentId: string
  name: string
  role: string
  avatarUrl?: string
  instances: FlowAgentInstance[]
}

export type FlowLineageRelation =
  | 'fan_out'
  | 'split'
  | 'consult'
  | 'handoff'
  | 'spawn'

export interface FlowLineageEdge {
  fromInstanceId: string
  toInstanceId: string
  relation: FlowLineageRelation
  createdAt: string
  triggerStepId?: string
}

export interface FlowGraph {
  agents: FlowAgent[]
  edges: FlowLineageEdge[]
}

interface FlowGraphEnvelope {
  ok: boolean
  data: FlowGraph
  error?: string
}

/**
 * Fetch the project's agent-instance graph + lineage edges.
 *
 * Polls every 10s by default to mirror useProjectFlow refresh cadence —
 * the agent view should feel live.
 */
export function useAgentFlow(projectId: string) {
  return useQuery<FlowGraph>({
    queryKey: ['flow', 'agents', projectId],
    queryFn: async () => {
      const env = await apiFetch<FlowGraphEnvelope>(
        `/api/projects/${projectId}/flow/graph`,
      )
      if (!env.ok) {
        throw new Error(env.error ?? 'Failed to load agent flow graph')
      }
      return env.data
    },
    enabled: Boolean(projectId),
    refetchInterval: 10000,
  })
}
