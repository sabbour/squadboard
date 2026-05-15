/**
 * components/flow/AgentFlowGraph.tsx — Stream D / D8 agent-centric flow view.
 *
 * Phase 12 reframe: instead of "task DAGs per issue", show the project's
 * graph of agents and their runtime instances, with lineage edges drawn
 * between collaborating instances. The board owns the issue-centric view;
 * this component owns the agent-centric pivot.
 *
 * Why a custom SVG renderer (and not @xyflow/react)?
 *   1. Simpler dependency footprint for the lineage view — we don't need
 *      pan/zoom interactivity yet (D8 is a read-only spike).
 *   2. xyflow is already used by IssueFlowDag and brings dagre as a transitive
 *      cost; the agent graph is small enough (≤30 agents per project) to lay
 *      out manually with deterministic columns.
 *   3. Easier to inspect/test in isolation.
 *
 * Layout strategy:
 *   - Each FlowAgent becomes a "row" (horizontal lane).
 *   - Inside each row, FlowAgentInstances are drawn left-to-right by startedAt.
 *   - Lineage edges connect instances across rows with a smooth Bezier.
 */

import { useMemo } from 'react'
import { tokens } from '@fluentui/react-components'
import type {
  FlowAgent,
  FlowAgentInstance,
  FlowAgentInstanceStatus,
  FlowGraph,
  FlowLineageEdge,
  FlowLineageRelation,
} from '../../api/flow.ts'

const ROW_HEIGHT       = 84
const ROW_HEADER_WIDTH = 200
const NODE_WIDTH       = 160
const NODE_HEIGHT      = 56
const NODE_GAP         = 24
const ROW_PADDING_X    = 24

const STATUS_COLOR: Record<FlowAgentInstanceStatus, string> = {
  active:    '#3fb950',
  idle:      '#9da7b3',
  completed: '#58a6ff',
  failed:    '#ff7b72',
  pending:   '#d29922',
}

const RELATION_COLOR: Record<FlowLineageRelation, string> = {
  fan_out: '#bc8cff',
  split:   '#bc8cff',
  consult: '#58a6ff',
  handoff: '#3fb950',
  spawn:   '#d29922',
}

const RELATION_LABEL: Record<FlowLineageRelation, string> = {
  fan_out: 'fan-out',
  split:   'split',
  consult: 'consult',
  handoff: 'handoff',
  spawn:   'spawn',
}

interface PositionedNode {
  agent: FlowAgent
  instance: FlowAgentInstance
  x: number
  y: number
}

function layoutGraph(graph: FlowGraph) {
  const positionedNodes: PositionedNode[] = []
  const nodeIndex = new Map<string, PositionedNode>()

  let maxNodesInAnyRow = 0
  graph.agents.forEach((agent, rowIndex) => {
    const sorted = [...agent.instances].sort((a, b) =>
      a.startedAt.localeCompare(b.startedAt),
    )
    sorted.forEach((instance, colIndex) => {
      const x = ROW_HEADER_WIDTH + ROW_PADDING_X + colIndex * (NODE_WIDTH + NODE_GAP)
      const y = rowIndex * ROW_HEIGHT + (ROW_HEIGHT - NODE_HEIGHT) / 2
      const node: PositionedNode = { agent, instance, x, y }
      positionedNodes.push(node)
      nodeIndex.set(instance.instanceId, node)
    })
    maxNodesInAnyRow = Math.max(maxNodesInAnyRow, sorted.length)
  })

  const width  = ROW_HEADER_WIDTH + ROW_PADDING_X * 2
                 + Math.max(1, maxNodesInAnyRow) * (NODE_WIDTH + NODE_GAP)
  const height = Math.max(1, graph.agents.length) * ROW_HEIGHT

  return { positionedNodes, nodeIndex, width, height }
}

function bezierPath(
  fromX: number, fromY: number,
  toX: number,   toY: number,
): string {
  const dx = Math.max(40, Math.abs(toX - fromX) / 2)
  const c1x = fromX + dx
  const c2x = toX   - dx
  return `M ${fromX} ${fromY} C ${c1x} ${fromY}, ${c2x} ${toY}, ${toX} ${toY}`
}

function fmtClock(iso?: string): string {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

export interface AgentFlowGraphProps {
  graph: FlowGraph
  onSelectInstance?: (instance: FlowAgentInstance, agent: FlowAgent) => void
}

export default function AgentFlowGraph({ graph, onSelectInstance }: AgentFlowGraphProps) {
  const { positionedNodes, nodeIndex, width, height } = useMemo(
    () => layoutGraph(graph),
    [graph],
  )

  if (graph.agents.length === 0) {
    return (
      <div style={{
        padding: '60px 24px',
        textAlign: 'center',
        color: 'var(--text-muted)',
        fontSize: 13,
      }}>
        No agents have been active in this project yet.
      </div>
    )
  }

  return (
    <div style={{
      width: '100%',
      overflowX: 'auto',
      overflowY: 'visible',
      paddingBottom: 16,
    }}>
      <svg
        width={width}
        height={height}
        style={{
          minWidth: '100%',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          display: 'block',
        }}
      >
        {/* Row backgrounds + agent labels */}
        {graph.agents.map((agent, rowIndex) => {
          const y = rowIndex * ROW_HEIGHT
          return (
            <g key={`row-${agent.agentId}`}>
              <rect
                x={0}
                y={y}
                width={width}
                height={ROW_HEIGHT}
                fill={rowIndex % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)'}
              />
              <line
                x1={ROW_HEADER_WIDTH}
                y1={y}
                x2={ROW_HEADER_WIDTH}
                y2={y + ROW_HEIGHT}
                stroke="var(--border)"
                strokeWidth={1}
              />
              <text
                x={16}
                y={y + ROW_HEIGHT / 2 - 6}
                fill="var(--text)"
                fontSize={13}
                fontWeight={600}
              >
                {truncate(agent.name, 22)}
              </text>
              <text
                x={16}
                y={y + ROW_HEIGHT / 2 + 12}
                fill="var(--text-muted)"
                fontSize={11}
              >
                {agent.role} · {agent.instances.length} instance{agent.instances.length === 1 ? '' : 's'}
              </text>
            </g>
          )
        })}

        {/* Lineage edges (drawn before nodes so nodes overlay them) */}
        {graph.edges.map((edge: FlowLineageEdge, i: number) => {
          const from = nodeIndex.get(edge.fromInstanceId)
          const to   = nodeIndex.get(edge.toInstanceId)
          if (!from || !to) return null
          const fx = from.x + NODE_WIDTH
          const fy = from.y + NODE_HEIGHT / 2
          const tx = to.x
          const ty = to.y + NODE_HEIGHT / 2
          const color = RELATION_COLOR[edge.relation]
          return (
            <g key={`edge-${i}`}>
              <path
                d={bezierPath(fx, fy, tx, ty)}
                stroke={color}
                strokeWidth={1.5}
                fill="none"
                opacity={0.7}
                markerEnd={`url(#arrow-${edge.relation})`}
              />
            </g>
          )
        })}

        {/* Arrowhead defs */}
        <defs>
          {(Object.keys(RELATION_COLOR) as FlowLineageRelation[]).map((rel) => (
            <marker
              key={rel}
              id={`arrow-${rel}`}
              viewBox="0 0 8 8"
              refX="7"
              refY="4"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 8 4 L 0 8 z" fill={RELATION_COLOR[rel]} />
            </marker>
          ))}
        </defs>

        {/* Instance nodes */}
        {positionedNodes.map(({ agent, instance, x, y }) => {
          const color = STATUS_COLOR[instance.status]
          return (
            <g
              key={instance.instanceId}
              transform={`translate(${x}, ${y})`}
              style={{ cursor: onSelectInstance ? 'pointer' : 'default' }}
              onClick={() => onSelectInstance?.(instance, agent)}
            >
              <rect
                width={NODE_WIDTH}
                height={NODE_HEIGHT}
                rx={6}
                fill={tokens.colorNeutralBackground2}
                stroke={color}
                strokeWidth={1.5}
              />
              <rect
                width={4}
                height={NODE_HEIGHT}
                fill={color}
                rx={2}
              />
              <text
                x={12}
                y={18}
                fill="var(--text)"
                fontSize={12}
                fontWeight={600}
              >
                {truncate(instance.currentStep?.label ?? instance.instanceKind, 22)}
              </text>
              <text
                x={12}
                y={34}
                fill={color}
                fontSize={10}
                fontWeight={600}
              >
                {instance.status.toUpperCase()}
              </text>
              <text
                x={12}
                y={48}
                fill="var(--text-muted)"
                fontSize={10}
              >
                {fmtClock(instance.startedAt)}
                {instance.currentIssue ? ` · ${truncate(instance.currentIssue.title, 14)}` : ''}
              </text>
            </g>
          )
        })}
      </svg>

      {/* Legend */}
      <div style={{
        display: 'flex',
        gap: 16,
        padding: '12px 4px',
        flexWrap: 'wrap',
        fontSize: 11,
        color: 'var(--text-muted)',
      }}>
        <strong style={{ color: 'var(--text)' }}>Status:</strong>
        {(Object.keys(STATUS_COLOR) as FlowAgentInstanceStatus[]).map((s) => (
          <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{
              display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
              background: STATUS_COLOR[s],
            }} />
            {s}
          </span>
        ))}
        <strong style={{ color: 'var(--text)', marginLeft: 12 }}>Edges:</strong>
        {(Object.keys(RELATION_COLOR) as FlowLineageRelation[]).map((r) => (
          <span key={r} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{
              display: 'inline-block', width: 14, height: 2,
              background: RELATION_COLOR[r],
            }} />
            {RELATION_LABEL[r]}
          </span>
        ))}
      </div>
    </div>
  )
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
}
