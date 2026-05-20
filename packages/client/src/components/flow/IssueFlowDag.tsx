/**
 * components/flow/IssueFlowDag.tsx — Phase 12 per-task DAG view.
 *
 * Renders one node per step_run (or per issue_run when no workflow is
 * attached) using @xyflow/react, laid out top-down with `dagre`.
 * Subscribes to the live WS event bus to refetch on relevant changes.
 */
import { useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router'
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  Panel,
  type Edge,
  type Node,
  type NodeMouseHandler,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { tokens } from '@fluentui/react-components'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../../api/client.ts'
import { useIssueFlow, type IssueFlow, type FlowEdge as ApiFlowEdge, type FlowEdgeKind, type FlowStepRun } from '../../api/flow.ts'
import { useIssueRuns, type IssueRun } from '../../api/runs.ts'
import type { IssueRunEventRow } from '../../hooks/useRunStream.ts'
import { wsClient } from '../../realtime/ws-client.ts'
import StepNode, { type StepNodeData, statusColors } from './StepNode.tsx'
import { layoutDag } from './dagLayout.ts'

const nodeTypes = { step: StepNode }

interface IssueFlowDagProps {
  projectId: string
  issueId: string
}

type RunEventsById = Record<string, IssueRunEventRow[]>

interface RunEventsResponse {
  events: IssueRunEventRow[]
}

interface FlowGraphMeta {
  toolbarTitle: string
  toolbarDetail: string | null
  notice: string | null
  inferred: boolean
  stepCount: number
}

interface SemanticFlow {
  stepRuns: FlowStepRun[]
  edges: ApiFlowEdge[]
  meta: FlowGraphMeta
}

interface BuiltGraph {
  nodes: Node<StepNodeData>[]
  edges: Edge[]
  meta: FlowGraphMeta
}

function edgeStyle(kind: FlowEdgeKind): { stroke: string; strokeDasharray?: string; label?: string } {
  switch (kind) {
    case 'fan_out':
      return { stroke: '#a371f7', strokeDasharray: '6 4', label: 'fan-out' }
    case 'review':
      return { stroke: '#d29922', strokeDasharray: '2 4', label: 'review' }
    case 'sequence':
    default:
      return { stroke: '#48515a' }
  }
}

function createEmptyMeta(flow: IssueFlow): FlowGraphMeta {
  return {
    toolbarTitle: flow.workflowVersion ? 'Workflow path' : 'Default Work Pickup path',
    toolbarDetail: null,
    notice: null,
    inferred: false,
    stepCount: 0,
  }
}

function createStep(partial: Partial<FlowStepRun> & Pick<FlowStepRun, 'id' | 'stepIndex' | 'kind' | 'label' | 'status'>): FlowStepRun {
  return {
    startedAt: null,
    completedAt: null,
    agentName: null,
    agentRole: null,
    parentStepRunId: null,
    childIds: [],
    outputSummary: null,
    reviewState: null,
    deliverables: [],
    ...partial,
  }
}

function payloadText(payload: Record<string, unknown>): string {
  try {
    return JSON.stringify(payload)
  } catch {
    return ''
  }
}

function evidenceText(run: IssueRun | null, step: FlowStepRun, events: IssueRunEventRow[]): string {
  return [
    run?.output,
    run?.errorMessage,
    run?.status,
    step.outputSummary,
    step.status,
    ...events.map((event) => `${event.eventType} ${payloadText(event.payload)}`),
  ].filter(Boolean).join('\n')
}

function hasWorkPickupEvidence(text: string): boolean {
  return /auto-dispatch|pickup-ready|pickup sweep|work pickup|ready card|scheduler/i.test(text)
}

function hasRecoveryEvidence(text: string): boolean {
  return /recover|restart-pickup|server restart|restarted|stale/i.test(text)
}

function compactText(value: string | null | undefined): string | null {
  const normalized = value?.replace(/\s+/g, ' ').trim()
  if (!normalized) return null
  return normalized.length > 150 ? `${normalized.slice(0, 147)}…` : normalized
}

function latestFailureDetail(run: IssueRun | null, step: FlowStepRun, events: IssueRunEventRow[]): string | null {
  const errorEvent = [...events].reverse().find((event) =>
    /error|failed|failure/i.test(event.eventType)
    || typeof event.payload.error === 'string'
    || typeof event.payload.errorMessage === 'string',
  )
  const payload = errorEvent?.payload
  const eventMessage = typeof payload?.errorMessage === 'string'
    ? payload.errorMessage
    : typeof payload?.message === 'string'
      ? payload.message
      : typeof payload?.error === 'string'
        ? payload.error
        : null
  return compactText(eventMessage ?? run?.errorMessage ?? step.outputSummary)
}

function runForStep(step: FlowStepRun, runs: IssueRun[]): IssueRun | null {
  const direct = runs.find((run) => run.id === step.id)
  if (direct) return direct
  if (runs.length === 1 && step.kind === 'agent_run') return runs[0]
  return null
}

function eventsForRun(run: IssueRun | null, step: FlowStepRun, eventsByRun: RunEventsById): IssueRunEventRow[] {
  return eventsByRun[run?.id ?? step.id] ?? eventsByRun[step.id] ?? []
}

function stepFromRun(run: IssueRun, index: number): FlowStepRun {
  return createStep({
    id: run.id,
    stepIndex: index,
    kind: run.kind ?? 'agent_run',
    label: 'Agent run',
    status: run.status,
    startedAt: run.startedAt ?? null,
    completedAt: run.completedAt ?? null,
    outputSummary: compactText(run.errorMessage ?? run.output),
  })
}

function buildInferredDefaultPath(
  flow: IssueFlow,
  terminalStep: FlowStepRun,
  run: IssueRun | null,
  events: IssueRunEventRow[],
): SemanticFlow {
  const text = evidenceText(run, terminalStep, events)
  const autoStarted = hasWorkPickupEvidence(text) || !flow.workflowVersion
  const recovered = hasRecoveryEvidence(text)
  const terminalStatus = run?.status ?? terminalStep.status
  const terminalLabel =
    terminalStatus === 'failed'
      ? 'Run failed'
      : terminalStatus === 'completed'
        ? 'Run completed'
        : terminalStatus === 'cancelled'
          ? 'Run cancelled'
          : 'Agent session'
  const terminalDetail =
    terminalStatus === 'failed'
      ? latestFailureDetail(run, terminalStep, events) ?? 'The agent run ended with a failure.'
      : terminalStatus === 'completed'
        ? 'The agent run finished successfully.'
        : terminalStatus === 'cancelled'
          ? 'The run was cancelled before completion.'
          : terminalStep.outputSummary

  const baseId = terminalStep.id
  const agentName = terminalStep.agentName
  const agentRole = terminalStep.agentRole
  const startedAt = run?.startedAt ?? terminalStep.startedAt
  const completedAt = run?.completedAt ?? terminalStep.completedAt
  const failed = terminalStatus === 'failed'
  const active = terminalStatus === 'running' || terminalStatus === 'pending'
  const stepRuns: FlowStepRun[] = [
    createStep({
      id: `${baseId}:scheduler`,
      stepIndex: 0,
      kind: 'scheduler',
      label: autoStarted ? 'Auto-started by scheduler' : 'Run requested',
      status: autoStarted ? 'completed' : 'attempted',
      startedAt,
      completedAt: startedAt,
      outputSummary: autoStarted
        ? 'Ready card detected; Work Pickup started the run automatically.'
        : 'A run was requested for this card.',
    }),
    createStep({
      id: `${baseId}:dispatch`,
      stepIndex: 1,
      kind: 'dispatch',
      label: 'Dispatch to worker',
      status: active ? 'attempted' : 'completed',
      startedAt,
      completedAt: startedAt,
      agentName,
      agentRole,
      outputSummary: `Selected ${agentName ?? 'the assigned agent'} to work this card.`,
    }),
  ]

  if (active) {
    stepRuns.push({
      ...terminalStep,
      stepIndex: 2,
      label: 'Agent session',
      status: terminalStatus,
      outputSummary: terminalStep.outputSummary ?? 'The worker is currently active.',
    })
  } else {
    stepRuns.push(createStep({
      id: `${baseId}:session`,
      stepIndex: 2,
      kind: 'agent_run',
      label: 'Agent session',
      status: failed ? 'attempted' : 'completed',
      startedAt,
      completedAt: recovered ? null : completedAt,
      agentName,
      agentRole,
      outputSummary: failed
        ? 'The agent began work before the run failed.'
        : 'The agent finished its work session.',
    }))

    if (recovered) {
      stepRuns.push(createStep({
        id: `${baseId}:recovery`,
        stepIndex: stepRuns.length,
        kind: 'recovery',
        label: 'Recovered after restart',
        status: 'recovered',
        startedAt,
        completedAt,
        agentName,
        agentRole,
        outputSummary: 'Squadboard recovered this run after a restart and continued tracking the session.',
      }))
    }

    stepRuns.push({
      ...terminalStep,
      stepIndex: stepRuns.length,
      kind: 'terminal',
      label: terminalLabel,
      status: terminalStatus,
      startedAt,
      completedAt,
      outputSummary: terminalDetail,
      agentName,
      agentRole,
    })
  }

  const edges: ApiFlowEdge[] = stepRuns.slice(1).map((step, index) => ({
    from: stepRuns[index].id,
    to: step.id,
    kind: 'sequence',
  }))
  const pathParts = ['scheduler', 'dispatch', 'agent']
  if (recovered) pathParts.push('recovery')
  pathParts.push(terminalStatus === 'failed' ? 'failed' : terminalStatus === 'completed' ? 'completed' : terminalStatus)

  return {
    stepRuns,
    edges,
    meta: {
      toolbarTitle: flow.workflowVersion ? 'Run evidence path' : 'Default Work Pickup path',
      toolbarDetail: pathParts.join(' → '),
      notice: flow.workflowVersion
        ? 'Single-step workflow expanded from run output and events.'
        : 'No workflow is attached; this path is reconstructed from run output and events.',
      inferred: true,
      stepCount: stepRuns.length,
    },
  }
}

function insertRecoveryMarkers(flow: IssueFlow, runs: IssueRun[], eventsByRun: RunEventsById): SemanticFlow {
  const insertedAfter = new Set<string>()
  const stepRuns: FlowStepRun[] = []
  const recoveryByFailedStep = new Map<string, FlowStepRun>()

  for (const step of flow.stepRuns) {
    const run = runForStep(step, runs)
    const events = eventsForRun(run, step, eventsByRun)
    const text = evidenceText(run, step, events)
    if (step.status === 'failed' && hasRecoveryEvidence(text) && !flow.stepRuns.some((candidate) => /recover|restart/i.test(candidate.label))) {
      const recovery = createStep({
        id: `${step.id}:recovery`,
        stepIndex: stepRuns.length,
        kind: 'recovery',
        label: 'Recovered after restart',
        status: 'recovered',
        startedAt: run?.startedAt ?? step.startedAt,
        completedAt: run?.completedAt ?? step.completedAt,
        agentName: step.agentName,
        agentRole: step.agentRole,
        outputSummary: 'Squadboard recovered this run after a restart and continued tracking the session.',
      })
      stepRuns.push(recovery)
      recoveryByFailedStep.set(step.id, recovery)
      insertedAfter.add(step.id)
    }
    stepRuns.push({ ...step, stepIndex: stepRuns.length })
  }

  if (insertedAfter.size === 0) {
    return {
      stepRuns: flow.stepRuns,
      edges: flow.edges,
      meta: {
        toolbarTitle: flow.workflowVersion ? 'Workflow path' : 'Default Work Pickup path',
        toolbarDetail: `${flow.stepRuns.length} step${flow.stepRuns.length === 1 ? '' : 's'} from ${flow.workflowVersion ? 'workflow state' : 'run evidence'}`,
        notice: null,
        inferred: false,
        stepCount: flow.stepRuns.length,
      },
    }
  }

  const edges: ApiFlowEdge[] = []
  for (const edge of flow.edges) {
    const recovery = recoveryByFailedStep.get(edge.to)
    if (recovery && edge.kind === 'sequence') {
      edges.push({ ...edge, to: recovery.id })
      edges.push({ from: recovery.id, to: edge.to, kind: 'sequence' })
    } else {
      edges.push(edge)
    }
  }
  for (const [failedStepId, recovery] of recoveryByFailedStep) {
    if (!edges.some((edge) => edge.to === recovery.id)) {
      const failedIndex = stepRuns.findIndex((step) => step.id === failedStepId)
      const previous = failedIndex > 0 ? stepRuns[failedIndex - 1] : null
      if (previous && previous.id !== recovery.id) edges.push({ from: previous.id, to: recovery.id, kind: 'sequence' })
      edges.push({ from: recovery.id, to: failedStepId, kind: 'sequence' })
    }
  }

  return {
    stepRuns,
    edges,
    meta: {
      toolbarTitle: flow.workflowVersion ? 'Workflow path' : 'Default Work Pickup path',
      toolbarDetail: 'recovered → failed path shown from run evidence',
      notice: 'Recovery markers are reconstructed from run output and events.',
      inferred: true,
      stepCount: stepRuns.length,
    },
  }
}

function buildSemanticFlow(flow: IssueFlow, runs: IssueRun[], eventsByRun: RunEventsById): SemanticFlow {
  if (flow.stepRuns.length === 0) {
    const latestRun = runs[runs.length - 1]
    if (!latestRun) {
      return { stepRuns: [], edges: [], meta: createEmptyMeta(flow) }
    }
    return buildInferredDefaultPath(flow, stepFromRun(latestRun, 0), latestRun, eventsByRun[latestRun.id] ?? [])
  }

  if (flow.stepRuns.length === 1) {
    const step = flow.stepRuns[0]
    const run = runForStep(step, runs)
    return buildInferredDefaultPath(flow, step, run, eventsForRun(run, step, eventsByRun))
  }

  return insertRecoveryMarkers(flow, runs, eventsByRun)
}

function buildGraph(
  flow: IssueFlow,
  projectId: string,
  issueId: string,
  runs: IssueRun[] = [],
  eventsByRun: RunEventsById = {},
): BuiltGraph {
  const semantic = buildSemanticFlow(flow, runs, eventsByRun)
  const nodes: Node<StepNodeData>[] = semantic.stepRuns.map((step) => ({
    id: step.id,
    type: 'step',
    data: { step, projectId, issueId },
    position: { x: 0, y: 0 },
  }))
  const edges: Edge[] = semantic.edges.map((e, i) => {
    const style = edgeStyle(e.kind)
    return {
      id: `${e.from}->${e.to}-${i}`,
      source: e.from,
      target: e.to,
      type: 'smoothstep',
      animated: e.kind === 'fan_out',
      label: style.label,
      labelStyle: { fill: style.stroke, fontSize: 10, fontWeight: 600 },
      labelBgStyle: { fill: 'transparent' },
      style: { stroke: style.stroke, strokeDasharray: style.strokeDasharray, strokeWidth: 1.5 },
      markerEnd: { type: MarkerType.ArrowClosed, color: style.stroke, width: 14, height: 14 },
    }
  })
  const layout = layoutDag(nodes, edges)
  return { ...layout, meta: semantic.meta }
}

export default function IssueFlowDag({ projectId, issueId }: IssueFlowDagProps) {
  const navigate = useNavigate()
  const { data: flow, isLoading, error, refetch } = useIssueFlow(projectId, issueId)
  const { data: issueRuns = [] } = useIssueRuns(projectId, issueId)
  const queryClient = useQueryClient()
  const runIds = useMemo(() => issueRuns.map((run) => run.id).sort(), [issueRuns])
  const hasActiveRun = issueRuns.some((run) => run.status === 'pending' || run.status === 'running')
  const { data: eventsByRun = {} } = useQuery<RunEventsById>({
    queryKey: ['flow', 'issue-run-events', projectId, issueId, runIds],
    enabled: Boolean(projectId) && Boolean(issueId) && runIds.length > 0,
    refetchInterval: hasActiveRun ? 5000 : false,
    queryFn: async () => {
      const pairs = await Promise.all(runIds.map(async (runId) => {
        try {
          const response = await apiFetch<RunEventsResponse>(`/api/projects/${projectId}/issues/${issueId}/runs/${runId}/events?limit=100`)
          return [runId, response.events] as const
        } catch {
          return [runId, []] as const
        }
      }))
      return Object.fromEntries(pairs)
    },
  })

  const { nodes, edges, meta } = useMemo(() => {
    if (!flow) {
      return {
        nodes: [] as Node<StepNodeData>[],
        edges: [] as Edge[],
        meta: {
          toolbarTitle: 'Flow path',
          toolbarDetail: null,
          notice: null,
          inferred: false,
          stepCount: 0,
        },
      }
    }
    return buildGraph(flow, projectId, issueId, issueRuns, eventsByRun)
  }, [flow, projectId, issueId, issueRuns, eventsByRun])

  // N4: Navigate to issue board view when a step node is clicked.
  const handleNodeClick: NodeMouseHandler<Node<StepNodeData>> = (_event, node) => {
    const { projectId: pid, issueId: iid } = node.data
    if (pid && iid) {
      void navigate(`/projects/${pid}/board?focus=${iid}`)
    }
  }

  // Live updates: refetch on any event that could change this issue's flow.
  useEffect(() => {
    const invalidate = () => {
      void queryClient.invalidateQueries({ queryKey: ['flow', 'issue', projectId, issueId] })
      void queryClient.invalidateQueries({ queryKey: ['runs', projectId, issueId] })
      void queryClient.invalidateQueries({ queryKey: ['flow', 'issue-run-events', projectId, issueId] })
    }
    const handlers: Array<{ type: Parameters<typeof wsClient.on>[0]; fn: (p: { issueId?: string; projectId?: string }) => void }> = [
      { type: 'run.started', fn: (p) => { if (p.issueId === issueId) invalidate() } },
      { type: 'run.completed', fn: (p) => { if (p.issueId === issueId) invalidate() } },
      { type: 'run.failed', fn: (p) => { if (p.issueId === issueId) invalidate() } },
      { type: 'run.cancelled', fn: (p) => { if (p.issueId === issueId) invalidate() } },
      { type: 'workflow.advanced', fn: (p) => { if (p.issueId === issueId) invalidate() } },
      { type: 'deliverable.created', fn: (p) => { if (p.issueId === issueId) invalidate() } },
      { type: 'deliverable.reviewed', fn: () => invalidate() },
      { type: 'deliverable.updated', fn: () => invalidate() },
      { type: 'issue.updated', fn: (p) => { if ((p as { issue?: { id?: string } }).issue?.id === issueId) invalidate() } },
    ]
    for (const h of handlers) wsClient.on(h.type, h.fn as never)
    return () => {
      for (const h of handlers) wsClient.off(h.type, h.fn as never)
    }
  }, [projectId, issueId, queryClient])

  if (isLoading) {
    return (
      <div style={{ padding: 24, color: tokens.colorNeutralForeground2, fontSize: 12 }}>
        Loading flow…
      </div>
    )
  }
  if (error) {
    return (
      <div style={{ padding: 24, color: '#ff7b72', fontSize: 12 }}>
        Failed to load flow: {String(error)}
      </div>
    )
  }
  if (!flow) return null

  if (nodes.length === 0) {
    return (
      <div
        style={{
          padding: '32px 24px',
          fontSize: 12,
          color: tokens.colorNeutralForeground2,
          textAlign: 'center',
          border: `1px dashed ${tokens.colorNeutralStroke2}`,
          borderRadius: 8,
        }}
      >
        No run evidence yet. Start a run from the Runs tab to see the planned path and live checkpoints.
      </div>
    )
  }

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      {/* Inline keyframes for the running-node pulse used by StepNode */}
      <style>{`
        @keyframes sb-flow-pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(56, 139, 253, 0.45); }
          50%      { box-shadow: 0 0 0 6px rgba(56, 139, 253, 0); }
        }
      `}</style>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.25}
        maxZoom={1.6}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        onNodeClick={handleNodeClick}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="#30363d" />
        <Controls position="bottom-right" showInteractive={false} />
        <Panel position="top-right">
          <FlowToolbar
            stepCount={meta.stepCount}
            reviewCount={flow.reviewEvents.length}
            title={meta.toolbarTitle}
            detail={meta.toolbarDetail}
            inferred={meta.inferred}
            onRefresh={() => { void refetch() }}
          />
        </Panel>
        {(flow.workflowVersion || meta.notice) && (
          <Panel position="top-left">
            <div
              style={{
                fontSize: 11,
                color: tokens.colorNeutralForeground2,
                background: tokens.colorNeutralBackground1,
                border: `1px solid ${tokens.colorNeutralStroke2}`,
                padding: '4px 8px',
                borderRadius: 6,
              }}
            >
              {flow.workflowVersion ? (
                <>Workflow: <strong style={{ color: tokens.colorNeutralForeground1 }}>{flow.workflowVersion.name}</strong></>
              ) : meta.notice}
            </div>
          </Panel>
        )}
      </ReactFlow>
      {flow.reviewEvents.length > 0 && (
        <div
          style={{
            position: 'absolute',
            bottom: 12,
            left: 12,
            maxWidth: 280,
            background: tokens.colorNeutralBackground1,
            border: `1px solid ${tokens.colorNeutralStroke2}`,
            borderRadius: 6,
            padding: 8,
            fontSize: 11,
            color: tokens.colorNeutralForeground2,
            zIndex: 5,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4, color: tokens.colorNeutralForeground1 }}>Recent reviews</div>
          {flow.reviewEvents.slice(0, 4).map((r, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ color: statusColors(r.kind === 'approve' ? 'completed' : r.kind === 'request_changes' ? 'failed' : 'pending', 'agent_run').badgeFg }}>
                {r.kind}
              </span>
              <span>{r.actorName ?? 'reviewer'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

interface FlowToolbarProps {
  stepCount: number
  reviewCount: number
  title: string
  detail: string | null
  inferred: boolean
  onRefresh: () => void
}

function FlowToolbar({ stepCount, reviewCount, title, detail, inferred, onRefresh }: FlowToolbarProps) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 8,
        alignItems: 'center',
        background: tokens.colorNeutralBackground1,
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        padding: '4px 8px',
        borderRadius: 6,
        fontSize: 11,
        color: tokens.colorNeutralForeground2,
      }}
    >
      <span style={{ color: tokens.colorNeutralForeground1, fontWeight: 600 }}>{title}</span>
      <span>{stepCount} stage{stepCount === 1 ? '' : 's'}</span>
      {detail && <span style={{ color: tokens.colorNeutralForeground3 }}>· {detail}</span>}
      {reviewCount > 0 && <span>· {reviewCount} review event{reviewCount === 1 ? '' : 's'}</span>}
      {inferred && <span style={{ color: '#d29922' }}>inferred</span>}
      <button
        type="button"
        onClick={onRefresh}
        style={{
          background: 'none',
          border: `1px solid ${tokens.colorNeutralStroke2}`,
          color: tokens.colorNeutralForeground2,
          padding: '2px 8px',
          borderRadius: 4,
          fontSize: 11,
          cursor: 'pointer',
        }}
        title="Refresh"
      >
        ⟳
      </button>
    </div>
  )
}
