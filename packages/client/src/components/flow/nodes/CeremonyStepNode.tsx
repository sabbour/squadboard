/**
 * components/flow/nodes/CeremonyStepNode.tsx — Phase 16
 *
 * Editor-context node renderer for the Ceremony Editor's Visual tab.
 * Distinct from the run-context StepNode (which renders live step_run
 * state with status badges); this one renders an *authored* step from
 * the graph projection produced by `services/ceremony-graph.ts`.
 *
 * Reuses the same icon glyphs and accent colours used by the Phase 12
 * read-only DAG node so the visual style is consistent across the app.
 *
 * Wave 12 N4: Added projectId + ceremonyId to data type. When both are
 * present the node is clickable and navigates to the ceremony editor.
 * VisualCanvas (editor) omits these so selection behavior is unchanged.
 */
import type React from 'react'
import { useNavigate } from 'react-router'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { tokens } from '@fluentui/react-components'
import {
  CompassNorthwest20Regular,
  Settings20Regular,
  CheckmarkCircle20Regular,
  Branch20Regular,
  Handshake20Regular,
} from '@fluentui/react-icons'
import type { CeremonyStep, StepKind } from '../../../services/ceremony-graph.ts'

export function getKindIcon(kind: StepKind): React.ReactNode {
  switch (kind) {
    case 'route':     return <CompassNorthwest20Regular />
    case 'agent_run': return <Settings20Regular />
    case 'approve':   return <CheckmarkCircle20Regular />
    case 'fan_out':   return <Branch20Regular />
    case 'handoff':   return <Handshake20Regular />
  }
}

export const KIND_LABEL: Record<StepKind, string> = {
  route: 'Route',
  agent_run: 'Agent run',
  approve: 'Peer review',
  fan_out: 'Fan out',
  handoff: 'Handoff',
}

export const KIND_ACCENT: Record<StepKind, string> = {
  route: '#388bfd',
  agent_run: '#3fb950',
  approve: '#d29922',
  fan_out: '#a371f7',
  handoff: '#f78166',
}

export interface CeremonyStepNodeData extends Record<string, unknown> {
  step: CeremonyStep
  selected?: boolean
  isChild?: boolean
  /** When provided the node is clickable and navigates to the ceremony editor */
  projectId?: string
  /** When provided (with projectId) the node is clickable */
  ceremonyId?: string
}

function summary(step: CeremonyStep): string {
  switch (step.kind) {
    case 'route':
    case 'agent_run':
      return step.agent ? `agent: ${step.agent}` : 'no agent'
    case 'approve': {
      const approvers = step.approvers ?? []
      return approvers.length === 0
        ? 'no approvers set'
        : `approvers: ${approvers.slice(0, 3).join(', ')}${approvers.length > 3 ? '…' : ''}`
    }
    case 'fan_out': {
      const agents = step.agents?.length ? step.agents.slice(0, 3).join(', ') + (step.agents.length > 3 ? '…' : '') : null
      const splitBy = step.split_by ?? 'agents'
      const mode = step.mode ?? 'parallel'
      const childCount = step.steps?.length ?? 0
      const childLabel = childCount === 1 ? '1 child step' : `${childCount} child steps`
      return agents
        ? `${mode} · ${agents} · ${childLabel}`
        : `split=${splitBy} · ${mode} · ${childLabel}`
    }
    case 'handoff':
      return step.to ? `to: ${step.to}` : 'no target'
  }
}

export default function CeremonyStepNode(props: NodeProps) {
  const navigate = useNavigate()
  const data = props.data as CeremonyStepNodeData
  const step = data.step
  const accent = KIND_ACCENT[step.kind]
  const icon = getKindIcon(step.kind)
  const kindLabel = KIND_LABEL[step.kind]
  const sel = props.selected ?? data.selected ?? false
  const child = data.isChild ?? false
  const isClickable = Boolean(data.projectId && data.ceremonyId)

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isClickable) return
    // Don't fire if the click was on an interactive child element
    if (e.target !== e.currentTarget && (e.target as HTMLElement).closest('button, a, input, select, textarea')) return
    void navigate(`/projects/${data.projectId}/ceremonies/${data.ceremonyId}`)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!isClickable) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      void navigate(`/projects/${data.projectId}/ceremonies/${data.ceremonyId}`)
    }
  }

  return (
    <>
      <Handle type="target" position={Position.Top} style={{ background: '#48515a' }} />
      <div
        role={isClickable ? 'button' : undefined}
        tabIndex={isClickable ? 0 : undefined}
        onClick={isClickable ? handleClick : undefined}
        onKeyDown={isClickable ? handleKeyDown : undefined}
        style={{
          width: 220,
          minHeight: child ? 64 : 84,
          borderRadius: 8,
          border: `${sel ? 2.5 : 1.5}px solid ${sel ? accent : 'rgba(125,133,144,0.55)'}`,
          background: tokens.colorNeutralBackground2,
          padding: '8px 10px',
          fontSize: 12,
          color: tokens.colorNeutralForeground1,
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          boxShadow: sel ? `0 0 0 4px ${accent}33` : '0 1px 3px rgba(0, 0, 0, 0.25)',
          opacity: child ? 0.92 : 1,
          cursor: isClickable ? 'pointer' : 'default',
          transition: 'box-shadow 200ms ease-out',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span
            style={{
              fontSize: 11,
              color: accent,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              fontWeight: 600,
            }}
          >
            <span style={{ marginRight: 4 }}>{icon}</span>
            {kindLabel}
          </span>
          {child && (
            <span style={{ fontSize: 9, color: tokens.colorNeutralForeground3 }}>child</span>
          )}
        </div>
        <div
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: tokens.colorNeutralForeground1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={step.label ?? KIND_LABEL[step.kind]}
        >
          {step.label?.trim() ? step.label : <em style={{ color: tokens.colorNeutralForeground3 }}>(unnamed)</em>}
        </div>
        <div
          style={{
            fontSize: 11,
            color: tokens.colorNeutralForeground2,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {summary(step)}
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} style={{ background: '#48515a' }} />
    </>
  )
}
