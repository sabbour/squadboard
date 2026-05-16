/**
 * components/ceremony/VisualCanvas.tsx — Phase 16
 *
 * Authoring-mode visual ceremony canvas. Reads/writes the same in-memory
 * step list the Code and Prose tabs use; round-trips via
 * services/ceremony-graph.ts so YAML stays the source of truth.
 *
 * Affordances:
 *   - Drag-from-palette (5 step kinds + sentinel for fan_out children):
 *     click in palette → step appended to the end of the top-level list.
 *   - Click a node → property panel opens in the right rail.
 *   - Drag-to-connect outputs → next inputs: re-orders the linear step
 *     list (we don't support actual branching here — one of phase 16's
 *     guard rails — so connecting B→A merely moves B above A).
 *   - Backspace / Delete on a selected node → remove from the list.
 *   - Auto-layout via dagre on every structural change (nodes/edges add).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  Panel,
  ReactFlowProvider,
  type Edge,
  type Node,
  type Connection,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Button, Caption1, Subtitle1, tokens } from '@fluentui/react-components'
import { Add16Regular, Delete16Regular } from '@fluentui/react-icons'
import {
  blankStep,
  rebuildGraph,
  topLevelSteps,
  type CeremonyGraph,
  type CeremonyStep,
  type CeremonyHeader,
  type StepKind,
} from '../../services/ceremony-graph.ts'
import CeremonyStepNode, {
  getKindIcon,
  KIND_LABEL,
  KIND_ACCENT,
  type CeremonyStepNodeData,
} from '../flow/nodes/CeremonyStepNode.tsx'
import { layoutDag } from '../flow/dagLayout.ts'
import StepPropertyForm from './StepPropertyForm.tsx'
import { useActiveAgents } from '../../api/agents.ts'

const nodeTypes = { ceremony: CeremonyStepNode }

export interface VisualCanvasProps {
  projectId: string
  header: CeremonyHeader
  steps: CeremonyStep[]
  onChange: (next: CeremonyStep[]) => void
  disabled?: boolean
}

const PALETTE: StepKind[] = ['agent_run', 'route', 'approve', 'fan_out', 'handoff']

function buildReactFlowGraph(graph: CeremonyGraph, selectedId: string | null): {
  nodes: Node<CeremonyStepNodeData>[]
  edges: Edge[]
} {
  const rfNodes: Node<CeremonyStepNodeData>[] = graph.nodes.map((gn) => ({
    id: gn.id,
    type: 'ceremony',
    data: {
      step: gn.step,
      isChild: !!gn.parentId,
      selected: gn.id === selectedId,
    },
    position: { x: 0, y: 0 },
    selected: gn.id === selectedId,
    selectable: true,
    deletable: true,
    draggable: false,
  }))
  const rfEdges: Edge[] = graph.edges.map((ge) => {
    const isChild = ge.kind === 'fan_out_child'
    return {
      id: ge.id,
      source: ge.source,
      target: ge.target,
      type: 'smoothstep',
      animated: isChild,
      style: {
        stroke: isChild ? KIND_ACCENT.fan_out : '#48515a',
        strokeDasharray: isChild ? '6 4' : undefined,
        strokeWidth: 1.5,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: isChild ? KIND_ACCENT.fan_out : '#48515a',
        width: 14,
        height: 14,
      },
      label: isChild ? 'fan-out' : undefined,
      labelStyle: { fill: KIND_ACCENT.fan_out, fontSize: 10, fontWeight: 600 },
      labelBgStyle: { fill: 'transparent' },
    }
  })
  return layoutDag(rfNodes, rfEdges)
}

/**
 * Move the step at sourceIdx so it becomes the immediate predecessor of
 * the step at targetIdx. Used by the drag-to-connect handler.
 */
function reorderSteps(steps: CeremonyStep[], sourceIdx: number, targetIdx: number): CeremonyStep[] {
  if (sourceIdx === targetIdx) return steps
  if (sourceIdx < 0 || targetIdx < 0 || sourceIdx >= steps.length || targetIdx >= steps.length) return steps
  const next = steps.slice()
  const [moved] = next.splice(sourceIdx, 1)
  // After removal, target index may have shifted left.
  const insertAt = sourceIdx < targetIdx ? targetIdx - 1 : targetIdx
  next.splice(Math.max(0, insertAt), 0, moved)
  return next
}

function CanvasInner({ projectId, header, steps, onChange, disabled }: VisualCanvasProps) {
  // Wave 10 B9: ceremony step pickers (rendered downstream by the
  // property panel) only surface active agents.
  const { data: agents } = useActiveAgents(projectId)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const graph = useMemo(() => rebuildGraph(header, steps), [header, steps])
  const { nodes, edges } = useMemo(() => buildReactFlowGraph(graph, selectedNodeId), [graph, selectedNodeId])

  // ---------- Selection ----------
  const selectedGraphNode = useMemo(
    () => graph.nodes.find((n) => n.id === selectedNodeId) ?? null,
    [graph, selectedNodeId],
  )

  // Clear selection if the selected node no longer exists.
  useEffect(() => {
    if (selectedNodeId && !graph.nodes.some((n) => n.id === selectedNodeId)) {
      setSelectedNodeId(null)
    }
  }, [graph, selectedNodeId])

  // ---------- Mutations ----------
  const updateStepAt = useCallback(
    (graphNodeId: string, next: CeremonyStep) => {
      const node = graph.nodes.find((n) => n.id === graphNodeId)
      if (!node) return
      if (!node.parentId) {
        const nextSteps = topLevelSteps(graph).slice()
        nextSteps[node.index] = next
        onChange(nextSteps)
      } else {
        // Child of a fan_out — clone the parent and patch its `steps[]`.
        const parent = graph.nodes.find((n) => n.id === node.parentId)
        if (!parent || parent.step.kind !== 'fan_out') return
        const newChildren = parent.step.steps.slice()
        newChildren[node.index] = next
        const newParent: CeremonyStep = { ...parent.step, steps: newChildren }
        const nextSteps = topLevelSteps(graph).slice()
        nextSteps[parent.index] = newParent
        onChange(nextSteps)
      }
    },
    [graph, onChange],
  )

  const appendStep = useCallback(
    (kind: StepKind) => {
      if (disabled) return
      const next = [...topLevelSteps(graph), blankStep(kind)]
      onChange(next)
      // Select the just-added step on the next render.
      const newId = `step-${next.length - 1}`
      setSelectedNodeId(newId)
    },
    [graph, onChange, disabled],
  )

  const deleteStep = useCallback(
    (graphNodeId: string) => {
      if (disabled) return
      const node = graph.nodes.find((n) => n.id === graphNodeId)
      if (!node) return
      if (!node.parentId) {
        const nextSteps = topLevelSteps(graph).filter((_, i) => i !== node.index)
        onChange(nextSteps)
        setSelectedNodeId(null)
      } else {
        const parent = graph.nodes.find((n) => n.id === node.parentId)
        if (!parent || parent.step.kind !== 'fan_out') return
        const newChildren = parent.step.steps.filter((_, i) => i !== node.index)
        const newParent: CeremonyStep = { ...parent.step, steps: newChildren }
        const nextSteps = topLevelSteps(graph).slice()
        nextSteps[parent.index] = newParent
        onChange(nextSteps)
        setSelectedNodeId(null)
      }
    },
    [graph, onChange, disabled],
  )

  const onConnect = useCallback(
    (connection: Connection) => {
      if (disabled) return
      const sourceNode = graph.nodes.find((n) => n.id === connection.source)
      const targetNode = graph.nodes.find((n) => n.id === connection.target)
      if (!sourceNode || !targetNode) return
      // Only support reordering top-level steps. Connecting child nodes is
      // ignored — fan_out structure is fixed by the parent's child list.
      if (sourceNode.parentId || targetNode.parentId) return
      const next = reorderSteps(topLevelSteps(graph), sourceNode.index, targetNode.index)
      onChange(next)
    },
    [graph, onChange, disabled],
  )

  // ---------- Keyboard ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (disabled) return
      if (e.key !== 'Backspace' && e.key !== 'Delete') return
      if (!selectedNodeId) return
      // Don't intercept when the user is typing in an input/textarea.
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      e.preventDefault()
      deleteStep(selectedNodeId)
    }
    const el = containerRef.current
    if (el) el.addEventListener('keydown', onKey)
    return () => {
      if (el) el.removeEventListener('keydown', onKey)
    }
  }, [selectedNodeId, deleteStep, disabled])

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      style={{ display: 'flex', height: '100%', minHeight: 0, outline: 'none' }}
    >
      {/* ── Palette (left rail) ────────────────────────────────────── */}
      <div
        style={{
          width: 168,
          borderRight: `1px solid ${tokens.colorNeutralStroke2}`,
          padding: '12px 10px',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          overflow: 'auto',
          flexShrink: 0,
        }}
      >
        <Subtitle1 style={{ fontSize: 13 }}>Palette</Subtitle1>
        <Caption1 style={{ color: 'var(--text-muted)' }}>Click to append</Caption1>
        {PALETTE.map((k) => (
          <Button
            key={k}
            appearance="subtle"
            disabled={disabled}
            onClick={() => appendStep(k)}
            icon={<span style={{ fontSize: 14, display: 'inline-flex', alignItems: 'center' }}>{getKindIcon(k)}</span>}
            style={{
              justifyContent: 'flex-start',
              border: `1px dashed ${KIND_ACCENT[k]}55`,
              color: tokens.colorNeutralForeground1,
            }}
          >
            {KIND_LABEL[k]}
          </Button>
        ))}
        <Caption1 style={{ color: 'var(--text-muted)', marginTop: 8 }}>
          Drag a node's bottom handle to another node's top handle to reorder.
          Press <code>Backspace</code> on a selected node to delete.
        </Caption1>
      </div>

      {/* ── Canvas ─────────────────────────────────────────────────── */}
      <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
        {graph.nodes.length === 0 ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: tokens.colorNeutralForeground2,
              fontSize: 13,
              padding: 20,
              textAlign: 'center',
            }}
          >
            Click a step in the palette to start authoring.
          </div>
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.25 }}
            minZoom={0.25}
            maxZoom={1.6}
            proOptions={{ hideAttribution: true }}
            nodesDraggable={false}
            nodesConnectable={!disabled}
            edgesFocusable={false}
            elementsSelectable
            selectNodesOnDrag={false}
            onNodeClick={(_, n) => setSelectedNodeId(n.id)}
            onPaneClick={() => setSelectedNodeId(null)}
            onConnect={onConnect}
            onNodesDelete={(deleted) => {
              for (const d of deleted) deleteStep(d.id)
            }}
            deleteKeyCode={['Backspace', 'Delete']}
          >
            <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="#30363d" />
            <Controls position="bottom-right" showInteractive={false} />
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
                {topLevelSteps(graph).length} step{topLevelSteps(graph).length === 1 ? '' : 's'}
                {' · '}YAML is source of truth
              </div>
            </Panel>
          </ReactFlow>
        )}
      </div>

      {/* ── Property panel (right rail) ────────────────────────────── */}
      <div
        style={{
          width: 320,
          borderLeft: `1px solid ${tokens.colorNeutralStroke2}`,
          padding: '12px 14px',
          overflow: 'auto',
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        {selectedGraphNode ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Subtitle1 style={{ fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {getKindIcon(selectedGraphNode.step.kind)} {KIND_LABEL[selectedGraphNode.step.kind]}
              </Subtitle1>
              <Button
                appearance="subtle"
                size="small"
                icon={<Delete16Regular />}
                disabled={disabled}
                onClick={() => deleteStep(selectedGraphNode.id)}
                aria-label="Delete step"
              />
            </div>
            <Caption1 style={{ color: 'var(--text-muted)' }}>
              {selectedGraphNode.parentId
                ? `Child of ${selectedGraphNode.parentId.split('.')[0]} (fan-out)`
                : `Step ${selectedGraphNode.index + 1}`}
            </Caption1>
            <StepPropertyForm
              step={selectedGraphNode.step}
              agents={agents}
              onChange={(next) => updateStepAt(selectedGraphNode.id, next)}
              disabled={disabled}
            />
          </>
        ) : (
          <>
            <Subtitle1 style={{ fontSize: 13 }}>Properties</Subtitle1>
            <Caption1 style={{ color: 'var(--text-muted)' }}>
              Select a step to edit its fields. Use the palette to add new
              steps; YAML is regenerated on every change.
            </Caption1>
            <Button
              appearance="subtle"
              icon={<Add16Regular />}
              onClick={() => appendStep('agent_run')}
              disabled={disabled}
            >
              Add agent_run step
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

export default function VisualCanvas(props: VisualCanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  )
}
