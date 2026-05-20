import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { type IssueRun, useCancelRun } from '../../api/runs.ts'
import { type Agent } from '../../api/agents.ts'
import RunStatusBadge from './RunStatusBadge.tsx'
import CostDisplay from './CostDisplay.tsx'
import { RoutingTierBadge } from '../routing/RoutingTierBadge.tsx'
import GitActions from './GitActions.tsx'
import { wsClient } from '../../realtime/ws-client.ts'
import { useRunStream as useStructuredRunStream, type IssueRunEventRow } from '../../hooks/useRunStream.ts'
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
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function previewText(value: unknown, fallback = 'No detail available'): string {
  if (typeof value !== 'string') return fallback
  const compact = value.replace(/\s+/g, ' ').trim()
  if (!compact) return fallback
  return compact.length > 140 ? `${compact.slice(0, 137)}…` : compact
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
      return 'Usage updated'
    case 'issue.run.finish':
      return 'Run completed'
    case 'issue.run.error':
      return 'Run error'
    case 'issue.run.steered':
      return 'Steering message'
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
      return previewText(p.message, '')
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
      detail: run.workspacePath,
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
      tone: eventTone(event.eventType),
      icon: eventIcon(event.eventType),
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
      detail: 'No events or log lines have arrived yet.',
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

interface RunOutputPanelProps {
  projectId: string
  run: IssueRun
  agent?: Agent
}

export default function RunOutputPanel({ projectId, run, agent }: RunOutputPanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const { events, run: streamRun } = useStructuredRunStream(run.id, projectId, run.issueId, { disconnectOnUnmount: false })
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
          </div>
          <div style={{ color: '#c9d1d9', fontSize: '13px', lineHeight: 1.45 }}>
            <span style={{ color: '#8b949e', fontWeight: 600, marginRight: '6px' }}>Active step</span>
            {activeStep}
          </div>
          {effectiveRun.workspacePath && (
            <div style={{ marginTop: '6px', color: '#8b949e', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', wordBreak: 'break-all' }}>
              {effectiveRun.workspacePath}
            </div>
          )}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(84px, auto))', gap: '8px' }}>
          <MetricTile label="Elapsed" value={elapsed} />
          <MetricTile label="Cost" value={<CostDisplay costUsd={effectiveRun.costUsd} costTokens={effectiveRun.costTokens} />} />
          <MetricTile label="Workspace" value={effectiveRun.workspaceStrategy} />
          <MetricTile label="Flow" value={effectiveRun.routingTier ?? kindLabel(effectiveRun.kind)} />
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
                gridColumn: '1 / -1',
              }}
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
          gap: '8px',
          padding: '12px 16px',
          borderBottom: '1px solid #21262d',
          background: '#0d1117',
        }}
      >
        <ContextCell label="Run" value={effectiveRun.id.slice(0, 8)} mono />
        <ContextCell label="Started" value={formatTime(effectiveRun.startedAt)} />
        <ContextCell label="Heartbeat" value={formatTime(effectiveRun.heartbeatAt)} />
        <ContextCell label="Lease" value={formatTime(effectiveRun.leaseExpiresAt)} />
        <ContextCell label="Output" value={outputLabel} />
      </div>

      {recoveryLines.length > 0 && (
        <div
          style={{
            margin: '12px 16px 0',
            padding: '10px 12px',
            borderRadius: '8px',
            border: '1px solid rgba(210,153,34,0.35)',
            background: 'rgba(210,153,34,0.10)',
            color: '#f0d98c',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, marginBottom: '4px' }}>
            <ArrowClockwise20Regular />
            Recovery markers
          </div>
          {recoveryLines.slice(-3).map((line, index) => (
            <div key={`${line}-${index}`} style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', lineHeight: 1.45 }}>
              {line}
            </div>
          ))}
        </div>
      )}

      {effectiveRun.errorMessage && (
        <div
          role="alert"
          style={{
            margin: '12px 16px 0',
            padding: '10px 12px',
            borderRadius: '8px',
            border: '1px solid rgba(248,81,73,0.4)',
            background: 'rgba(248,81,73,0.10)',
            color: '#ffb3ad',
            whiteSpace: 'pre-wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, marginBottom: '4px' }}>
            <ErrorCircle20Regular />
            Error
          </div>
          {effectiveRun.errorMessage}
        </div>
      )}

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
        {timeline.map((item) => (
          <TimelineRow key={item.id} item={item} />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Footer */}
      {!isActive && (
        <div
          style={{
            padding: '6px 12px',
            borderTop: '1px solid #21262d',
            background: '#161b22',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
            flexWrap: 'wrap',
          }}
        >
          <span style={{ fontSize: '12px', color: effectiveRun.status === 'completed' ? '#3fb950' : '#f85149' }}>
            {effectiveRun.status === 'completed'
              ? <><Checkmark20Regular style={{ verticalAlign: 'middle', marginRight: '4px' }} />Completed</>
              : effectiveRun.status === 'cancelled'
              ? 'Cancelled'
              : <><Dismiss20Regular style={{ verticalAlign: 'middle', marginRight: '4px' }} />Failed</>}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <GitActions projectId={projectId} run={effectiveRun} />
            <CostDisplay costUsd={effectiveRun.costUsd} costTokens={effectiveRun.costTokens} />
          </div>
        </div>
      )}
    </div>
  )
}

function MetricTile({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div
      style={{
        border: '1px solid #30363d',
        borderRadius: '8px',
        padding: '7px 9px',
        background: '#0d1117',
        minWidth: '84px',
      }}
    >
      <div style={{ color: '#8b949e', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '2px' }}>
        {label}
      </div>
      <div style={{ color: '#e6edf3', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </div>
    </div>
  )
}

function ContextCell({ label, value, mono = false }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div>
      <div style={{ color: '#8b949e', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '2px' }}>
        {label}
      </div>
      <div
        style={{
          color: '#c9d1d9',
          fontSize: '12px',
          fontFamily: mono ? 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' : undefined,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {value}
      </div>
    </div>
  )
}

function TimelineRow({ item }: { item: TimelineItem }) {
  const color = toneColor(item.tone)
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
      <span style={{ color: '#8b949e', fontSize: '11px', whiteSpace: 'nowrap' }}>
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
