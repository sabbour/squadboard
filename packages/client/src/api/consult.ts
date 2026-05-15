import { useEffect, useMemo, useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from './client.ts'
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
    { kind: 'inbox' | 'issue' | 'ceremony'; artifact: Record<string, unknown> },
    Error,
    { kind: 'inbox' | 'issue' | 'ceremony'; projectId?: string; columnSlug?: string }
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
] as const

export interface ConsultStreamEntry {
  key: string
  type: (typeof CONSULT_EVENT_TYPES)[number]
  payload: WsEventMap[(typeof CONSULT_EVENT_TYPES)[number]]
  receivedAt: number
}

/**
 * Subscribe to a consult session's WS room and surface streaming events.
 * The caller drives the visible transcript by combining
 * useConsultSession() (initial hydration) with this hook (live tail).
 */
export function useConsultStream(sessionId: string | null) {
  const [entries, setEntries] = useState<ConsultStreamEntry[]>([])
  const counter = useRef(0)
  const qc = useQueryClient()

  useEffect(() => {
    if (!sessionId) return
    const room = `consult:${sessionId}`
    wsClient.subscribeRoom(room)

    const handlers: Array<{ type: (typeof CONSULT_EVENT_TYPES)[number]; fn: (p: unknown) => void }> = []
    for (const type of CONSULT_EVENT_TYPES) {
      const fn = (payload: unknown) => {
        if (!payload || typeof payload !== 'object') return
        const sid = (payload as { sessionId?: string }).sessionId
        if (sid !== sessionId) return
        const key = `${Date.now()}-${counter.current++}`
        setEntries((prev) => [
          ...prev,
          { key, type, payload: payload as ConsultStreamEntry['payload'], receivedAt: Date.now() },
        ])
        if (
          type === 'consult.message_complete' ||
          type === 'consult.usage' ||
          type === 'consult.completed' ||
          type === 'consult.error' ||
          type === 'consult.proposal_created' ||
          type === 'consult.proposal_decided'
        ) {
          void qc.invalidateQueries({ queryKey: ['consultSession', sessionId] })
          void qc.invalidateQueries({ queryKey: ['consultSessions'] })
        }
      }
      wsClient.on(type, fn as never)
      handlers.push({ type, fn })
    }

    return () => {
      for (const h of handlers) wsClient.off(h.type, h.fn as never)
      wsClient.unsubscribeRoom(room)
    }
  }, [sessionId, qc])

  useEffect(() => {
    setEntries([])
  }, [sessionId])

  return useMemo(() => entries, [entries])
}
