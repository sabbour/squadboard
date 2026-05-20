/**
 * useRunStream — Wave 28 JIS-T7
 *
 * Subscribes to a running issue_run's event stream via:
 *   1. An initial HTTP GET to fetch the last 50 persisted events.
 *   2. WebSocket `issue.run.*` events filtered by runId (routed via projectId room).
 *   3. On WS reconnect: a catch-up GET with `since_seq=lastSeq` (seam for T10 polish).
 *
 * Exposes `steer(message)` which POSTs to the steer endpoint.
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import { apiFetch } from '../api/client.ts'
import { wsClient } from '../realtime/ws-client.ts'
import type { RunOwnershipContext } from '../api/runs.ts'

// ─── Types ──────────────────────────────────────────────────────────────────

export type RunStatus = 'idle' | 'loading' | 'live' | 'reconnecting' | 'finished' | 'error'

export interface IssueRunEventRow {
  id: string
  runId: string
  seq: number
  eventType: string
  payload: Record<string, unknown>
  createdAt: string
}

export type IssueRunDbStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'splitting' | 'waiting_children'

export interface IssueRunStreamSnapshot {
  id: string
  issueId: string
  agentId: string
  kind?: string
  status: IssueRunDbStatus
  workspaceStrategy?: string
  workspacePath?: string | null
  createdAt: string | null
  updatedAt: string | null
  startedAt: string | null
  completedAt: string | null
  finishedAt: string | null
  leaseExpiresAt: string | null
  heartbeatAt: string | null
  durationMs: number | null
  costTokens: number
  inputTokens: number
  outputTokens: number
  cachedInputTokens: number
  costUsd: string
  premiumRequests: string
  output: {
    available: boolean
    length: number
  }
  errorMessage?: string | null
  staleReason?: string | null
  recovery: {
    reason: string
    message: string
    recoveredAt: string | null
  } | null
  context?: RunOwnershipContext | null
}

interface EventsResponse {
  run: IssueRunStreamSnapshot
  events: IssueRunEventRow[]
  total: number
  nextSeq: number
}

export interface RunStreamResult {
  events: IssueRunEventRow[]
  run: IssueRunStreamSnapshot | null
  status: RunStatus
  lastSeq: number
  error: Error | null
  steer: (message: string) => Promise<void>
  retry: () => void
}

export interface RunStreamOptions {
  disconnectOnUnmount?: boolean
}

// ─── Constants ───────────────────────────────────────────────────────────────

export const ISSUE_RUN_EVENT_TYPES = [
  'issue.run.start',
  'issue.run.turn',
  'issue.run.token',
  'issue.run.tool_call',
  'issue.run.tool_result',
  'issue.run.metric',
  'issue.run.finish',
  'issue.run.error',
  'issue.run.steered',
] as const

export type IssueRunWsEventType = (typeof ISSUE_RUN_EVENT_TYPES)[number]

function errorFromPayload(payload: Record<string, unknown>): Error {
  const value = payload.message ?? payload.errorMessage ?? payload.error
  return new Error(typeof value === 'string' && value.trim() ? value : 'Run failed')
}

function latestErrorFromEvents(events: IssueRunEventRow[]): Error | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]
    if (event.eventType === 'issue.run.error') return errorFromPayload(event.payload)
  }
  return null
}

function errorFromRunSnapshot(run: IssueRunStreamSnapshot): Error | null {
  if (run.status !== 'failed' && run.status !== 'cancelled') return null
  return new Error(run.errorMessage || run.recovery?.message || `Run ${run.status}`)
}

function resolveStatusFromEvents(
  evts: IssueRunEventRow[],
  run: IssueRunStreamSnapshot | null,
  fallback: RunStatus,
): RunStatus {
  if (run?.status === 'completed') return 'finished'
  if (run?.status === 'failed' || run?.status === 'cancelled') return 'error'
  if (evts.some((e) => e.eventType === 'issue.run.finish')) return 'finished'
  if (evts.some((e) => e.eventType === 'issue.run.error')) return 'error'
  return fallback
}

function mergeEventRows(prev: IssueRunEventRow[], fresh: IssueRunEventRow[]): IssueRunEventRow[] {
  if (fresh.length === 0) return prev
  const seen = new Set(prev.map((event) => `${event.eventType}:${event.seq}`))
  const next = fresh.filter((event) => !seen.has(`${event.eventType}:${event.seq}`))
  return next.length ? [...prev, ...next] : prev
}

function applyEventToRunSnapshot(
  run: IssueRunStreamSnapshot | null,
  event: IssueRunEventRow,
): IssueRunStreamSnapshot | null {
  if (!run) return run
  const p = event.payload

  if (event.eventType === 'issue.run.start') {
    return {
      ...run,
      status: 'running',
      startedAt: run.startedAt ?? event.createdAt,
      updatedAt: event.createdAt,
    }
  }

  if (event.eventType === 'issue.run.metric') {
    const inputTokens = typeof p.inputTokens === 'number' ? p.inputTokens : run.inputTokens
    const outputTokens = typeof p.outputTokens === 'number' ? p.outputTokens : run.outputTokens
    return {
      ...run,
      inputTokens,
      outputTokens,
      costTokens: inputTokens + outputTokens,
      updatedAt: event.createdAt,
    }
  }

  if (event.eventType === 'issue.run.finish') {
    const tokenCounts = p.tokenCounts && typeof p.tokenCounts === 'object'
      ? p.tokenCounts as { input?: unknown; output?: unknown; total?: unknown }
      : null
    return {
      ...run,
      status: 'completed',
      completedAt: event.createdAt,
      finishedAt: event.createdAt,
      updatedAt: event.createdAt,
      durationMs: typeof p.durationMs === 'number' ? p.durationMs : run.durationMs,
      costUsd: typeof p.cost === 'string' ? p.cost : run.costUsd,
      inputTokens: typeof tokenCounts?.input === 'number' ? tokenCounts.input : run.inputTokens,
      outputTokens: typeof tokenCounts?.output === 'number' ? tokenCounts.output : run.outputTokens,
      costTokens: typeof tokenCounts?.total === 'number' ? tokenCounts.total : run.costTokens,
    }
  }

  if (event.eventType === 'issue.run.error') {
    return {
      ...run,
      status: 'failed',
      completedAt: run.completedAt ?? event.createdAt,
      finishedAt: run.finishedAt ?? event.createdAt,
      updatedAt: event.createdAt,
      errorMessage: typeof p.message === 'string' ? p.message : run.errorMessage,
    }
  }

  return run
}

function isTerminalDbStatus(status: IssueRunDbStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled'
}

function isTerminalEvent(eventType: string): boolean {
  return eventType === 'issue.run.finish' || eventType === 'issue.run.error'
}

function applyEventsToRunSnapshot(
  run: IssueRunStreamSnapshot,
  events: IssueRunEventRow[],
): IssueRunStreamSnapshot {
  return events.reduce<IssueRunStreamSnapshot>(
    (current, event) => {
      if (isTerminalDbStatus(current.status) && !isTerminalEvent(event.eventType)) return current
      return applyEventToRunSnapshot(current, event) ?? current
    },
    run,
  )
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useRunStream(
  runId: string | null,
  projectId: string,
  issueId: string,
  options: RunStreamOptions = {},
): RunStreamResult {
  const disconnectOnUnmount = options.disconnectOnUnmount ?? true
  const [events, setEvents] = useState<IssueRunEventRow[]>([])
  const [run, setRun] = useState<IssueRunStreamSnapshot | null>(null)
  const [status, setStatus] = useState<RunStatus>('idle')
  const [lastSeq, setLastSeq] = useState(0)
  const [error, setError] = useState<Error | null>(null)

  // Refs for stable values inside async callbacks
  const lastSeqRef = useRef(0)
  const statusRef = useRef<RunStatus>('idle')
  const eventsRef = useRef<IssueRunEventRow[]>([])
  const mountedRef = useRef(true)
  const reconnectFailuresRef = useRef(0)
  const pollInFlightRef = useRef(false)

  function applyStatus(s: RunStatus) {
    statusRef.current = s
    setStatus(s)
  }

  // ── HTTP fetch helper ─────────────────────────────────────────────────────

  const fetchEvents = useCallback(
    async (sinceSeq?: number): Promise<EventsResponse> => {
      const qs =
        sinceSeq !== undefined
          ? `?since_seq=${sinceSeq}&limit=50`
          : '?limit=50'
      const url = `/api/projects/${projectId}/issues/${issueId}/runs/${runId}/events${qs}`
      return apiFetch<EventsResponse>(url)
    },
    [runId, projectId, issueId],
  )

  const applyFetchedEvents = useCallback(
    (
      data: EventsResponse,
      options: { replace?: boolean; fallback?: RunStatus } = {},
    ) => {
      const nextRun = applyEventsToRunSnapshot(data.run, data.events)
      const nextEvents = options.replace
        ? data.events
        : mergeEventRows(eventsRef.current, data.events)

      eventsRef.current = nextEvents
      setRun(nextRun)
      setEvents(nextEvents)

      const nextSeq = Math.max(options.replace ? 0 : lastSeqRef.current, data.nextSeq)
      lastSeqRef.current = nextSeq
      setLastSeq(nextSeq)
      setError(latestErrorFromEvents(nextEvents) ?? errorFromRunSnapshot(nextRun))
      applyStatus(resolveStatusFromEvents(nextEvents, nextRun, options.fallback ?? statusRef.current))
    },
    [],
  )

  // ── steer ─────────────────────────────────────────────────────────────────

  const steer = useCallback(
    async (message: string): Promise<void> => {
      if (!runId) throw new Error('No active run to steer')
      try {
        await apiFetch<{ ok: boolean; eventSeq: number }>(
          `/api/projects/${projectId}/issues/${issueId}/runs/${runId}/steer`,
          { method: 'POST', body: JSON.stringify({ message }) },
        )
      } catch (err) {
        try {
          const data = await fetchEvents(lastSeqRef.current)
          if (mountedRef.current) applyFetchedEvents(data, { fallback: statusRef.current })
        } catch {
          // Preserve and rethrow the original steering failure; the caller shows it inline.
        }
        throw err
      }
    },
    [runId, projectId, issueId, fetchEvents, applyFetchedEvents],
  )

  // ── retry ─────────────────────────────────────────────────────────────────

  const retry = useCallback(() => {
    if (!runId) return
    reconnectFailuresRef.current = 0
    setError(null)
    applyStatus('reconnecting')
    wsClient.connect(projectId)
  }, [runId, projectId])

  // ── Main effect ───────────────────────────────────────────────────────────

  useEffect(() => {
    mountedRef.current = true

    if (!runId) {
      applyStatus('idle')
      setEvents([])
      eventsRef.current = []
      setRun(null)
      setError(null)
      lastSeqRef.current = 0
      setLastSeq(0)
      pollInFlightRef.current = false
      return
    }

    applyStatus('loading')
    setEvents([])
    eventsRef.current = []
    setRun(null)
    setError(null)
    lastSeqRef.current = 0
    setLastSeq(0)
    pollInFlightRef.current = false

    wsClient.connect(projectId)

    // ── Initial HTTP fetch ─────────────────────────────────────────────────

    fetchEvents()
      .then((data) => {
        if (!mountedRef.current) return
        applyFetchedEvents(data, { replace: true, fallback: 'live' })
      })
      .catch((err: unknown) => {
        if (!mountedRef.current) return
        setError(err instanceof Error ? err : new Error(String(err)))
        applyStatus('error')
      })

    // ── WS event handlers ─────────────────────────────────────────────────

    const handlers: Array<{ type: IssueRunWsEventType; fn: (p: unknown) => void }> = []

    for (const type of ISSUE_RUN_EVENT_TYPES) {
      const fn = (payload: unknown) => {
        if (!mountedRef.current) return
        if (!payload || typeof payload !== 'object') return
        const p = payload as { runId?: string; seq?: number; createdAt?: unknown }
        if (p.runId !== runId) return

        const seq = typeof p.seq === 'number' ? p.seq : Date.now()
        const createdAt = typeof p.createdAt === 'string' ? p.createdAt : new Date().toISOString()
        const row: IssueRunEventRow = {
          id: `ws-${type}-${seq}`,
          runId,
          seq,
          eventType: type,
          payload: payload as Record<string, unknown>,
          createdAt,
        }

        setEvents((prev) => {
          // Deduplicate by (eventType, seq)
          if (prev.some((e) => e.eventType === type && e.seq === seq)) return prev
          const next = [...prev, row]
          eventsRef.current = next
          return next
        })
        setRun((prev) => {
          if (prev && isTerminalDbStatus(prev.status) && !isTerminalEvent(row.eventType)) return prev
          const next = applyEventToRunSnapshot(prev, row)
          return next
        })

        const nextSeq = seq + 1
        if (nextSeq > lastSeqRef.current) {
          lastSeqRef.current = nextSeq
          setLastSeq(nextSeq)
        }

        if (type === 'issue.run.finish') applyStatus('finished')
        else if (type === 'issue.run.error') {
          setError(errorFromPayload(payload as Record<string, unknown>))
          applyStatus('error')
        }
        else if (
          statusRef.current !== 'live' &&
          statusRef.current !== 'finished' &&
          statusRef.current !== 'error'
        ) {
          applyStatus('live')
        }
      }

      wsClient.on(type, fn as never)
      handlers.push({ type, fn })
    }

    // ── WS reconnect catch-up with 3-strike failure cap ───────────────────

    const MAX_RECONNECT_FAILURES = 3

    const unsubState = wsClient.onStateChange((state) => {
      if (!mountedRef.current) return

      if (state === 'reconnecting') {
        if (statusRef.current === 'live') {
          // First failure — transition to reconnecting
          reconnectFailuresRef.current = 1
          applyStatus('reconnecting')
        } else if (statusRef.current === 'reconnecting') {
          // Subsequent failure — socket opened and closed again
          reconnectFailuresRef.current++
          if (reconnectFailuresRef.current >= MAX_RECONNECT_FAILURES) {
            setError(new Error(`Connection lost after ${MAX_RECONNECT_FAILURES} reconnect attempts`))
            applyStatus('error')
          }
          // else stay in 'reconnecting' — banner already showing
        }
        return
      }

      if (state === 'connected' && statusRef.current === 'reconnecting') {
        fetchEvents(lastSeqRef.current)
          .then((data) => {
            if (!mountedRef.current) return
            // Successful replay — reset failure counter
            reconnectFailuresRef.current = 0
            applyFetchedEvents(data, { fallback: 'live' })
          })
          .catch(() => {
            // GET replay failed — WS is connected but we couldn't fetch catch-up events.
            // Stay in 'reconnecting' so the banner remains visible; the WS connection
            // is still live and future events will arrive via the socket.
            if (mountedRef.current && statusRef.current === 'reconnecting') {
              applyStatus('reconnecting')
            }
          })
      }
    })

    // ── Silent terminal-status catch-up ────────────────────────────────────

    const STATUS_POLL_MS = 5000
    const pollId = setInterval(() => {
      const currentStatus = statusRef.current
      if (currentStatus !== 'live' && currentStatus !== 'reconnecting') return
      if (pollInFlightRef.current) return

      pollInFlightRef.current = true
      fetchEvents(lastSeqRef.current)
        .then((data) => {
          if (!mountedRef.current) return
          applyFetchedEvents(data, { fallback: currentStatus })
        })
        .catch(() => {
          // WebSocket is still the primary live channel; keep the current status on poll failure.
        })
        .finally(() => {
          pollInFlightRef.current = false
        })
    }, STATUS_POLL_MS)

    // ── Cleanup ───────────────────────────────────────────────────────────

    return () => {
      mountedRef.current = false
      for (const h of handlers) wsClient.off(h.type, h.fn as never)
      unsubState()
      clearInterval(pollId)
      if (disconnectOnUnmount) wsClient.disconnect()
    }
  }, [runId, projectId, issueId, fetchEvents, applyFetchedEvents, disconnectOnUnmount])

  return { events, run, status, lastSeq, error, steer, retry }
}
