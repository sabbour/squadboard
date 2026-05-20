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
import { useRunStream, type IssueRunEventRow, type IssueRunStreamSnapshot, type RunStatus } from '../../hooks/useRunStream.ts'

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
    case 'finished':     return 'Completed'
    case 'error':        return 'Failed'
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

function payloadString(
  payload: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = payload[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

function snippet(value: string, max = 120): string {
  const oneLine = value.replace(/\s+/g, ' ').trim()
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine
}

function plainRunText(value: string): string {
  const trimmed = value.trim()
  if (/auto-dispatched|pickup-ready sweep/i.test(trimmed)) return 'Auto-started by scheduler'
  if (/recovered?.*server restarted|server restarted/i.test(trimmed)) {
    return 'Recovered after restart — the run continued automatically'
  }
  return trimmed.replace(/^\[(.*)\]$/, '$1')
}

function recoveryMessage(payload: Record<string, unknown>): string | null {
  const kind = payloadString(payload, ['kind', 'marker', 'type'])
  const message = payloadString(payload, ['message', 'line', 'summary'])
  if (kind === 'recovery' || message?.toLowerCase().includes('recovered')) {
    return message ? snippet(plainRunText(message)) : 'Recovered after restart — the run continued automatically'
  }
  return null
}

function errorMessage(payload: Record<string, unknown>): string {
  return payloadString(payload, ['message', 'errorMessage', 'error']) ?? 'unknown'
}

function latestRunError(events: IssueRunEventRow[]): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const evt = events[i]
    if (evt.eventType === 'issue.run.error') return errorMessage(evt.payload)
  }
  return null
}

function eventSummary(event: IssueRunEventRow): string {
  const p = event.payload
  switch (event.eventType) {
    case 'issue.run.start':
      return `Run started${p.agentName ? ` — ${String(p.agentName)}` : ''}`
    case 'issue.run.turn': {
      const content = payloadString(p, ['content', 'message', 'text', 'delta'])
      return `Turn ${event.seq + 1}${p.role ? ` (${String(p.role)})` : ''}${content ? ` — ${snippet(plainRunText(content))}` : ''}`
    }
    case 'issue.run.token':
      return `Tokens — in: ${p.inputTokens ?? 0}, out: ${p.outputTokens ?? 0}`
    case 'issue.run.tool_call': {
      const content = payloadString(p, ['command', 'input', 'args', 'message'])
      return `Called ${String(p.toolName ?? p.name ?? 'tool')}${content ? ` — ${snippet(content)}` : ''}`
    }
    case 'issue.run.tool_result': {
      const content = payloadString(p, ['output', 'stdout', 'stderr', 'result', 'content', 'message'])
      return `Result from ${String(p.toolName ?? p.name ?? 'tool')}${content ? ` — ${snippet(plainRunText(content))}` : ''}`
    }
    case 'issue.run.metric': {
      const recovery = recoveryMessage(p)
      if (recovery) return `Recovery: ${recovery}`
      return `Metric recorded (seq ${event.seq})`
    }
    case 'issue.run.finish': {
      const output = payloadString(p, ['output', 'finalOutput', 'summary', 'result'])
      return `Run finished${p.durationMs != null ? ` in ${Math.round(Number(p.durationMs) / 100) / 10}s` : ''}${output ? ` — ${snippet(output)}` : ''}`
    }
    case 'issue.run.error':
      return `Error: ${errorMessage(p)}`
    case 'issue.run.steered':
      return `Steered by ${String(p.actor ?? 'user')}: "${plainRunText(String(p.message ?? '')).slice(0, 60)}"`
    default:
      return event.eventType
  }
}

function formatHHMMSS(ts: string): string {
  const d = new Date(ts)
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
}

function timestampMs(value: string | null | undefined): number | null {
  if (!value) return null
  const ms = new Date(value).getTime()
  return Number.isNaN(ms) ? null : ms
}

function formatElapsedSeconds(totalSeconds: number): string {
  const secs = Math.max(0, Math.floor(totalSeconds))
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}m ${s}s`
}

function terminalEvent(events: IssueRunEventRow[]): IssueRunEventRow | undefined {
  return [...events].reverse().find((event) => event.eventType === 'issue.run.finish' || event.eventType === 'issue.run.error')
}

function displayStatus(status: RunStatus, run: IssueRunStreamSnapshot | null | undefined, events: IssueRunEventRow[]): RunStatus {
  const terminal = terminalEvent(events)
  if (terminal?.eventType === 'issue.run.error') return 'error'
  if (terminal?.eventType === 'issue.run.finish') return 'finished'
  if (run?.status === 'failed' || run?.status === 'cancelled') return 'error'
  if (run?.status === 'completed') return 'finished'
  return status
}

function elapsedLabel(
  startedAt: number | null,
  run: IssueRunStreamSnapshot | null | undefined,
  events: IssueRunEventRow[],
  now: number,
  status: RunStatus,
): string {
  const startMs = timestampMs(run?.startedAt) ?? startedAt
  if (!startMs) return '—'
  if ((status === 'finished' || status === 'error') && typeof run?.durationMs === 'number') {
    return formatElapsedSeconds(run.durationMs / 1000)
  }
  const terminal = terminalEvent(events)
  const terminalAt = run?.completedAt ?? run?.finishedAt ?? terminal?.createdAt ?? ((status === 'finished' || status === 'error') ? run?.updatedAt : undefined)
  const endMs = timestampMs(terminalAt) ?? (status === 'finished' || status === 'error' ? startMs : now)
  return formatElapsedSeconds((endMs - startMs) / 1000)
}

// ─── EventRow ────────────────────────────────────────────────────────────────

function EventRow({ event }: { event: IssueRunEventRow }) {
  const [expanded, setExpanded] = useState(false)
  const recovery = recoveryMessage(event.payload)
  const warning = event.eventType === 'issue.run.steered' || recovery
  const summary = recovery ? `Recovery: ${recovery}` : eventSummary(event)

  return (
    <div
      style={{
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
        padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalM}`,
      }}
    >
      {warning ? (
        <MessageBar
          intent="warning"
          onClick={() => setExpanded((p) => !p)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setExpanded((p) => !p) }}
          role="button"
          tabIndex={0}
          aria-expanded={expanded}
          style={{ cursor: 'pointer' }}
        >
          <MessageBarBody>
            <Caption1 style={{ color: tokens.colorNeutralForeground3, minWidth: 72, fontFamily: 'monospace', marginRight: 8 }}>
              {formatHHMMSS(event.createdAt)}
            </Caption1>
            {summary}
          </MessageBarBody>
        </MessageBar>
      ) : (
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
          <Body1 style={{ flex: 1 }}>{summary}</Body1>
          <span style={{ color: tokens.colorNeutralForeground4, display: 'flex', alignItems: 'center' }}>
            {expanded ? <ChevronDown20Regular /> : <ChevronRight20Regular />}
          </span>
        </div>
      )}
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
  const { events, run, status, error, steer, retry } = useRunStream(runId || null, projectId, issueId)
  const visibleStatus = displayStatus(status, run, events)
  const terminalError = error?.message ?? latestRunError(events)

  // Derive metrics from the event log
  const [now, setNow] = useState(() => Date.now())
  const metrics: MetricState = (() => {
    const m: MetricState = {
      agentName: null,
      model: null,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      turnCount: 0,
      startedAt: timestampMs(run?.startedAt),
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

  // Tick elapsed time only while the run is live.
  useEffect(() => {
    if (visibleStatus !== 'live') return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [visibleStatus])

  const elapsed = elapsedLabel(metrics.startedAt, run, events, now, visibleStatus)

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
            Run {runId.length <= 8 ? runId : runId.slice(-8)}
          </Caption1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalS }}>
          <Badge
            appearance="filled"
            color={
              visibleStatus === 'live' && events.length === 0 ? 'warning'
              : visibleStatus === 'live' ? 'success'
              : visibleStatus === 'finished' ? 'subtle'
              : visibleStatus === 'error' ? 'danger'
              : 'warning'
            }
          >
            {events.length === 0 && visibleStatus === 'live' ? 'Pending' : statusLabel(visibleStatus)}
          </Badge>
          <Caption1 style={{ color: statusColor(visibleStatus) }}>
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
          flexWrap: 'nowrap',
          overflowX: 'auto',
        }}
      >
        <MetricCell label="Input tokens"  value={String(metrics.inputTokens)} />
        <MetricCell label="Output tokens" value={String(metrics.outputTokens)} />
        <MetricCell label="Cost"          value={`$${metrics.costUsd.toFixed(4)}`} />
        <MetricCell label="Turns"         value={String(metrics.turnCount)} />
      </div>

      {/* Reconnecting banner */}
      {visibleStatus === 'reconnecting' && (
        <MessageBar intent="warning">
          <MessageBarBody>Reconnecting to the event stream...</MessageBarBody>
        </MessageBar>
      )}

      {/* Error banner */}
      {visibleStatus === 'error' && (
        <MessageBar intent="error">
          <MessageBarBody>
            {terminalError ?? 'An error occurred'}
            {' '}
            <Button size="small" appearance="transparent" onClick={retry} style={{ padding: 0, minWidth: 0, textDecoration: 'underline' }}>
              Retry
            </Button>
          </MessageBarBody>
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
          <Body1>Waiting for first event…</Body1>
        </div>
      ) : (
        <EventStream events={events} />
      )}

      {/* Steer bar — sticky bottom */}
      {visibleStatus === 'live' && events.length > 0 && <SteerBar status={visibleStatus} onSteer={steer} />}
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
