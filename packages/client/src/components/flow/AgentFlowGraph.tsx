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
import type React from 'react'
import { useNavigate } from 'react-router'
import { tokens } from '@fluentui/react-components'
import type {
  FlowAgent,
  FlowAgentInstance,
  FlowAgentInstanceStatus,
  FlowGraph,
  FlowLineageEdge,
  FlowLineageRelation,
} from '../../api/flow.ts'

const ROW_HEIGHT       = 72
const ROW_HEADER_WIDTH = 180
const NODE_WIDTH       = 148
const NODE_HEIGHT      = 52
const NODE_GAP         = 20
const ROW_PADDING_X    = 20
const LEGEND_HEIGHT    = 34

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

  // Reserve at least one node column width even for zero-instance agents.
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
  /** When provided, instance nodes navigate to the most specific detail surface available. */
  projectId?: string
  onSelectInstance?: (instance: FlowAgentInstance, agent: FlowAgent) => void
}

function instanceDetailPath(projectId: string, instance: FlowAgentInstance, agent: FlowAgent): string {
  if (instance.instanceKind === 'issue_run' && instance.currentIssue) {
    return `/projects/${projectId}/issues/${instance.currentIssue.issueId}/runs/${instance.instanceId}/live`
  }
  if (instance.instanceKind === 'consult_session') {
    return `/projects/${projectId}/consult/${instance.instanceId}`
  }
  if (instance.currentIssue) {
    return `/projects/${projectId}/board?openIssue=${instance.currentIssue.issueId}&tab=flow`
  }
  return `/projects/${projectId}/agents/${agent.agentId}`
}

export default function AgentFlowGraph({ graph, projectId, onSelectInstance }: AgentFlowGraphProps) {
  const navigate = useNavigate()
  const { positionedNodes, nodeIndex, width, height } = useMemo(
    () => layoutGraph(graph),
    [graph],
  )

  if (graph.agents.length === 0) {
    return (
      <div style={{
        padding: '48px 24px',
        textAlign: 'center',
        border: '1px dashed var(--border)',
        borderRadius: 10,
        color: tokens.colorNeutralForeground3,
        fontSize: 13,
      }}>
        <div style={{ fontSize: 28, marginBottom: 10 }}>🤖</div>
        <div style={{ fontWeight: 600, color: tokens.colorNeutralForeground2, marginBottom: 6 }}>
          No agent activity yet
        </div>
        <div>
          Agents appear here once a ceremony or workflow run starts them.
        </div>
      </div>
    )
  }

  const totalInstances = graph.agents.reduce((sum, a) => sum + a.instances.length, 0)
  const totalHeight = height + LEGEND_HEIGHT

  return (
    <div style={{
      width: '100%',
      overflowX: 'auto',
      overflowY: 'visible',
    }}>
      <svg
        width={width}
        height={totalHeight}
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
          const hasInstances = agent.instances.length > 0
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
                x={14}
                y={y + ROW_HEIGHT / 2 - 7}
                fill="var(--text)"
                fontSize={12}
                fontWeight={600}
              >
                {truncate(agent.name, 22)}
              </text>
              <text
                x={14}
                y={y + ROW_HEIGHT / 2 + 9}
                fill="var(--text-muted)"
                fontSize={10}
              >
                {agent.role} · {agent.instances.length} run{agent.instances.length === 1 ? '' : 's'}
              </text>
              {/* Zero-instance placeholder */}
              {!hasInstances && (
                <text
                  x={ROW_HEADER_WIDTH + ROW_PADDING_X}
                  y={y + ROW_HEIGHT / 2 + 4}
                  fill="var(--text-muted)"
                  fontSize={11}
                  fontStyle="italic"
                  opacity={0.6}
                >
                  no runs yet
                </text>
              )}
            </g>
          )
        })}

        {/* Separator between rows */}
        {graph.agents.map((agent, rowIndex) => {
          if (rowIndex === 0) return null
          const y = rowIndex * ROW_HEIGHT
          return (
            <line
              key={`sep-${agent.agentId}`}
              x1={0}
              y1={y}
              x2={width}
              y2={y}
              stroke="var(--border)"
              strokeWidth={0.5}
              opacity={0.5}
            />
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
          const isClickable = Boolean(projectId || onSelectInstance)
          const handleClick = () => {
            onSelectInstance?.(instance, agent)
            if (projectId) {
              void navigate(instanceDetailPath(projectId, instance, agent))
            }
          }
          const handleKeyDown = (e: React.KeyboardEvent<SVGGElement>) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              handleClick()
            }
          }
          return (
            <g
              key={instance.instanceId}
              transform={`translate(${x}, ${y})`}
              style={{ cursor: isClickable ? 'pointer' : 'default' }}
              role={isClickable ? 'button' : undefined}
              tabIndex={isClickable ? 0 : undefined}
              aria-label={`${agent.name} — ${instance.status}`}
              onClick={isClickable ? handleClick : undefined}
              onKeyDown={isClickable ? handleKeyDown : undefined}
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
                className="node-hover-bg"
                width={NODE_WIDTH}
                height={NODE_HEIGHT}
                rx={6}
                fill="white"
                opacity={0}
                style={{ transition: 'opacity 120ms ease-out' }}
                onMouseEnter={(e) => { e.currentTarget.setAttribute('opacity', '0.06') }}
                onMouseLeave={(e) => { e.currentTarget.setAttribute('opacity', '0') }}
              />
              <rect
                width={4}
                height={NODE_HEIGHT}
                fill={color}
                rx={2}
              />
              <text
                x={12}
                y={17}
                fill="var(--text)"
                fontSize={11}
                fontWeight={600}
              >
                {truncate(instance.currentStep?.label ?? instance.instanceKind, 20)}
              </text>
              <text
                x={12}
                y={30}
                fill={color}
                fontSize={10}
                fontWeight={600}
                textAnchor="start"
              >
                {instance.status.toUpperCase()}
              </text>
              <text
                x={12}
                y={44}
                fill="var(--text-muted)"
                fontSize={9}
              >
                {fmtClock(instance.startedAt)}
                {instance.currentIssue ? ` · ${truncate(instance.currentIssue.title, 16)}` : ''}
              </text>
            </g>
          )
        })}

        {/* Inline legend bar at the bottom of the SVG */}
        <g transform={`translate(0, ${height})`}>
          <rect x={0} y={0} width={width} height={LEGEND_HEIGHT}
            fill="var(--surface)" opacity={0.96} />
          <line x1={0} y1={0} x2={width} y2={0} stroke="var(--border)" strokeWidth={0.5} />

          {/* Status legend */}
          {(() => {
            const statuses = Object.keys(STATUS_COLOR) as FlowAgentInstanceStatus[]
            let cx = 14
            const items: React.ReactNode[] = []
            items.push(
              <text key="status-lbl" x={cx} y={21} fill="var(--text-muted)" fontSize={9}
                fontWeight={600} textAnchor="start">
                STATUS
              </text>,
            )
            cx += 46
            statuses.forEach((s) => {
              items.push(
                <circle key={`s-${s}`} cx={cx + 4} cy={17} r={4} fill={STATUS_COLOR[s]} />,
              )
              items.push(
                <text key={`sl-${s}`} x={cx + 12} y={21} fill="var(--text-muted)" fontSize={9}>
                  {s}
                </text>,
              )
              cx += 12 + s.length * 6 + 10
            })
            // Edges legend
            items.push(
              <text key="edge-lbl" x={cx + 8} y={21} fill="var(--text-muted)" fontSize={9}
                fontWeight={600} textAnchor="start">
                EDGES
              </text>,
            )
            cx += 54
            ;(Object.keys(RELATION_COLOR) as FlowLineageRelation[]).forEach((r) => {
              items.push(
                <line key={`e-${r}`} x1={cx} y1={17} x2={cx + 14} y2={17}
                  stroke={RELATION_COLOR[r]} strokeWidth={2} />,
              )
              items.push(
                <text key={`el-${r}`} x={cx + 18} y={21} fill="var(--text-muted)" fontSize={9}>
                  {RELATION_LABEL[r]}
                </text>,
              )
              cx += 18 + RELATION_LABEL[r].length * 6 + 10
            })
            return items
          })()}
        </g>

        {/* Zero-instances note when all agents have no runs */}
        {totalInstances === 0 && (
          <text
            x={ROW_HEADER_WIDTH + ROW_PADDING_X}
            y={height / 2 + 4}
            fill="var(--text-muted)"
            fontSize={12}
            fontStyle="italic"
          >
            No active runs — agents are registered but haven't been invoked yet.
          </text>
        )}
      </svg>
    </div>
  )
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
}
