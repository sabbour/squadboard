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
import { useQueryClient } from '@tanstack/react-query'
import { useIssueFlow, type IssueFlow, type FlowEdgeKind } from '../../api/flow.ts'
import { wsClient } from '../../realtime/ws-client.ts'
import StepNode, { type StepNodeData, statusColors } from './StepNode.tsx'
import { layoutDag } from './dagLayout.ts'

const nodeTypes = { step: StepNode }

interface IssueFlowDagProps {
  projectId: string
  issueId: string
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

function buildGraph(flow: IssueFlow, projectId: string, issueId: string): { nodes: Node<StepNodeData>[]; edges: Edge[] } {
  const nodes: Node<StepNodeData>[] = flow.stepRuns.map((step) => ({
    id: step.id,
    type: 'step',
    data: { step, projectId, issueId },
    position: { x: 0, y: 0 },
  }))
  const edges: Edge[] = flow.edges.map((e, i) => {
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
  return layoutDag(nodes, edges)
}

export default function IssueFlowDag({ projectId, issueId }: IssueFlowDagProps) {
  const navigate = useNavigate()
  const { data: flow, isLoading, error, refetch } = useIssueFlow(projectId, issueId)
  const queryClient = useQueryClient()

  const { nodes, edges } = useMemo(() => {
    if (!flow) return { nodes: [] as Node<StepNodeData>[], edges: [] as Edge[] }
    return buildGraph(flow, projectId, issueId)
  }, [flow, projectId, issueId])

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

  if (flow.stepRuns.length === 0) {
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
        No runs yet. Start a run from the Runs tab to see the DAG.
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
            workflowName={flow.workflowVersion?.name ?? null}
            stepCount={flow.stepRuns.length}
            reviewCount={flow.reviewEvents.length}
            onRefresh={() => { void refetch() }}
          />
        </Panel>
        {flow.workflowVersion && (
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
              Workflow: <strong style={{ color: tokens.colorNeutralForeground1 }}>{flow.workflowVersion.name}</strong>
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
  workflowName: string | null
  stepCount: number
  reviewCount: number
  onRefresh: () => void
}

function FlowToolbar({ workflowName, stepCount, reviewCount, onRefresh }: FlowToolbarProps) {
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
      <span>{stepCount} step{stepCount === 1 ? '' : 's'}</span>
      {reviewCount > 0 && <span>· {reviewCount} review event{reviewCount === 1 ? '' : 's'}</span>}
      {!workflowName && <span style={{ color: tokens.colorNeutralForeground3 }}>(default Work Pickup run)</span>}
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
