import { useEffect, useMemo, useRef } from 'react'
import { tokens } from '@fluentui/react-components'
import type { LiveSessionEvent, LiveStreamEntry } from '../../api/sessions.ts'
import type { Agent } from '../../api/agents.ts'

interface AgentActivityFeedProps {
  /** Events fetched on mount (durable transcript). */
  initialEvents: LiveSessionEvent[]
  /** Realtime tail from useSessionStream. */
  liveEntries: LiveStreamEntry[]
  agentName?: string | null
  /** Optional list of project agents — used to resolve names in steering rows. */
  agents?: Agent[]
}

interface FeedRow {
  key: string
  type: string
  payload: Record<string, unknown>
  at: Date
}

function pickStr(p: unknown, ...keys: string[]): string | undefined {
  if (!p || typeof p !== 'object') return undefined
  const o = p as Record<string, unknown>
  for (const k of keys) {
    const v = o[k]
    if (typeof v === 'string') return v
  }
  return undefined
}

function pickNum(p: unknown, ...keys: string[]): number | undefined {
  if (!p || typeof p !== 'object') return undefined
  const o = p as Record<string, unknown>
  for (const k of keys) {
    const v = o[k]
    if (typeof v === 'number') return v
  }
  return undefined
}

function mergeFeed(
  initialEvents: LiveSessionEvent[],
  liveEntries: LiveStreamEntry[],
): FeedRow[] {
  const rows: FeedRow[] = initialEvents.map((e) => ({
    key: `i-${e.id}`,
    type: e.type,
    payload: e.payload,
    at: new Date(e.createdAt),
  }))

  const cutoff =
    initialEvents.length === 0
      ? 0
      : new Date(initialEvents[initialEvents.length - 1]!.createdAt).getTime()

  for (const live of liveEntries) {
    if (live.receivedAt < cutoff - 250) continue
    rows.push({
      key: `l-${live.key}`,
      type: live.type as string,
      payload: live.payload as Record<string, unknown>,
      at: new Date(live.receivedAt),
    })
  }

  return rows
}

/** Coalesce delta events so the UI shows one streaming bubble per assistant turn. */
function coalesceFeed(rows: FeedRow[]): FeedRow[] {
  const out: FeedRow[] = []
  for (const r of rows) {
    if (r.type === 'session.delta') {
      const last = out[out.length - 1]
      if (
        last &&
        last.type === 'session.assistant_streaming' &&
        last.payload.kind === r.payload.kind
      ) {
        const prevText = (last.payload.text as string) ?? ''
        const delta = pickStr(r.payload, 'delta') ?? ''
        last.payload = { ...last.payload, text: prevText + delta }
        last.at = r.at
        continue
      }
      out.push({
        key: r.key,
        type: 'session.assistant_streaming',
        payload: { text: pickStr(r.payload, 'delta') ?? '', kind: r.payload.kind ?? 'message' },
        at: r.at,
      })
      continue
    }
    out.push(r)
  }
  return out
}

function fmtTime(d: Date) {
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export default function AgentActivityFeed({
  initialEvents,
  liveEntries,
  agentName,
  agents,
}: AgentActivityFeedProps) {
  const merged = useMemo(
    () => coalesceFeed(mergeFeed(initialEvents, liveEntries)),
    [initialEvents, liveEntries],
  )
  const agentLookup = useMemo(() => {
    const m = new Map<string, string>()
    for (const a of agents ?? []) m.set(a.id, a.name)
    return m
  }, [agents])

  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [merged.length])

  return (
    <div
      ref={scrollRef}
      style={{
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
        padding: '16px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        background: tokens.colorNeutralBackground2,
      }}
    >
      {merged.length === 0 && (
        <div style={{ color: tokens.colorNeutralForeground3, fontSize: '13px', textAlign: 'center', paddingTop: '32px' }}>
          No activity yet — send a prompt to begin.
        </div>
      )}
      {merged.map((r) => (
        <FeedRowView key={r.key} row={r} agentName={agentName ?? null} agentLookup={agentLookup} />
      ))}
    </div>
  )
}

function FeedRowView({
  row,
  agentName,
  agentLookup,
}: {
  row: FeedRow
  agentName: string | null
  agentLookup: Map<string, string>
}) {
  const time = fmtTime(row.at)

  if (row.type === 'session.message') {
    const role = (row.payload.role as string) ?? 'assistant'
    const content = pickStr(row.payload, 'content') ?? ''
    return (
      <Bubble
        role={role === 'user' ? 'user' : 'assistant'}
        author={role === 'user' ? 'You' : agentName ?? 'Agent'}
        time={time}
        text={content}
      />
    )
  }

  if (row.type === 'session.assistant_streaming') {
    const text = (row.payload.text as string) ?? ''
    const kind = row.payload.kind === 'reasoning' ? 'reasoning' : 'message'
    return (
      <Bubble
        role="assistant"
        author={`${agentName ?? 'Agent'}${kind === 'reasoning' ? ' (thinking)' : ' (typing…)'}`}
        time={time}
        text={text}
        ghost={kind === 'reasoning'}
      />
    )
  }

  if (row.type === 'session.tool') {
    const phase = pickStr(row.payload, 'phase') ?? 'tool'
    return <Pill icon="🔧" label={`tool · ${phase}`} time={time} tone="neutral" />
  }

  if (row.type === 'session.usage') {
    const inT = pickNum(row.payload, 'inputTokens') ?? 0
    const outT = pickNum(row.payload, 'outputTokens') ?? 0
    const cost = pickNum(row.payload, 'cost') ?? 0
    return (
      <Pill
        icon="💸"
        label={`${inT} in / ${outT} out · $${cost.toFixed(4)}`}
        time={time}
        tone="neutral"
      />
    )
  }

  if (row.type === 'session.started') {
    return <Pill icon="▶" label="session started" time={time} tone="success" />
  }

  if (row.type === 'session.completed') {
    const reason = pickStr(row.payload, 'reason') ?? 'completed'
    return <Pill icon="●" label={`session ${reason}`} time={time} tone="success" />
  }

  if (row.type === 'session.error') {
    const msg = pickStr(row.payload, 'message') ?? 'error'
    return <Pill icon="⚠" label={msg} time={time} tone="danger" />
  }

  if (row.type === 'session.steered') {
    return <Pill icon="🎛" label={fmtSteered(row.payload, agentLookup)} time={time} tone="neutral" />
  }

  // Phase 5 — consult.request / consult.response / consult.error
  if (row.type === 'consult.request') {
    const fromAgent = pickStr(row.payload, 'fromAgent') ?? agentName ?? 'Agent'
    const question = pickStr(row.payload, 'question') ?? ''
    return <ConsultRow direction="request" label={fromAgent} text={question} time={time} />
  }

  if (row.type === 'consult.response') {
    const fromAgent = pickStr(row.payload, 'fromAgent') ?? agentName ?? 'Agent'
    const answer = pickStr(row.payload, 'answer') ?? ''
    return <ConsultRow direction="response" label={fromAgent} text={answer} time={time} />
  }

  if (row.type === 'consult.error') {
    const msg = pickStr(row.payload, 'message') ?? 'consult error'
    return <Pill icon="💬⚠" label={msg} time={time} tone="danger" />
  }

  return null
}

function fmtSteered(payload: Record<string, unknown>, lookup: Map<string, string>): string {
  const action = pickStr(payload, 'action') ?? 'steered'
  const actor = pickStr(payload, 'actor') ?? 'user'
  const honoured = (payload as { honoured?: boolean }).honoured
  const deferred = (payload as { deferred?: boolean }).deferred
  const reason = pickStr(payload, 'reason')
  const note = pickStr(payload, 'note')
  const toAgentId = pickStr(payload, 'toAgentId')
  const agentId = pickStr(payload, 'agentId')
  const target = toAgentId ?? agentId
  const targetName = target ? (lookup.get(target) ?? target.slice(0, 8)) : null

  switch (action) {
    case 'inject':
      return `${actor} injected a message`
    case 'interrupt': {
      const status = honoured === false ? 'not honoured' : 'honoured'
      return reason
        ? `${actor} interrupted (${status}): ${reason}`
        : `${actor} interrupted (${status})`
    }
    case 'handoff': {
      const tail = note ? ` — ${note}` : ''
      const def = deferred ? ' (deferred)' : ''
      return targetName
        ? `${actor} handed off → @${targetName}${def}${tail}`
        : `${actor} handed off${def}${tail}`
    }
    case 'invite': {
      const tail = note ? ` — ${note}` : ''
      const def = deferred ? ' (deferred)' : ''
      return targetName
        ? `${actor} invited @${targetName}${def}${tail}`
        : `${actor} invited an agent${def}${tail}`
    }
    default:
      return `${actor} steered (${action})`
  }
}

function Bubble({
  role,
  author,
  time,
  text,
  ghost,
}: {
  role: 'user' | 'assistant'
  author: string
  time: string
  text: string
  ghost?: boolean
}) {
  const isUser = role === 'user'
  return (
    <div
      style={{
        alignSelf: isUser ? 'flex-end' : 'flex-start',
        maxWidth: '85%',
        background: isUser
          ? tokens.colorBrandBackground
          : ghost
            ? 'transparent'
            : tokens.colorNeutralBackground1,
        color: isUser ? tokens.colorNeutralForegroundOnBrand : tokens.colorNeutralForeground1,
        border: ghost
          ? `1px dashed ${tokens.colorNeutralStroke2}`
          : `1px solid ${tokens.colorNeutralStroke1}`,
        borderRadius: '12px',
        padding: '10px 14px',
        fontSize: '13px',
        lineHeight: 1.5,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
    >
      <div
        style={{
          fontSize: '11px',
          color: isUser ? 'rgba(255,255,255,0.8)' : tokens.colorNeutralForeground3,
          marginBottom: '4px',
          display: 'flex',
          gap: '8px',
          alignItems: 'baseline',
        }}
      >
        <strong>{author}</strong>
        <span>{time}</span>
      </div>
      {text || <em style={{ opacity: 0.6 }}>(empty)</em>}
    </div>
  )
}

function Pill({
  icon,
  label,
  time,
  tone,
}: {
  icon: string
  label: string
  time: string
  tone: 'neutral' | 'success' | 'danger'
}) {
  const colors = {
    neutral: { bg: tokens.colorNeutralBackground3, fg: tokens.colorNeutralForeground2, border: tokens.colorNeutralStroke2 },
    success: { bg: tokens.colorPaletteGreenBackground1, fg: tokens.colorPaletteGreenForeground1, border: tokens.colorPaletteGreenBorder1 },
    danger:  { bg: tokens.colorPaletteRedBackground1,   fg: tokens.colorPaletteRedForeground1,   border: tokens.colorPaletteRedBorder1   },
  }[tone]
  return (
    <div
      style={{
        alignSelf: 'center',
        fontSize: '11px',
        background: colors.bg,
        color: colors.fg,
        border: `1px solid ${colors.border}`,
        padding: '3px 10px',
        borderRadius: '999px',
        display: 'inline-flex',
        gap: '6px',
        alignItems: 'center',
      }}
    >
      <span>{icon}</span>
      <span>{label}</span>
      <span style={{ opacity: 0.6 }}>· {time}</span>
    </div>
  )
}

/**
 * Phase 5 — Inline consult row.
 *
 * Consult requests are left-aligned (the agent asking), responses are
 * right-aligned (the answer coming back). Both use a neutral tinted background
 * distinct from the regular assistant bubble so users can tell them apart at
 * a glance. No new surface is introduced — everything stays in the existing
 * transcript scroll region.
 */
function ConsultRow({
  direction,
  label,
  text,
  time,
}: {
  direction: 'request' | 'response'
  label: string
  text: string
  time: string
}) {
  const isResponse = direction === 'response'
  const icon = isResponse ? '💬↩' : '💬?'
  return (
    <div
      style={{
        alignSelf: isResponse ? 'flex-end' : 'flex-start',
        maxWidth: '85%',
        background: tokens.colorNeutralBackground3,
        border: `1px dashed ${tokens.colorNeutralStroke2}`,
        borderRadius: '10px',
        padding: '8px 14px',
        fontSize: '13px',
        lineHeight: 1.5,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        color: tokens.colorNeutralForeground1,
      }}
    >
      <div
        style={{
          fontSize: '11px',
          color: tokens.colorNeutralForeground3,
          marginBottom: '4px',
          display: 'flex',
          gap: '6px',
          alignItems: 'baseline',
        }}
      >
        <span>{icon}</span>
        <strong>{label}</strong>
        <span style={{ opacity: 0.7 }}>{isResponse ? 'answered' : 'asked'}</span>
        <span>· {time}</span>
      </div>
      {text || <em style={{ opacity: 0.6 }}>(empty)</em>}
    </div>
  )
}
