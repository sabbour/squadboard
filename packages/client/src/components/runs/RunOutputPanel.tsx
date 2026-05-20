import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { type IssueRun, useCancelRun } from '../../api/runs.ts'
import { type Agent } from '../../api/agents.ts'
import RunStatusBadge from './RunStatusBadge.tsx'
import CostDisplay from './CostDisplay.tsx'
import { RoutingTierBadge } from '../routing/RoutingTierBadge.tsx'
import GitActions from './GitActions.tsx'
import { wsClient } from '../../realtime/ws-client.ts'
import { useRunStream as useStructuredRunStream, type IssueRunEventRow } from '../../hooks/useRunStream.ts'
import { MessageBar, MessageBarBody, Spinner } from '@fluentui/react-components'
import {
  ArrowClockwise20Regular,
  Bot20Regular,
  Checkmark20Regular,
  Dismiss20Regular,
  ErrorCircle20Regular,
  Play20Regular,
  Search20Regular,
  Wrench20Regular,
} from '@fluentui/react-icons'

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

/** Stream run output chunks via WS if connected, falling back to SSE EventSource. */
function useRunOutputChunks(projectId: string, runId: string, enabled: boolean): string[] {
  const [chunks, setChunks] = useState<string[]>([])

  useEffect(() => {
    if (!enabled || !runId) return
    setChunks([])

    // Primary: WebSocket
    if (wsClient.state === 'connected') {
      wsClient.send({ type: 'subscribe_run', runId })

      const handler = (payload: { runId?: string; line?: string; chunk?: string }) => {
        if (payload.runId === runId) {
          const text = streamTextFromPayload(payload)
          if (text) setChunks((prev) => [...prev, text])
        }
      }
      wsClient.on('run.output', handler)

      return () => {
        wsClient.off('run.output', handler)
        wsClient.send({ type: 'unsubscribe_run', runId })
      }
    }

    // Fallback: SSE EventSource (original behaviour)
    const es = new EventSource(`${BASE}/api/projects/${projectId}/runs/${runId}/stream`)
    es.onmessage = (e) => {
      const text = streamTextFromSse(e.data as string)
      if (text) setChunks((prev) => [...prev, text])
    }
    es.onerror = () => es.close()
    return () => es.close()
  }, [projectId, runId, enabled])

  return chunks
}

type TimelineTone = 'muted' | 'info' | 'success' | 'warning' | 'danger' | 'log'

interface TimelineItem {
  id: string
  title: string
  detail?: string
  meta?: string
  tone: TimelineTone
  icon: ReactNode
  messageBar?: boolean
}

const RECOVERY_PATTERN = /\b(recovered?|restart(?:ed|ing)?|reconnect(?:ed|ing)?|resum(?:e|ed|ing)?|heartbeat|lease)\b/i

function streamTextFromPayload(payload: { line?: string; chunk?: string }): string | null {
  if (typeof payload.chunk === 'string') return payload.chunk
  if (typeof payload.line === 'string') return payload.line.endsWith('\n') ? payload.line : `${payload.line}\n`
  return null
}

function streamTextFromSse(data: string): string | null {
  try {
    const parsed = JSON.parse(data) as { type?: unknown; chunk?: unknown; line?: unknown; message?: unknown }
    if (parsed.type === 'output') return streamTextFromPayload(parsed as { line?: string; chunk?: string })
    if (parsed.type === 'error' && typeof parsed.message === 'string') return `Error: ${parsed.message}\n`
    return null
  } catch {
    return data.endsWith('\n') ? data : `${data}\n`
  }
}

function outputLinesFromText(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .map(plainLogLine)
}

function plainLogLine(line: string): string {
  const trimmed = line.trim()
  if (/auto-dispatched|pickup-ready sweep/i.test(trimmed)) return 'Auto-started by scheduler'
  if (/recovered?.*server restarted|server restarted/i.test(trimmed)) {
    return 'Recovered after restart — the run continued automatically'
  }
  return trimmed.replace(/^\[(.*)\]$/, '$1')
}

function formatElapsed(startedAt: string | undefined, completedAt: string | undefined, now: number): string {
  if (!startedAt) return 'Not started'
  const start = new Date(startedAt).getTime()
  if (Number.isNaN(start)) return '—'
  const completed = completedAt ? new Date(completedAt).getTime() : now
  const end = Number.isNaN(completed) ? now : completed
  const secs = Math.max(0, Math.round((end - start) / 1000))
  if (secs < 60) return `${secs}s`
  const minutes = Math.floor(secs / 60)
  const seconds = secs % 60
  if (minutes < 60) return `${minutes}m ${seconds}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

function formatTime(value?: string): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
}

function previewText(value: unknown, fallback = 'No detail available'): string {
  if (typeof value !== 'string') return fallback
  const compact = value.replace(/\s+/g, ' ').trim()
  if (!compact) return fallback
  return compact.length > 140 ? `${compact.slice(0, 137)}…` : compact
}

function payloadText(payload: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = payload[key]
    if (typeof value === 'string' && value.trim()) return plainLogLine(value)
  }
  return undefined
}

function recoveryDetail(event: IssueRunEventRow): string | undefined {
  const kind = payloadText(event.payload, ['kind', 'marker', 'type'])
  const message = payloadText(event.payload, ['message', 'line', 'summary'])
  if (kind === 'recovery' || (message && isRecoveryLine(message))) {
    return message ?? 'Recovered after restart — the run continued automatically'
  }
  return undefined
}

function eventTitle(event: IssueRunEventRow): string {
  const p = event.payload
  switch (event.eventType) {
    case 'issue.run.start':
      return `Started${typeof p.agentName === 'string' ? ` ${p.agentName}` : ''}`
    case 'issue.run.turn':
      return typeof p.role === 'string' ? `Agent turn (${p.role})` : 'Agent turn'
    case 'issue.run.tool_call':
      return `Tool call${typeof p.toolName === 'string' ? `: ${p.toolName}` : ''}`
    case 'issue.run.tool_result':
      return `Tool result${typeof p.toolName === 'string' ? `: ${p.toolName}` : ''}`
    case 'issue.run.metric':
    case 'issue.run.token':
      if (recoveryDetail(event)) return 'Recovery marker'
      return 'Usage updated'
    case 'issue.run.finish':
      return 'Run completed'
    case 'issue.run.error':
      return 'Run error'
    case 'issue.run.steered':
      return 'Steering message sent'
    default:
      return event.eventType
  }
}

function eventDetail(event: IssueRunEventRow): string | undefined {
  const p = event.payload
  switch (event.eventType) {
    case 'issue.run.start':
      return typeof p.taskTitle === 'string' ? p.taskTitle : undefined
    case 'issue.run.turn':
      return previewText(p.content, '')
    case 'issue.run.tool_call':
    case 'issue.run.tool_result':
      return previewText(p.input ?? p.output ?? p.content, '')
    case 'issue.run.metric':
    case 'issue.run.token': {
      const recovery = recoveryDetail(event)
      if (recovery) return recovery
      const input = typeof p.inputTokens === 'number' ? p.inputTokens : undefined
      const output = typeof p.outputTokens === 'number' ? p.outputTokens : undefined
      const total = typeof p.tokenCounts === 'object' && p.tokenCounts !== null && 'total' in p.tokenCounts
        ? (p.tokenCounts as { total?: unknown }).total
        : undefined
      if (input != null || output != null) return `Input ${input ?? 0}, output ${output ?? 0}`
      if (typeof total === 'number') return `${total} tokens`
      return undefined
    }
    case 'issue.run.finish':
      return typeof p.durationMs === 'number' ? `Finished in ${Math.round(p.durationMs / 100) / 10}s` : undefined
    case 'issue.run.error':
      return previewText(p.message, '')
    case 'issue.run.steered':
      return payloadText(p, ['message', 'note']) ?? ''
    default:
      return undefined
  }
}

function eventTone(eventType: string): TimelineTone {
  if (eventType === 'issue.run.finish') return 'success'
  if (eventType === 'issue.run.error') return 'danger'
  if (eventType === 'issue.run.steered') return 'warning'
  if (eventType === 'issue.run.tool_call' || eventType === 'issue.run.tool_result') return 'info'
  return 'muted'
}

function eventIcon(eventType: string): ReactNode {
  if (eventType === 'issue.run.finish') return <Checkmark20Regular />
  if (eventType === 'issue.run.error') return <ErrorCircle20Regular />
  if (eventType === 'issue.run.tool_call' || eventType === 'issue.run.tool_result') return <Wrench20Regular />
  if (eventType === 'issue.run.steered') return <ArrowClockwise20Regular />
  if (eventType === 'issue.run.start') return <Play20Regular />
  return <Bot20Regular />
}

function terminalTitle(status: IssueRun['status']): string {
  if (status === 'completed') return 'Completed'
  if (status === 'failed') return 'Failed'
  if (status === 'cancelled') return 'Cancelled'
  if (status === 'pending') return 'Queued'
  return 'Running'
}

function isRecoveryLine(line: string): boolean {
  return RECOVERY_PATTERN.test(line)
}

function deriveActiveStep(run: IssueRun, events: IssueRunEventRow[], outputLines: string[]): string {
  if (run.status === 'pending') return 'Waiting for the agent to start'
  if (run.status === 'completed') return 'Run completed'
  if (run.status === 'failed') return run.errorMessage ? previewText(run.errorMessage) : 'Run failed'
  if (run.status === 'cancelled') return 'Run cancelled'

  const interestingEvent = [...events].reverse().find((event) =>
    ['issue.run.turn', 'issue.run.tool_call', 'issue.run.tool_result', 'issue.run.steered', 'issue.run.start'].includes(event.eventType),
  )
  if (interestingEvent) {
    const detail = eventDetail(interestingEvent)
    return detail ? `${eventTitle(interestingEvent)} — ${detail}` : eventTitle(interestingEvent)
  }

  const latestLine = [...outputLines].reverse().find((line) => !isRecoveryLine(line))
  if (latestLine) return previewText(latestLine)
  return 'Streaming live output'
}

function buildTimeline(
  run: IssueRun,
  events: IssueRunEventRow[],
  outputLines: string[],
  recoveryMessages: string[] = [],
): TimelineItem[] {
  const items: TimelineItem[] = []

  if (run.startedAt) {
    items.push({
      id: 'started',
      title: 'Run started',
      meta: formatTime(run.startedAt),
      tone: 'info',
      icon: <Play20Regular />,
    })
  }

  for (const event of events) {
    items.push({
      id: `event-${event.eventType}-${event.seq}`,
      title: eventTitle(event),
      detail: eventDetail(event),
      meta: formatTime(event.createdAt),
      tone: recoveryDetail(event) ? 'warning' : eventTone(event.eventType),
      icon: eventIcon(event.eventType),
      messageBar: event.eventType === 'issue.run.steered' || Boolean(recoveryDetail(event)),
    })
  }

  outputLines.forEach((line, index) => {
    const recovery = isRecoveryLine(line)
    items.push({
      id: `log-${index}`,
      title: recovery ? 'Recovery marker' : 'Log output',
      detail: line,
      meta: `log ${String(index + 1).padStart(2, '0')}`,
      tone: recovery ? 'warning' : 'log',
      icon: recovery ? <ArrowClockwise20Regular /> : <Bot20Regular />,
      messageBar: recovery,
    })
  })

  recoveryMessages
    .filter((line) => !outputLines.includes(line))
    .forEach((line, index) => {
      items.push({
        id: `recovery-${index}`,
        title: 'Recovery marker',
        detail: line,
        meta: 'recovery',
        tone: 'warning',
        icon: <ArrowClockwise20Regular />,
        messageBar: true,
      })
    })

  if (run.errorMessage) {
    items.push({
      id: 'error',
      title: 'Error',
      detail: run.errorMessage,
      meta: run.completedAt ? formatTime(run.completedAt) : undefined,
      tone: 'danger',
      icon: <ErrorCircle20Regular />,
    })
  }

  if (run.completedAt) {
    items.push({
      id: 'completed',
      title: terminalTitle(run.status),
      meta: formatTime(run.completedAt),
      tone: run.status === 'completed' ? 'success' : run.status === 'failed' ? 'danger' : 'muted',
      icon: run.status === 'completed' ? <Checkmark20Regular /> : <Dismiss20Regular />,
    })
  }

  if (items.length === 0) {
    items.push({
      id: 'waiting',
      title: run.status === 'pending' ? 'Queued for execution' : 'Waiting for output',
      detail: 'Waiting for first event…',
      tone: 'muted',
      icon: <Play20Regular />,
    })
  }

  return items.slice(-120)
}

function toneColor(tone: TimelineTone): string {
  switch (tone) {
    case 'success': return '#3fb950'
    case 'warning': return '#d29922'
    case 'danger': return '#f85149'
    case 'info': return '#58a6ff'
    case 'log': return '#39d353'
    default: return '#8b949e'
  }
}

function kindLabel(kind: IssueRun['kind'] | string | undefined): string {
  if (kind === 'peer_review') return 'Peer review'
  if (kind === 'route') return 'Routing'
  if (kind === 'approve') return 'Approval'
  return 'Agent run'
}

function normalizeStreamStatus(status?: string): IssueRun['status'] | null {
  if (status === 'pending' || status === 'running' || status === 'completed' || status === 'failed' || status === 'cancelled') {
    return status
  }
  if (status === 'splitting' || status === 'waiting_children') return 'running'
  return null
}

function runSuffix(runId: string): string {
  return runId.length <= 8 ? runId : runId.slice(-8)
}

function metricTotals(events: IssueRunEventRow[], streamRun?: { inputTokens?: number; outputTokens?: number; costTokens?: number } | null) {
  let inputTokens = streamRun?.inputTokens ?? 0
  let outputTokens = streamRun?.outputTokens ?? 0
  let turns = events.filter((event) => event.eventType === 'issue.run.turn').length

  if (inputTokens === 0 && outputTokens === 0) {
    for (const event of events) {
      const p = event.payload
      if (event.eventType === 'issue.run.metric' || event.eventType === 'issue.run.token') {
        inputTokens += typeof p.inputTokens === 'number' ? p.inputTokens : 0
        outputTokens += typeof p.outputTokens === 'number' ? p.outputTokens : 0
      }
    }
  }

  if (turns === 0 && events.length > 0) {
    turns = events.filter((event) => event.eventType !== 'issue.run.metric' && event.eventType !== 'issue.run.token').length
  }

  return {
    turns,
    inputTokens,
    outputTokens,
    totalTokens: streamRun?.costTokens ?? inputTokens + outputTokens,
  }
}

interface RunOutputPanelProps {
  projectId: string
  run: IssueRun
  agent?: Agent
}

export default function RunOutputPanel({ projectId, run, agent }: RunOutputPanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const { events, run: streamRun, status: streamStatus, steer } = useStructuredRunStream(run.id, projectId, run.issueId, { disconnectOnUnmount: false })
  const effectiveStatus = normalizeStreamStatus(streamRun?.status) ?? run.status
  const effectiveRun: IssueRun = {
    ...run,
    status: effectiveStatus,
    workspacePath: run.workspacePath ?? streamRun?.workspacePath ?? undefined,
    startedAt: run.startedAt ?? streamRun?.startedAt ?? undefined,
    completedAt: run.completedAt ?? streamRun?.completedAt ?? undefined,
    heartbeatAt: run.heartbeatAt ?? streamRun?.heartbeatAt ?? undefined,
    leaseExpiresAt: run.leaseExpiresAt ?? streamRun?.leaseExpiresAt ?? undefined,
    costTokens: run.costTokens ?? streamRun?.costTokens,
    costUsd: run.costUsd ?? streamRun?.costUsd,
    errorMessage: run.errorMessage ?? streamRun?.errorMessage ?? undefined,
  }
  const isActive = effectiveRun.status === 'running' || effectiveRun.status === 'pending'
  const canSteer = streamStatus === 'live' && effectiveRun.status === 'running'
  const chunks = useRunOutputChunks(projectId, run.id, isActive)
  const cancelRun = useCancelRun(projectId)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!isActive) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [isActive])

  const streamedText = chunks.join('')
  const displayText = isActive && streamedText.trim().length > 0 ? streamedText : (effectiveRun.output ?? '')
  const displayLines = useMemo(() => outputLinesFromText(displayText), [displayText])
  const recoveryLines = useMemo(() => {
    const lines = displayLines.filter(isRecoveryLine)
    if (streamRun?.recovery?.message) lines.push(streamRun.recovery.message)
    if (streamRun?.staleReason) lines.push(`Stale run: ${streamRun.staleReason}`)
    return Array.from(new Set(lines))
  }, [displayLines, streamRun?.recovery?.message, streamRun?.staleReason])
  const timeline = useMemo(() => buildTimeline(effectiveRun, events, displayLines, recoveryLines), [effectiveRun, events, displayLines, recoveryLines])
  const totals = metricTotals(events, streamRun)
  const activeStep = deriveActiveStep(effectiveRun, events, displayLines)
  const elapsed = formatElapsed(effectiveRun.startedAt, effectiveRun.completedAt, now)
  const outputLabel = streamRun?.output?.available
    ? `${streamRun.output.length.toLocaleString()} chars`
    : streamRun?.output?.available === false
      ? 'Not captured yet'
      : displayLines.length > 0 ? `${displayLines.length} lines` : 'Pending'

  useEffect(() => {
    bottomRef.current?.scrollIntoView?.({ behavior: 'smooth' })
  }, [timeline.length])

  function handleCancel() {
    void cancelRun.mutate({ runId: effectiveRun.id, issueId: effectiveRun.issueId })
  }

  return (
    <div
      style={{
        background: '#0d1117',
        border: '1px solid #30363d',
        borderRadius: '10px',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        fontSize: '12px',
        boxShadow: isActive ? '0 0 0 1px rgba(88,166,255,0.22), 0 12px 30px rgba(1,4,9,0.22)' : undefined,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: '16px',
          padding: '14px 16px',
          borderBottom: '1px solid #21262d',
          background: '#161b22',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ minWidth: 0, flex: '1 1 260px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '6px' }}>
            <span style={{ color: '#58a6ff', display: 'inline-flex', alignItems: 'center' }}>
              {effectiveRun.kind === 'peer_review' ? <Search20Regular /> : <Play20Regular />}
            </span>
            <span style={{ fontSize: '14px', fontWeight: 700, color: '#e6edf3' }}>
              {effectiveRun.kind === 'peer_review'
                ? `Review by ${agent?.name ?? effectiveRun.agentId}`
                : agent?.name ?? effectiveRun.agentId}
            </span>
            <RunStatusBadge status={effectiveRun.status} size="md" />
            {effectiveRun.routingTier && <RoutingTierBadge tier={effectiveRun.routingTier} />}
            <span style={{ color: '#8b949e', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', fontSize: '11px' }}>
              Run {runSuffix(effectiveRun.id)}
            </span>
          </div>
          <div style={{ color: '#c9d1d9', fontSize: '13px', lineHeight: 1.45 }}>
            <span style={{ color: '#8b949e', fontWeight: 600, marginRight: '6px' }}>Active step</span>
            {activeStep}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <span style={{ color: '#c9d1d9', fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>
            {elapsed}
          </span>
          <CostDisplay costUsd={effectiveRun.costUsd} costTokens={effectiveRun.costTokens} />
          {isActive && (
            <button
              onClick={handleCancel}
              disabled={cancelRun.isPending}
              style={{
                background: 'rgba(248,81,73,0.12)',
                border: '1px solid rgba(248,81,73,0.4)',
                color: '#f85149',
                borderRadius: '4px',
                padding: '4px 8px',
                fontSize: '11px',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '18px',
          padding: '12px 16px',
          borderBottom: '1px solid #21262d',
          background: '#0d1117',
          overflowX: 'auto',
          whiteSpace: 'nowrap',
        }}
      >
        <MetricStripItem label="Turns" value={String(totals.turns)} />
        <MetricStripItem label="Input tokens" value={String(totals.inputTokens)} />
        <MetricStripItem label="Output tokens" value={String(totals.outputTokens)} />
        <MetricStripItem label="Total tokens" value={String(totals.totalTokens)} />
        <MetricStripItem label="Workspace" value={effectiveRun.workspaceStrategy} />
        <MetricStripItem label="Output" value={outputLabel} />
        <MetricStripItem label="Started" value={formatTime(effectiveRun.startedAt)} />
        <MetricStripItem label="Flow" value={effectiveRun.routingTier ?? kindLabel(effectiveRun.kind)} />
        {!isActive && (
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <GitActions projectId={projectId} run={effectiveRun} />
          </div>
        )}
      </div>

      {/* Timeline */}
      <div
        role="log"
        aria-live={isActive ? 'polite' : 'off'}
        aria-label="Run log timeline"
        style={{
          flex: 1,
          minHeight: '220px',
          maxHeight: '420px',
          overflowY: 'auto',
          padding: '14px 16px',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        }}
      >
        <div style={{ color: '#8b949e', fontFamily: 'inherit', fontSize: '11px', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '10px' }}>
          Streamed event/log timeline
        </div>
        {streamStatus === 'loading' && events.length === 0 && displayLines.length === 0 ? (
          <div style={{ minHeight: '160px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', color: '#8b949e' }}>
            <Spinner size="small" />
            <span>Loading run events…</span>
          </div>
        ) : (
          timeline.map((item) => (
            <TimelineRow key={item.id} item={item} />
          ))
        )}
        <div ref={bottomRef} />
      </div>

      <PanelSteerBar visible={canSteer} onSteer={steer} />
    </div>
  )
}

function MetricStripItem({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'baseline', gap: '6px' }}>
      <span style={{ color: '#8b949e', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {label}
      </span>
      <span style={{ color: '#e6edf3', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </span>
    </div>
  )
}

function PanelSteerBar({ visible, onSteer }: { visible: boolean; onSteer: (message: string) => Promise<void> }) {
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!visible) return null

  async function send() {
    const message = draft.trim()
    if (!message || sending) return
    setSending(true)
    setError(null)
    try {
      await onSteer(message)
      setDraft('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to steer run')
    } finally {
      setSending(false)
    }
  }

  return (
    <div
      style={{
        borderTop: '1px solid #21262d',
        background: '#161b22',
        padding: '10px 12px',
      }}
    >
      <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
        <textarea
          aria-label="Steer running agent"
          placeholder="Send a message to the agent..."
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void send()
            }
          }}
          rows={1}
          disabled={sending}
          style={{
            flex: 1,
            minHeight: '30px',
            resize: 'vertical',
            borderRadius: '6px',
            border: '1px solid #30363d',
            background: '#0d1117',
            color: '#e6edf3',
            padding: '7px 9px',
            fontFamily: 'inherit',
            fontSize: '12px',
          }}
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={sending || !draft.trim()}
          style={{
            background: 'rgba(88,166,255,0.16)',
            border: '1px solid rgba(88,166,255,0.45)',
            color: '#58a6ff',
            borderRadius: '6px',
            padding: '7px 12px',
            fontSize: '12px',
            fontWeight: 700,
            cursor: sending || !draft.trim() ? 'not-allowed' : 'pointer',
            opacity: sending || !draft.trim() ? 0.6 : 1,
          }}
        >
          Send
        </button>
      </div>
      {error && (
        <div
          role="alert"
          style={{
            color: '#ffb3ad',
            fontSize: '12px',
            marginTop: '6px',
          }}
        >
          {error}
        </div>
      )}
    </div>
  )
}

function TimelineRow({ item }: { item: TimelineItem }) {
  const color = toneColor(item.tone)

  if (item.messageBar) {
    return (
      <MessageBar intent="warning" style={{ margin: '8px 0' }}>
        <MessageBarBody>
          <span
            style={{
              color: '#8b949e',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              fontSize: '11px',
              marginRight: '10px',
            }}
          >
            {item.meta ?? 'event'}
          </span>
          <strong>{item.title}</strong>
          {item.detail ? ` — ${item.detail}` : null}
        </MessageBarBody>
      </MessageBar>
    )
  }

  if (item.tone === 'danger') {
    return (
      <MessageBar intent="error" style={{ margin: '8px 0' }}>
        <MessageBarBody>
          <span
            style={{
              color: '#8b949e',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              fontSize: '11px',
              marginRight: '10px',
            }}
          >
            {item.meta ?? 'event'}
          </span>
          <strong>{item.title}</strong>
          {item.detail ? ` — ${item.detail}` : null}
        </MessageBarBody>
      </MessageBar>
    )
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '24px minmax(64px, auto) 1fr',
        gap: '10px',
        padding: '8px 0',
        borderBottom: '1px solid rgba(48,54,61,0.65)',
      }}
    >
      <span style={{ color, display: 'inline-flex', alignItems: 'flex-start', paddingTop: '1px' }}>
        {item.icon}
      </span>
      <span
        style={{
          color: '#8b949e',
          fontSize: '11px',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          whiteSpace: 'nowrap',
        }}
      >
        {item.meta ?? 'event'}
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ color, fontWeight: 700, marginBottom: item.detail ? '3px' : 0 }}>
          {item.title}
        </div>
        {item.detail && (
          <div style={{ color: '#c9d1d9', whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.45 }}>
            {item.detail}
          </div>
        )}
      </div>
    </div>
  )
}
