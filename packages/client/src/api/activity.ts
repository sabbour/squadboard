/**
 * api/activity.ts — Global activity feed for the /now view.
 *
 * useNowFeed() fuses a REST query (GET /api/activity/now) with a global WS
 * subscription so the page stays live without polling.
 *
 * WS strategy: subscribe to the '__global__' room, which the server fans out
 * ALL bus events to regardless of projectId. On any session.*, run.*, or
 * workflow.* event we invalidate the query — the full re-fetch is cheap (50
 * rows × 3 lists) and guarantees the view is always DB-authoritative.
 */

import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from './client.ts'
import { wsClient } from '../realtime/ws-client.ts'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NowLiveSession {
  id: string
  projectId: string
  projectName: string
  agentName: string | null
  status: string
  startedAt: string
  lastEventAt: string
}

export interface NowIssueRun {
  id: string
  projectId: string
  projectName: string
  issueId: string
  issueTitle: string
  agentName: string | null
  status: string
  startedAt: string | null
  leaseExpiresAt: string | null
}

export interface NowWorkflowRun {
  id: string
  projectId: string
  projectName: string
  workflowName: string
  status: string
  startedAt: string
  currentStepKind: string | null
}

export interface NowFeed {
  liveSessions: NowLiveSession[]
  issueRuns: NowIssueRun[]
  workflowRuns: NowWorkflowRun[]
}

// ---------------------------------------------------------------------------
// Event types that signal a change the Now view should reflect
// ---------------------------------------------------------------------------

const NOW_TRIGGER_EVENTS = [
  'session.started',
  'session.completed',
  'session.error',
  'run.started',
  'run.completed',
  'workflow.advanced',
] as const

type NowTriggerEvent = (typeof NOW_TRIGGER_EVENTS)[number]

// ---------------------------------------------------------------------------
// useNowFeed
// ---------------------------------------------------------------------------

export function useNowFeed() {
  const qc = useQueryClient()

  const query = useQuery<NowFeed>({
    queryKey: ['activity', 'now'],
    queryFn: () => apiFetch<NowFeed>('/api/activity/now'),
    // Fallback poll every 15 s in case WS drops; aggressive enough to feel
    // live, conservative enough not to hammer the server.
    refetchInterval: 15_000,
    staleTime: 5_000,
  })

  useEffect(() => {
    // Subscribe to the global room. The existing subscribeRoom() mechanism
    // (originally added for cross-project consult sessions) is the right tool:
    // it sends { type: 'subscribe', projectId: '__global__' } and the server
    // routes that to its globalClients set.
    wsClient.subscribeRoom('__global__')

    const handlers: Array<{ type: NowTriggerEvent; fn: () => void }> = []

    for (const type of NOW_TRIGGER_EVENTS) {
      const fn = () => {
        void qc.invalidateQueries({ queryKey: ['activity', 'now'] })
      }
      wsClient.on(type as NowTriggerEvent, fn)
      handlers.push({ type, fn })
    }

    return () => {
      for (const h of handlers) {
        wsClient.off(h.type, h.fn)
      }
      wsClient.unsubscribeRoom('__global__')
    }
  }, [qc])

  return query
}
