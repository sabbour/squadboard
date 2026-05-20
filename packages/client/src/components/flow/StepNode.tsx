/**
 * components/flow/StepNode.tsx — generic step-run node renderer for the DAG.
 *
 * Custom React Flow node component used for workflow step kinds
 * (route, agent_run, approve, fan_out, handoff, notify). Visual differences:
 *  - subtle accent colour and an icon glyph per kind
 *  - status-driven border + status badge (pending/running/completed/failed/...)
 *  - optional pulse animation while running
 *
 * Wave 12 N4: nodes are clickable — navigation is handled by IssueFlowDag's
 * onNodeClick callback which reads projectId/issueId from node data.
 * The node div carries cursor:pointer + hover elevation to signal interactivity.
 */
import type React from 'react'
import { Handle, Position } from '@xyflow/react'
import { tokens } from '@fluentui/react-components'
import {
  CompassNorthwest20Regular,
  Settings20Regular,
  CheckmarkCircle20Regular,
  Branch20Regular,
  Handshake20Regular,
  Attach20Regular,
  ArrowClockwise20Regular,
  CalendarClock20Regular,
  Send20Regular,
} from '@fluentui/react-icons'
import { type FlowStepRun } from '../../api/flow.ts'

export interface StepNodeData extends Record<string, unknown> {
  step: FlowStepRun
  /** Provided by IssueFlowDag to enable click-navigation */
  projectId?: string
  /** Provided by IssueFlowDag to enable click-navigation */
  issueId?: string
}

function getKindIcon(kind: string): React.ReactNode {
  switch (kind) {
    case 'route':     return <CompassNorthwest20Regular />
    case 'agent_run': return <Settings20Regular />
    case 'approve':   return <CheckmarkCircle20Regular />
    case 'fan_out':   return <Branch20Regular />
    case 'handoff':   return <Handshake20Regular />
    case 'notify':    return <Send20Regular />
    case 'scheduler': return <CalendarClock20Regular />
    case 'dispatch':  return <Send20Regular />
    case 'recovery':  return <ArrowClockwise20Regular />
    case 'terminal':  return <CheckmarkCircle20Regular />
    default:          return null
  }
}

const KIND_LABEL: Record<string, string> = {
  route: 'Route',
  agent_run: 'Agent run',
  approve: 'Approve',
  fan_out: 'Fan-out',
  handoff: 'Handoff',
  notify: 'Notify',
  scheduler: 'Scheduler',
  dispatch: 'Dispatch',
  recovery: 'Recovery',
  terminal: 'Result',
}

export function statusColors(status: string, kind: string): {
  border: string
  badgeBg: string
  badgeFg: string
  label: string
  pulse: boolean
} {
  // Approve steps in pending/running surface as "waiting review" amber.
  if (kind === 'approve' && (status === 'pending' || status === 'running')) {
    return {
      border: '#d29922',
      badgeBg: 'rgba(210, 153, 34, 0.18)',
      badgeFg: '#d29922',
      label: 'Waiting review',
      pulse: status === 'running',
    }
  }
  switch (status) {
    case 'pending':
      return { border: '#48515a', badgeBg: 'rgba(125, 133, 144, 0.2)', badgeFg: '#9da7b3', label: 'Pending', pulse: false }
    case 'planned':
      return { border: '#48515a', badgeBg: 'rgba(125, 133, 144, 0.2)', badgeFg: '#9da7b3', label: 'Planned', pulse: false }
    case 'attempted':
      return { border: '#d29922', badgeBg: 'rgba(210, 153, 34, 0.18)', badgeFg: '#d29922', label: 'Attempted', pulse: false }
    case 'running':
      return { border: '#388bfd', badgeBg: 'rgba(56, 139, 253, 0.2)', badgeFg: '#58a6ff', label: 'Running', pulse: true }
    case 'splitting':
    case 'waiting_children':
      return {
        border: '#a371f7',
        badgeBg: 'rgba(163, 113, 247, 0.2)',
        badgeFg: '#bc8cff',
        label: status === 'splitting' ? 'Splitting' : 'Waiting children',
        pulse: status === 'splitting',
      }
    case 'completed':
      return { border: '#3fb950', badgeBg: 'rgba(63, 185, 80, 0.18)', badgeFg: '#3fb950', label: 'Completed', pulse: false }
    case 'recovered':
      return { border: '#58a6ff', badgeBg: 'rgba(56, 139, 253, 0.18)', badgeFg: '#58a6ff', label: 'Recovered', pulse: false }
    case 'failed':
      return { border: '#f85149', badgeBg: 'rgba(248, 81, 73, 0.2)', badgeFg: '#ff7b72', label: 'Failed', pulse: false }
    case 'cancelled':
      return { border: '#7d8590', badgeBg: 'rgba(125, 133, 144, 0.2)', badgeFg: '#9da7b3', label: 'Cancelled', pulse: false }
    default:
      return { border: '#48515a', badgeBg: 'rgba(125, 133, 144, 0.2)', badgeFg: '#9da7b3', label: status, pulse: false }
  }
}

export default function StepNode({ data }: { data: StepNodeData }) {
  const step = data.step
  const colors = statusColors(step.status, step.kind)
  const icon = getKindIcon(step.kind)
  const kindLabel = KIND_LABEL[step.kind] ?? step.kind
  const isClickable = Boolean(data.projectId)

  return (
    <>
      <Handle type="target" position={Position.Top} style={{ background: '#48515a' }} />
      <div
        role={isClickable ? 'button' : undefined}
        tabIndex={isClickable ? 0 : undefined}
        style={{
          width: 220,
          minHeight: 86,
          borderRadius: 8,
          border: `1.5px solid ${colors.border}`,
          background: tokens.colorNeutralBackground2,
          padding: '8px 10px',
          fontSize: 12,
          color: tokens.colorNeutralForeground1,
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          boxShadow: colors.pulse
            ? `0 0 0 4px ${colors.border}33`
            : '0 1px 3px rgba(0, 0, 0, 0.25)',
          transition: 'box-shadow 200ms ease-out, transform 120ms ease-out',
          animation: colors.pulse ? 'sb-flow-pulse 1.6s ease-in-out infinite' : undefined,
          cursor: isClickable ? 'pointer' : 'default',
        }}
        onMouseEnter={isClickable ? (e) => {
          const el = e.currentTarget
          el.style.boxShadow = `0 4px 12px rgba(0, 0, 0, 0.4), 0 0 0 1px ${colors.border}`
          el.style.transform = 'translateY(-1px)'
        } : undefined}
        onMouseLeave={isClickable ? (e) => {
          const el = e.currentTarget
          el.style.boxShadow = colors.pulse ? `0 0 0 4px ${colors.border}33` : '0 1px 3px rgba(0, 0, 0, 0.25)'
          el.style.transform = ''
        } : undefined}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: tokens.colorNeutralForeground3, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            <span style={{ marginRight: 4 }}>{icon}</span>
            {kindLabel}
          </span>
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              padding: '2px 6px',
              borderRadius: 999,
              background: colors.badgeBg,
              color: colors.badgeFg,
            }}
          >
            {colors.label}
          </span>
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
          title={step.label}
        >
          {step.label}
        </div>
        {(step.agentName ?? step.agentRole) && (
          <div
            style={{
              fontSize: 11,
              color: tokens.colorNeutralForeground2,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {step.agentName ?? '—'}
            {step.agentRole ? <span style={{ color: tokens.colorNeutralForeground3 }}> · {step.agentRole}</span> : null}
          </div>
        )}
        {step.outputSummary && (
          <div
            style={{
              fontSize: 11,
              color: tokens.colorNeutralForeground2,
              overflow: 'hidden',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              lineHeight: 1.25,
            }}
            title={step.outputSummary}
          >
            {step.outputSummary}
          </div>
        )}
        {step.deliverables.length > 0 && (
          <div style={{ fontSize: 10, color: tokens.colorNeutralForeground3 }}>
            <Attach20Regular style={{ verticalAlign: 'middle', marginRight: '3px' }} />{step.deliverables.length} deliverable{step.deliverables.length === 1 ? '' : 's'}
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} style={{ background: '#48515a' }} />
    </>
  )
}
