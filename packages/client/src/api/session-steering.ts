import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from './client.ts'

export interface InjectInput {
  prompt: string
  actor?: string
}

export interface HandoffInput {
  toAgentId: string
  note?: string
  actor?: string
}

export interface InviteInput {
  agentId: string
  note?: string
  actor?: string
}

export interface InterruptInput {
  reason?: string
  actor?: string
}

/**
 * POST /api/projects/:projectId/sessions/:sessionId/inject — mid-turn user
 * message. Identical to /messages but emits a `session.steered` event so the
 * timeline can show a "user steered the agent" row.
 */
export function useInjectMessage(projectId: string, sessionId: string) {
  const qc = useQueryClient()
  return useMutation<{ ok: true }, Error, InjectInput>({
    mutationFn: (input) =>
      apiFetch(`/api/projects/${projectId}/sessions/${sessionId}/inject`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['liveSession', projectId, sessionId] })
    },
  })
}

/**
 * POST /sessions/:id/interrupt — best-effort cancel of the current turn while
 * keeping the session alive.
 */
export function useInterruptSession(projectId: string, sessionId: string) {
  const qc = useQueryClient()
  return useMutation<
    { ok: true; honoured: boolean; reason?: string },
    Error,
    InterruptInput | undefined
  >({
    mutationFn: (input) =>
      apiFetch(`/api/projects/${projectId}/sessions/${sessionId}/interrupt`, {
        method: 'POST',
        body: JSON.stringify(input ?? {}),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['liveSession', projectId, sessionId] })
    },
  })
}

/**
 * POST /sessions/:id/handoff — v1 stub: emits a `session.steered` event with
 * action='handoff'. Full agent rebinding is a follow-up.
 */
export function useHandoffSession(projectId: string, sessionId: string) {
  const qc = useQueryClient()
  return useMutation<{ ok: true; deferred: boolean }, Error, HandoffInput>({
    mutationFn: (input) =>
      apiFetch(`/api/projects/${projectId}/sessions/${sessionId}/handoff`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['liveSession', projectId, sessionId] })
    },
  })
}

/**
 * POST /sessions/:id/invite — v1 stub: emits a `session.steered` event with
 * action='invite'. Full coordinator-backed multi-participant sessions are
 * a follow-up.
 */
export function useInviteAgent(projectId: string, sessionId: string) {
  const qc = useQueryClient()
  return useMutation<{ ok: true; deferred: boolean }, Error, InviteInput>({
    mutationFn: (input) =>
      apiFetch(`/api/projects/${projectId}/sessions/${sessionId}/invite`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['liveSession', projectId, sessionId] })
    },
  })
}
