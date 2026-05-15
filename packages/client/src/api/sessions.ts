import { useEffect, useState, useMemo, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from './client.ts'
import { wsClient, type WsEventMap } from '../realtime/ws-client.ts'

export interface LiveSession {
  id: string
  projectId: string
  agentId: string | null
  agentName: string | null
  title: string | null
  status: 'active' | 'idle' | 'completed' | 'failed' | 'cancelled'
  model: string | null
  sdkSessionId: string | null
  inputTokens: number
  outputTokens: number
  costUsd: string                        // numeric column → string
  turnCount: number
  errorMessage: string | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
  isRunning?: boolean
}

export interface LiveSessionEvent {
  id: string
  sessionId: string
  type: 'session.started' | 'session.message' | 'session.delta' | 'session.tool' | 'session.usage' | 'session.error' | 'session.completed' | 'consult.request' | 'consult.response' | 'consult.error'
  payload: Record<string, unknown>
  createdAt: string
}

export interface LiveSessionDetail extends LiveSession {
  events: LiveSessionEvent[]
}

export interface StartSessionInput {
  agentId?: string
  agentName?: string
  model?: string
  prompt: string
  title?: string
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function useLiveSessions(projectId: string) {
  return useQuery<LiveSession[]>({
    queryKey: ['liveSessions', projectId],
    queryFn: () => apiFetch<LiveSession[]>(`/api/projects/${projectId}/sessions`),
    enabled: Boolean(projectId),
    refetchInterval: 5000,
  })
}

export function useLiveSession(projectId: string, sessionId: string | null) {
  return useQuery<LiveSessionDetail>({
    queryKey: ['liveSession', projectId, sessionId],
    queryFn: () => apiFetch<LiveSessionDetail>(`/api/projects/${projectId}/sessions/${sessionId}`),
    enabled: Boolean(projectId && sessionId),
  })
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export function useStartLiveSession(projectId: string) {
  const qc = useQueryClient()
  return useMutation<{ id: string; sdkSessionId: string }, Error, StartSessionInput>({
    mutationFn: (input) =>
      apiFetch<{ id: string; sdkSessionId: string }>(
        `/api/projects/${projectId}/sessions`,
        { method: 'POST', body: JSON.stringify(input) },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['liveSessions', projectId] })
    },
  })
}

export function useSendSessionMessage(projectId: string, sessionId: string) {
  const qc = useQueryClient()
  return useMutation<{ ok: true }, Error, { prompt: string }>({
    mutationFn: (input) =>
      apiFetch<{ ok: true }>(
        `/api/projects/${projectId}/sessions/${sessionId}/messages`,
        { method: 'POST', body: JSON.stringify(input) },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['liveSession', projectId, sessionId] })
    },
  })
}

export function useEndLiveSession(projectId: string) {
  const qc = useQueryClient()
  return useMutation<{ ok: true }, Error, string>({
    mutationFn: (sessionId) =>
      apiFetch<{ ok: true }>(
        `/api/projects/${projectId}/sessions/${sessionId}`,
        { method: 'DELETE' },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['liveSessions', projectId] })
    },
  })
}

// ---------------------------------------------------------------------------
// Realtime: subscribe to session.* events for a particular sessionId
// ---------------------------------------------------------------------------

export interface LiveStreamEntry {
  /** Stable per-render key. */
  key: string
  /** Event type from the wire. */
  type: keyof WsEventMap
  /** Payload, narrowed at the read site. */
  payload: unknown
  /** Local timestamp when received. */
  receivedAt: number
}

const SESSION_EVENT_TYPES = [
  'session.started',
  'session.message',
  'session.delta',
  'session.tool',
  'session.usage',
  'session.error',
  'session.completed',
  'session.steered',
] as const

/**
 * Subscribe to a project's WS room and surface `session.*` events for the
 * given sessionId. The caller is responsible for hydrating the initial
 * transcript via useLiveSession() — this hook only carries the live tail.
 */
export function useSessionStream(projectId: string, sessionId: string | null) {
  const [entries, setEntries] = useState<LiveStreamEntry[]>([])
  const counter = useRef(0)
  const qc = useQueryClient()

  useEffect(() => {
    if (!projectId || !sessionId) return

    wsClient.connect(projectId)

    const handlers: Array<{ type: (typeof SESSION_EVENT_TYPES)[number]; fn: (p: unknown) => void }> = []

    for (const type of SESSION_EVENT_TYPES) {
      const fn = (payload: unknown) => {
        if (!payload || typeof payload !== 'object') return
        const sid = (payload as { sessionId?: string }).sessionId
        if (sid !== sessionId) return
        const key = `${Date.now()}-${counter.current++}`
        setEntries((prev) => [...prev, { key, type, payload, receivedAt: Date.now() }])

        // Roll up totals → invalidate queries on usage/completed.
        if (type === 'session.usage' || type === 'session.completed' || type === 'session.error') {
          void qc.invalidateQueries({ queryKey: ['liveSession', projectId, sessionId] })
          void qc.invalidateQueries({ queryKey: ['liveSessions', projectId] })
        }
      }
      wsClient.on(type, fn as never)
      handlers.push({ type, fn })
    }

    return () => {
      for (const h of handlers) wsClient.off(h.type, h.fn as never)
    }
  }, [projectId, sessionId, qc])

  // Reset stream when switching sessions.
  useEffect(() => {
    setEntries([])
  }, [sessionId])

  return useMemo(() => entries, [entries])
}
