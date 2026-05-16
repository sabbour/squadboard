/**
 * LiveRunViewer — Wave 28 JIS-T8
 *
 * Page-level container for watching a running issue_run in real time.
 * Consumes useRunStream for data; renders header, metrics, event stream, steer bar.
 *
 * Route: /projects/:projectId/issues/:issueId/runs/:runId/live
 */

import { useRef, useState, useEffect } from 'react'
import { useParams } from 'react-router'
import {
  Badge,
  Body1,
  Button,
  Caption1,
  Input,
  MessageBar,
  MessageBarBody,
  Spinner,
  Text,
  tokens,
} from '@fluentui/react-components'
import {
  ArrowClockwise20Regular,
  Bot20Regular,
  CheckmarkCircle20Regular,
  ChevronDown20Regular,
  ChevronRight20Regular,
  DismissCircle20Regular,
  ErrorCircle20Regular,
  Play20Regular,
  Send20Regular,
  Wrench20Regular,
} from '@fluentui/react-icons'
import { useRunStream, type IssueRunEventRow, type RunStatus } from '../../hooks/useRunStream.ts'

// ─── Types ──────────────────────────────────────────────────────────────────

interface MetricState {
  agentName: string | null
  model: string | null
  inputTokens: number
  outputTokens: number
  costUsd: number
  turnCount: number
  startedAt: number | null
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function statusColor(status: RunStatus): string {
  switch (status) {
    case 'live':         return tokens.colorPaletteGreenForeground1
    case 'finished':     return tokens.colorPaletteGreenForeground1
    case 'error':        return tokens.colorPaletteRedForeground1
    case 'reconnecting': return tokens.colorPaletteYellowForeground1
    case 'loading':      return tokens.colorNeutralForeground3
    default:             return tokens.colorNeutralForeground3
  }
}

function statusLabel(status: RunStatus): string {
  switch (status) {
    case 'idle':         return 'Idle'
    case 'loading':      return 'Loading'
    case 'live':         return 'Running'
    case 'reconnecting': return 'Reconnecting'
    case 'finished':     return 'Finished'
    case 'error':        return 'Error'
  }
}

function eventIcon(eventType: string) {
  if (eventType === 'issue.run.start')      return <Play20Regular />
  if (eventType === 'issue.run.finish')     return <CheckmarkCircle20Regular />
  if (eventType === 'issue.run.error')      return <ErrorCircle20Regular />
  if (eventType === 'issue.run.turn')       return <Bot20Regular />
  if (eventType === 'issue.run.tool_call' || eventType === 'issue.run.tool_result')
                                            return <Wrench20Regular />
  if (eventType === 'issue.run.steered')    return <ArrowClockwise20Regular />
  return <ChevronRight20Regular />
}

function eventSummary(event: IssueRunEventRow): string {
  const p = event.payload
  switch (event.eventType) {
    case 'issue.run.start':
      return `Run started${p.agentName ? ` — ${String(p.agentName)}` : ''}`
    case 'issue.run.turn':
      return `Turn ${event.seq + 1}${p.role ? ` (${String(p.role)})` : ''}`
    case 'issue.run.token':
      return `Tokens — in: ${p.inputTokens ?? 0}, out: ${p.outputTokens ?? 0}`
    case 'issue.run.tool_call':
      return `Called ${String(p.toolName ?? 'tool')}`
    case 'issue.run.tool_result':
      return `Result from ${String(p.toolName ?? 'tool')}`
    case 'issue.run.metric':
      return `Metric recorded (seq ${event.seq})`
    case 'issue.run.finish':
      return `Run finished${p.durationMs != null ? ` in ${Math.round(Number(p.durationMs) / 100) / 10}s` : ''}`
    case 'issue.run.error':
      return `Error: ${String(p.message ?? 'unknown')}`
    case 'issue.run.steered':
      return `Steered by ${String(p.actor ?? 'user')}: "${String(p.message ?? '').slice(0, 60)}"`
    default:
      return event.eventType
  }
}

function formatHHMMSS(ts: string): string {
  const d = new Date(ts)
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
}

function elapsedLabel(startedAt: number | null): string {
  if (!startedAt) return '—'
  const secs = Math.floor((Date.now() - startedAt) / 1000)
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}m ${s}s`
}

// ─── EventRow ────────────────────────────────────────────────────────────────

function EventRow({ event }: { event: IssueRunEventRow }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div
      style={{
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
        padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalM}`,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: tokens.spacingHorizontalS,
          cursor: 'pointer',
          minHeight: 32,
        }}
        onClick={() => setExpanded((p) => !p)}
        role="button"
        aria-expanded={expanded}
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setExpanded((p) => !p) }}
      >
        <span style={{ color: tokens.colorNeutralForeground3, display: 'flex', alignItems: 'center' }}>
          {eventIcon(event.eventType)}
        </span>
        <Caption1 style={{ color: tokens.colorNeutralForeground3, minWidth: 72, fontFamily: 'monospace' }}>
          {formatHHMMSS(event.createdAt)}
        </Caption1>
        <Body1 style={{ flex: 1 }}>{eventSummary(event)}</Body1>
        <span style={{ color: tokens.colorNeutralForeground4, display: 'flex', alignItems: 'center' }}>
          {expanded ? <ChevronDown20Regular /> : <ChevronRight20Regular />}
        </span>
      </div>
      {expanded && (
        <pre
          style={{
            margin: `${tokens.spacingVerticalXS} 0 0 28px`,
            padding: tokens.spacingHorizontalS,
            background: tokens.colorNeutralBackground2,
            borderRadius: tokens.borderRadiusMedium,
            fontSize: 11,
            color: tokens.colorNeutralForeground2,
            overflowX: 'auto',
            maxHeight: 200,
          }}
        >
          {JSON.stringify(event.payload, null, 2)}
        </pre>
      )}
    </div>
  )
}

// ─── EventStream ─────────────────────────────────────────────────────────────

const VIRTUAL_THRESHOLD = 100
const VIRTUAL_WINDOW = 100

function EventStream({ events }: { events: IssueRunEventRow[] }) {
  const bottomRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom on new events
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [events.length])

  // Simple windowing: show the last VIRTUAL_WINDOW events if list is large
  const visible =
    events.length > VIRTUAL_THRESHOLD
      ? events.slice(events.length - VIRTUAL_WINDOW)
      : events

  const hidden = events.length - visible.length

  return (
    <div
      role="log"
      aria-live="polite"
      aria-label="Run event stream"
      style={{
        flex: 1,
        overflowY: 'auto',
        background: tokens.colorNeutralBackground1,
        contentVisibility: 'auto',
      }}
    >
      {hidden > 0 && (
        <div
          style={{
            padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
            color: tokens.colorNeutralForeground3,
            borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
          }}
        >
          <Caption1>{hidden} earlier events not shown</Caption1>
        </div>
      )}
      {visible.map((evt) => (
        <EventRow key={`${evt.eventType}:${evt.seq}`} event={evt} />
      ))}
      <div ref={bottomRef} />
    </div>
  )
}

// ─── SteerBar ────────────────────────────────────────────────────────────────

function SteerBar({
  status,
  onSteer,
}: {
  status: RunStatus
  onSteer: (msg: string) => Promise<void>
}) {
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [sentAt, setSentAt] = useState<string | null>(null)
  const [steerError, setSteerError] = useState<string | null>(null)

  const isLive = status === 'live'

  async function handleSend() {
    const msg = draft.trim()
    if (!msg || !isLive) return
    setSending(true)
    setSteerError(null)
    setSentAt(null)
    try {
      await onSteer(msg)
      setDraft('')
      setSentAt(new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }))
    } catch (e) {
      setSteerError((e as Error)?.message ?? 'Failed to send steering message')
    } finally {
      setSending(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
    }
  }

  return (
    <div
      style={{
        borderTop: `1px solid ${tokens.colorNeutralStroke1}`,
        padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
        background: tokens.colorNeutralBackground1,
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalXS,
      }}
    >
      <div style={{ display: 'flex', gap: tokens.spacingHorizontalS, alignItems: 'center' }}>
        <Input
          aria-label="Steering message"
          placeholder={isLive ? 'Send a message to the agent...' : 'Run is not active'}
          value={draft}
          onChange={(_, d) => setDraft(d.value)}
          onKeyDown={handleKeyDown}
          disabled={!isLive || sending}
          style={{ flex: 1 }}
        />
        <Button
          appearance="primary"
          icon={<Send20Regular />}
          disabled={!isLive || !draft.trim() || sending}
          onClick={() => void handleSend()}
          aria-label="Send steering message"
        >
          Send
        </Button>
      </div>
      {sentAt && (
        <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>
          Sent at {sentAt}
        </Caption1>
      )}
      {steerError && (
        <Caption1 style={{ color: tokens.colorPaletteRedForeground1 }}>
          {steerError}
        </Caption1>
      )}
    </div>
  )
}

// ─── LiveRunViewer ────────────────────────────────────────────────────────────

export default function LiveRunViewer() {
  const { projectId = '', issueId = '', runId = '' } = useParams()
  const { events, status, error, steer } = useRunStream(runId || null, projectId, issueId)

  // Derive metrics from the event log
  const [elapsed, setElapsed] = useState('—')
  const metrics: MetricState = (() => {
    const m: MetricState = {
      agentName: null,
      model: null,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      turnCount: 0,
      startedAt: null,
    }
    for (const evt of events) {
      const p = evt.payload
      if (evt.eventType === 'issue.run.start') {
        if (typeof p.agentName === 'string') m.agentName = p.agentName
        if (typeof p.model === 'string') m.model = p.model
        m.startedAt = new Date(evt.createdAt).getTime()
      }
      if (evt.eventType === 'issue.run.token') {
        m.inputTokens += (typeof p.inputTokens === 'number' ? p.inputTokens : 0)
        m.outputTokens += (typeof p.outputTokens === 'number' ? p.outputTokens : 0)
        m.costUsd += (typeof p.cost === 'number' ? p.cost : 0)
      }
      if (evt.eventType === 'issue.run.turn') {
        m.turnCount += 1
      }
    }
    return m
  })()

  // Tick elapsed time
  useEffect(() => {
    if (status !== 'live') return
    const id = setInterval(() => setElapsed(elapsedLabel(metrics.startedAt)), 1000)
    return () => clearInterval(id)
  }, [status, metrics.startedAt])

  // ── States: loading ──────────────────────────────────────────────────────

  if (status === 'loading') {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          gap: tokens.spacingHorizontalS,
        }}
      >
        <Spinner size="small" />
        <Body1>Loading run events...</Body1>
      </div>
    )
  }

  // ── Layout ───────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: tokens.colorNeutralBackground1,
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL}`,
          borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
          display: 'flex',
          alignItems: 'center',
          gap: tokens.spacingHorizontalM,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalS }}>
            <Text size={500} weight="semibold" truncate>
              {metrics.agentName ?? 'Run'}
            </Text>
            {metrics.model && (
              <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>
                {metrics.model}
              </Caption1>
            )}
          </div>
          <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>
            Run {runId.slice(0, 8)}
          </Caption1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalS }}>
          <Badge
            appearance="filled"
            color={
              status === 'live' ? 'success'
              : status === 'finished' ? 'subtle'
              : status === 'error' ? 'danger'
              : 'warning'
            }
          >
            {statusLabel(status)}
          </Badge>
          <Caption1 style={{ color: statusColor(status) }}>
            {elapsed}
          </Caption1>
        </div>
      </div>

      {/* Metrics row */}
      <div
        style={{
          display: 'flex',
          gap: tokens.spacingHorizontalL,
          padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalL}`,
          borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
          background: tokens.colorNeutralBackground2,
          flexWrap: 'wrap',
        }}
      >
        <MetricCell label="Input tokens"  value={String(metrics.inputTokens)} />
        <MetricCell label="Output tokens" value={String(metrics.outputTokens)} />
        <MetricCell label="Cost"          value={`$${metrics.costUsd.toFixed(4)}`} />
        <MetricCell label="Turns"         value={String(metrics.turnCount)} />
      </div>

      {/* Reconnecting banner */}
      {status === 'reconnecting' && (
        <MessageBar intent="warning">
          <MessageBarBody>Reconnecting to the event stream...</MessageBarBody>
        </MessageBar>
      )}

      {/* Error banner */}
      {status === 'error' && error && (
        <MessageBar intent="error">
          <MessageBarBody>{error.message}</MessageBarBody>
        </MessageBar>
      )}

      {/* Event stream */}
      {events.length === 0 ? (
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'column',
            gap: tokens.spacingVerticalS,
            color: tokens.colorNeutralForeground3,
          }}
        >
          <DismissCircle20Regular />
          <Body1>No events yet</Body1>
          <Caption1>The run has not emitted any events.</Caption1>
        </div>
      ) : (
        <EventStream events={events} />
      )}

      {/* Steer bar — sticky bottom */}
      <SteerBar status={status} onSteer={steer} />
    </div>
  )
}

// ─── MetricCell ──────────────────────────────────────────────────────────────

function MetricCell({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
      <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>{label}</Caption1>
      <Body1 style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</Body1>
    </div>
  )
}
