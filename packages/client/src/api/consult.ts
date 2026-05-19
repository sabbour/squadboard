import { useEffect, useMemo, useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from './client.ts'
import type { AgentOrigin } from './agents.ts'
import { wsClient, type WsEventMap } from '../realtime/ws-client.ts'

// ─── Wire types ────────────────────────────────────────────────────────────

export type ConsultMode = 'agent' | 'model'
export type ConsultStatus = 'active' | 'idle' | 'completed' | 'failed' | 'cancelled'
export type ConsultMessageRole = 'user' | 'assistant' | 'system' | 'tool'
export type ConsultProposalKind =
  | 'issue'
  | 'ceremony'
  | 'inbox_item'
  | 'capture_to_decision'
  | 'assign_agent_to_issue'
export type ConsultProposalStatus = 'pending' | 'accepted' | 'edited' | 'discarded'

export interface ConsultSession {
  id: string
  projectId: string | null
  name: string | null
  mode: ConsultMode
  agentId: string | null
  agentName: string | null
  agentOrigin?: AgentOrigin | 'model' | null
  model: string | null
  status: ConsultStatus
  sdkSessionId: string | null
  inputTokens: number
  outputTokens: number
  costUsd: string
  messageCount: number
  forkedFromSessionId: string | null
  errorMessage: string | null
  startedAt: string
  endedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface ConsultMessage {
  id: string
  sessionId: string
  role: ConsultMessageRole
  content: string
  reasoningContent: string | null
  toolName: string | null
  toolArgs: Record<string, unknown> | null
  toolResult: Record<string, unknown> | null
  inputTokens: number | null
  outputTokens: number | null
  costUsd: string | null
  ts: string
}

export interface ConsultProposal {
  id: string
  sessionId: string
  messageId: string | null
  kind: ConsultProposalKind
  status: ConsultProposalStatus
  payload: Record<string, unknown>
  editedPayload: Record<string, unknown> | null
  result: Record<string, unknown> | null
  errorMessage: string | null
  createdAt: string
  decidedAt: string | null
}

export interface ConsultSessionDetail extends ConsultSession {
  messages: ConsultMessage[]
  proposals: ConsultProposal[]
}

export interface StartConsultInput {
  projectId?: string | null
  mode: ConsultMode
  agentId?: string | null
  agentName?: string | null
  agentOrigin?: AgentOrigin | null
  model?: string | null
  name?: string | null
  forkedFromSessionId?: string | null
}

export interface ListConsultsParams {
  projectId?: string
  global?: boolean
  status?: ConsultStatus
  mode?: ConsultMode
  limit?: number
}

// ─── Queries ───────────────────────────────────────────────────────────────

export function useConsultSessions(params: ListConsultsParams = {}) {
  const qs = new URLSearchParams()
  if (params.projectId) qs.set('projectId', params.projectId)
  if (params.global) qs.set('global', '1')
  if (params.status) qs.set('status', params.status)
  if (params.mode) qs.set('mode', params.mode)
  if (params.limit) qs.set('limit', String(params.limit))
  const queryString = qs.toString()
  return useQuery<ConsultSession[]>({
    queryKey: ['consultSessions', params],
    queryFn: () => apiFetch<ConsultSession[]>(`/api/consult${queryString ? `?${queryString}` : ''}`),
    refetchInterval: 8000,
  })
}

export function useConsultSession(sessionId: string | null) {
  return useQuery<ConsultSessionDetail>({
    queryKey: ['consultSession', sessionId],
    queryFn: () => apiFetch<ConsultSessionDetail>(`/api/consult/${sessionId}`),
    enabled: Boolean(sessionId),
    // Poll while the session is live so missed WS events don't leave the
    // transcript permanently stale.  Stop polling once the session is in a
    // terminal state.
    refetchInterval: (query) => {
      const status = query.state.data?.status
      if (status === 'completed' || status === 'failed' || status === 'cancelled') return false
      return 3000
    },
  })
}

// ─── Mutations ─────────────────────────────────────────────────────────────

export function useStartConsult() {
  const qc = useQueryClient()
  return useMutation<ConsultSession, Error, StartConsultInput>({
    mutationFn: (input) =>
      apiFetch<ConsultSession>('/api/consult', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['consultSessions'] })
    },
  })
}

export function useSendConsultMessage(sessionId: string) {
  const qc = useQueryClient()
  return useMutation<{ ok: true }, Error, { content: string }>({
    mutationFn: (input) =>
      apiFetch<{ ok: true }>(`/api/consult/${sessionId}/messages`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['consultSession', sessionId] })
    },
  })
}

export function useRenameConsult(sessionId: string) {
  const qc = useQueryClient()
  return useMutation<ConsultSession, Error, { name: string }>({
    mutationFn: (input) =>
      apiFetch<ConsultSession>(`/api/consult/${sessionId}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['consultSession', sessionId] })
      void qc.invalidateQueries({ queryKey: ['consultSessions'] })
    },
  })
}

export function useEndConsult() {
  const qc = useQueryClient()
  return useMutation<ConsultSession, Error, { sessionId: string; reason?: 'completed' | 'cancelled' }>({
    mutationFn: ({ sessionId, reason }) =>
      apiFetch<ConsultSession>(`/api/consult/${sessionId}/end`, {
        method: 'POST',
        body: JSON.stringify({ reason: reason ?? 'completed' }),
      }),
    onSuccess: (_data, { sessionId }) => {
      void qc.invalidateQueries({ queryKey: ['consultSession', sessionId] })
      void qc.invalidateQueries({ queryKey: ['consultSessions'] })
    },
  })
}

export function useDeleteConsult() {
  const qc = useQueryClient()
  return useMutation<{ ok: true }, Error, string>({
    mutationFn: (sessionId) =>
      apiFetch<{ ok: true }>(`/api/consult/${sessionId}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['consultSessions'] })
    },
  })
}

export function useAcceptProposal(sessionId: string) {
  const qc = useQueryClient()
  return useMutation<
    { proposal: ConsultProposal; artifact: Record<string, unknown> | null },
    Error,
    { proposalId: string; editedPayload?: Record<string, unknown> }
  >({
    mutationFn: ({ proposalId, editedPayload }) =>
      apiFetch(`/api/consult/${sessionId}/proposals/${proposalId}/accept`, {
        method: 'POST',
        body: JSON.stringify({ editedPayload: editedPayload ?? null }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['consultSession', sessionId] })
    },
  })
}

export function useDiscardProposal(sessionId: string) {
  const qc = useQueryClient()
  return useMutation<{ proposal: ConsultProposal | null }, Error, string>({
    mutationFn: (proposalId) =>
      apiFetch(`/api/consult/${sessionId}/proposals/${proposalId}/discard`, {
        method: 'POST',
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['consultSession', sessionId] })
    },
  })
}

export function usePromoteConsult(sessionId: string) {
  const qc = useQueryClient()
  return useMutation<
    {
      kind: 'inbox' | 'issue' | 'ceremony'
      artifact: Record<string, unknown>
      summarised?: boolean
      modelUsed?: string
    },
    Error,
    {
      kind: 'inbox' | 'issue' | 'ceremony'
      projectId?: string
      columnSlug?: string
      rawTranscript?: boolean
    }
  >({
    mutationFn: (input) =>
      apiFetch(`/api/consult/${sessionId}/promote`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['consultSession', sessionId] })
      void qc.invalidateQueries({ queryKey: ['consultSessions'] })
    },
  })
}

// ─── Realtime stream ───────────────────────────────────────────────────────

const CONSULT_EVENT_TYPES = [
  'consult.started',
  'consult.user_message',
  'consult.message_delta',
  'consult.reasoning_delta',
  'consult.message_complete',
  'consult.tool_call',
  'consult.proposal_created',
  'consult.proposal_decided',
  'consult.usage',
  'consult.error',
  'consult.completed',
  /** W28 J5: coordinator context snapshot for the UI panel. */
  'consult.context',
] as const

export interface ConsultStreamEntry {
  key: string
  type: (typeof CONSULT_EVENT_TYPES)[number]
  payload: WsEventMap[(typeof CONSULT_EVENT_TYPES)[number]]
  receivedAt: number
}

/** Which real-time transport is currently in use. */
export type ConsultTransport = 'ws' | 'sse' | null

const REFETCH_TYPES: ReadonlySet<(typeof CONSULT_EVENT_TYPES)[number]> = new Set([
  'consult.message_complete',
  'consult.usage',
  'consult.completed',
  'consult.error',
  'consult.proposal_created',
  'consult.proposal_decided',
])

/** 3 s: if WS is not connected by this deadline, fall back to SSE. */
const WS_FALLBACK_TIMEOUT_MS = 3_000

/**
 * Subscribe to a consult session's real-time event stream.
 *
 * Transport strategy (W28 J3):
 *   1. WS (preferred) — subscribe immediately. If not connected within 3 s,
 *      fall back to SSE.
 *   2. SSE fallback — opens `GET /api/consult/:id/stream`. Browser EventSource
 *      auto-reconnects with `Last-Event-Id` on the first disconnect. A second
 *      failure surfaces `showRetryBar = true` so the caller can render a
 *      MessageBar with a Retry button.
 *
 * The caller drives the visible transcript by combining
 * useConsultSession() (initial hydration) with this hook (live tail).
 */
export function useConsultStream(sessionId: string | null) {
  const [entries, setEntries] = useState<ConsultStreamEntry[]>([])
  const [transport, setTransport] = useState<ConsultTransport>(null)
  const [showRetryBar, setShowRetryBar] = useState(false)
  const counter = useRef(0)
  const qc = useQueryClient()
  const activeTransportRef = useRef<ConsultTransport>(null)
  const lastEventIdRef = useRef<string | null>(null)
  const sseErrorCountRef = useRef(0)

  // Keep a stable ref to qc so the effect only depends on [sessionId].
  const qcRef = useRef(qc)
  qcRef.current = qc

  useEffect(() => {
    if (!sessionId) return

    const room = `consult:${sessionId}`
    activeTransportRef.current = 'ws'
    setTransport('ws')
    setShowRetryBar(false)

    wsClient.subscribeRoom(room)

    function addEntry(type: (typeof CONSULT_EVENT_TYPES)[number], payload: unknown) {
      if (!payload || typeof payload !== 'object') return
      const sid = (payload as { sessionId?: string }).sessionId
      if (sid !== sessionId) return
      const key = `${Date.now()}-${counter.current++}`
      setEntries((prev) => [
        ...prev,
        { key, type, payload: payload as ConsultStreamEntry['payload'], receivedAt: Date.now() },
      ])
      if (REFETCH_TYPES.has(type)) {
        void qcRef.current.invalidateQueries({ queryKey: ['consultSession', sessionId] })
        void qcRef.current.invalidateQueries({ queryKey: ['consultSessions'] })
      }
    }

    function openSSE(fromLastEventId?: string | null): () => void {
      activeTransportRef.current = 'sse'
      setTransport('sse')
      sseErrorCountRef.current = 0

      const url = fromLastEventId
        ? `/api/consult/${sessionId}/stream?lastEventId=${encodeURIComponent(fromLastEventId)}`
        : `/api/consult/${sessionId}/stream`

      const es = new EventSource(url)

      for (const evType of CONSULT_EVENT_TYPES) {
        es.addEventListener(evType, (ev: MessageEvent) => {
          if (activeTransportRef.current !== 'sse') return
          if (ev.lastEventId) lastEventIdRef.current = ev.lastEventId
          try {
            addEntry(evType, JSON.parse(ev.data as string) as unknown)
          } catch { /* malformed data */ }
        })
      }

      es.onerror = () => {
        sseErrorCountRef.current += 1
        if (sseErrorCountRef.current >= 2) {
          es.close()
          setShowRetryBar(true)
        }
        // else: let EventSource auto-reconnect (it sends Last-Event-Id automatically)
      }

      return () => es.close()
    }

    const handlers: Array<{ type: (typeof CONSULT_EVENT_TYPES)[number]; fn: (p: unknown) => void }> = []
    for (const type of CONSULT_EVENT_TYPES) {
      const fn = (payload: unknown) => {
        if (activeTransportRef.current !== 'ws') return
        addEntry(type, payload)
      }
      wsClient.on(type, fn as never)
      handlers.push({ type, fn })
    }

    let sseCleanup: (() => void) | null = null

    // 3 s deadline: fall back to SSE if WS isn't connected yet
    const fallbackTimer = setTimeout(() => {
      if (wsClient.state !== 'connected' && activeTransportRef.current === 'ws') {
        sseCleanup = openSSE(lastEventIdRef.current)
      }
    }, WS_FALLBACK_TIMEOUT_MS)

    // Mid-stream WS disconnect: switch to SSE
    const unsubState = wsClient.onStateChange((state) => {
      if (
        (state === 'disconnected' || state === 'reconnecting') &&
        activeTransportRef.current === 'ws' &&
        !sseCleanup
      ) {
        sseCleanup = openSSE(lastEventIdRef.current)
      }
    })

    return () => {
      clearTimeout(fallbackTimer)
      unsubState()
      for (const h of handlers) wsClient.off(h.type, h.fn as never)
      wsClient.unsubscribeRoom(room)
      sseCleanup?.()
      activeTransportRef.current = null
    }
  }, [sessionId]) // stable: qc accessed via qcRef, helpers defined inline

  useEffect(() => {
    setEntries([])
    lastEventIdRef.current = null
    sseErrorCountRef.current = 0
  }, [sessionId])

  return useMemo(
    () => ({ entries, transport, showRetryBar }),
    [entries, transport, showRetryBar],
  )
}

/** Exposed for callers that only need the entries array (backward compat). */
export function useConsultStreamEntries(sessionId: string | null): ConsultStreamEntry[] {
  return useConsultStream(sessionId).entries
}
