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

interface EventsResponse {
  events: IssueRunEventRow[]
  total: number
  nextSeq: number
}

export interface RunStreamResult {
  events: IssueRunEventRow[]
  status: RunStatus
  lastSeq: number
  error: Error | null
  steer: (message: string) => Promise<void>
  retry: () => void
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

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useRunStream(
  runId: string | null,
  projectId: string,
  issueId: string,
): RunStreamResult {
  const [events, setEvents] = useState<IssueRunEventRow[]>([])
  const [status, setStatus] = useState<RunStatus>('idle')
  const [lastSeq, setLastSeq] = useState(0)
  const [error, setError] = useState<Error | null>(null)

  // Refs for stable values inside async callbacks
  const lastSeqRef = useRef(0)
  const statusRef = useRef<RunStatus>('idle')
  const mountedRef = useRef(true)
  const reconnectFailuresRef = useRef(0)

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

  // ── steer ─────────────────────────────────────────────────────────────────

  const steer = useCallback(
    async (message: string): Promise<void> => {
      if (!runId) throw new Error('No active run to steer')
      await apiFetch<{ ok: boolean; eventSeq: number }>(
        `/api/projects/${projectId}/issues/${issueId}/runs/${runId}/steer`,
        { method: 'POST', body: JSON.stringify({ message }) },
      )
    },
    [runId, projectId, issueId],
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
      setError(null)
      lastSeqRef.current = 0
      setLastSeq(0)
      return
    }

    applyStatus('loading')
    setEvents([])
    setError(null)
    lastSeqRef.current = 0
    setLastSeq(0)

    wsClient.connect(projectId)

    // ── Determine terminal status from a snapshot ─────────────────────────

    function resolveStatusFromEvents(
      evts: IssueRunEventRow[],
      fallback: RunStatus,
    ): RunStatus {
      if (evts.some((e) => e.eventType === 'issue.run.finish')) return 'finished'
      if (evts.some((e) => e.eventType === 'issue.run.error')) return 'error'
      return fallback
    }

    // ── Initial HTTP fetch ─────────────────────────────────────────────────

    fetchEvents()
      .then((data) => {
        if (!mountedRef.current) return
        setEvents(data.events)
        lastSeqRef.current = data.nextSeq
        setLastSeq(data.nextSeq)
        applyStatus(resolveStatusFromEvents(data.events, 'live'))
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
        const p = payload as { runId?: string; seq?: number }
        if (p.runId !== runId) return

        const seq = typeof p.seq === 'number' ? p.seq : Date.now()
        const row: IssueRunEventRow = {
          id: `ws-${type}-${seq}`,
          runId,
          seq,
          eventType: type,
          payload: payload as Record<string, unknown>,
          createdAt: new Date().toISOString(),
        }

        setEvents((prev) => {
          // Deduplicate by (eventType, seq)
          if (prev.some((e) => e.eventType === type && e.seq === seq)) return prev
          return [...prev, row]
        })

        const nextSeq = seq + 1
        if (nextSeq > lastSeqRef.current) {
          lastSeqRef.current = nextSeq
          setLastSeq(nextSeq)
        }

        if (type === 'issue.run.finish') applyStatus('finished')
        else if (type === 'issue.run.error') applyStatus('error')
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
            if (data.events.length > 0) {
              setEvents((prev) => {
                const seqs = new Set(prev.map((e) => `${e.eventType}:${e.seq}`))
                const fresh = data.events.filter(
                  (e) => !seqs.has(`${e.eventType}:${e.seq}`),
                )
                return fresh.length ? [...prev, ...fresh] : prev
              })
              lastSeqRef.current = data.nextSeq
              setLastSeq(data.nextSeq)
            }
            // Successful replay — reset failure counter
            reconnectFailuresRef.current = 0
            applyStatus(resolveStatusFromEvents(data.events, 'live'))
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

    // ── Cleanup ───────────────────────────────────────────────────────────

    return () => {
      mountedRef.current = false
      for (const h of handlers) wsClient.off(h.type, h.fn as never)
      unsubState()
      wsClient.disconnect()
    }
  }, [runId, projectId, issueId, fetchEvents])

  return { events, status, lastSeq, error, steer, retry }
}
