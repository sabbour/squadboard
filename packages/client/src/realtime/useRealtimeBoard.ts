// Demo 12 — connects the singleton WsClient to TanStack Query cache.
// Keeps all issue/run/workflow data live without polling.

import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { wsClient, type ConnectionState, type PresenceUser } from './ws-client.ts'
import type { Issue } from '../api/issues.ts'

export function useRealtimeBoard(projectId: string) {
  const queryClient = useQueryClient()
  const [connected, setConnected] = useState<ConnectionState>(wsClient.state)
  const [presenceList, setPresenceList] = useState<PresenceUser[]>([])

  useEffect(() => {
    if (!projectId) return

    wsClient.connect(projectId)

    // Track connection state
    const unsubState = wsClient.onStateChange(setConnected)

    // ── Issue events ─────────────────────────────────────────────────────────

    function onIssueCreated(payload: { projectId: string; issue: Record<string, unknown> }) {
      if (payload.projectId !== projectId) return
      queryClient.setQueriesData<Issue[]>(
        { queryKey: ['issues', projectId], exact: false },
        (old = []) => {
          const newIssue = payload.issue as unknown as Issue
          // Avoid duplicates
          if (old.some((i) => i.id === newIssue.id)) return old
          return [...old, newIssue]
        },
      )
    }

    function onIssueUpdated(payload: { projectId: string; issue: Record<string, unknown> }) {
      if (payload.projectId !== projectId) return
      const updated = payload.issue as unknown as Issue
      queryClient.setQueriesData<Issue[]>(
        { queryKey: ['issues', projectId], exact: false },
        (old = []) => old.map((i) => (i.id === updated.id ? { ...i, ...updated } : i)),
      )
    }

    function onIssueMoved(payload: { projectId: string; issueId: string; column: string; position: number }) {
      if (payload.projectId !== projectId) return
      queryClient.setQueriesData<Issue[]>(
        { queryKey: ['issues', projectId], exact: false },
        (old = []) =>
          old.map((i) =>
            i.id === payload.issueId
              ? { ...i, column: payload.column as Issue['column'] }
              : i,
          ),
      )
    }

    function onIssueDeleted(payload: { projectId: string; issueId: string }) {
      if (payload.projectId !== projectId) return
      queryClient.setQueriesData<Issue[]>(
        { queryKey: ['issues', projectId], exact: false },
        (old = []) => old.filter((i) => i.id !== payload.issueId),
      )
    }

    // ── Run events ───────────────────────────────────────────────────────────

    function onRunEvent(payload: { projectId: string; issueId: string }) {
      if (payload.projectId !== projectId) return
      void queryClient.invalidateQueries({ queryKey: ['runs', projectId, payload.issueId] })
      void queryClient.invalidateQueries({ queryKey: ['runs', projectId, 'detail'] })
    }

    function onWorkflowAdvanced(payload: { projectId: string; issueId: string; runId: string }) {
      if (payload.projectId !== projectId) return
      void queryClient.invalidateQueries({ queryKey: ['runs', projectId, payload.issueId] })
      void queryClient.invalidateQueries({ queryKey: ['runs', projectId, 'detail', payload.runId] })
    }

    // ── Presence events ──────────────────────────────────────────────────────

    function onPresenceSnapshot(payload: { users: PresenceUser[] }) {
      setPresenceList(payload.users)
    }

    function onPresenceJoined(payload: { userId: string; projectId: string; issueId?: string }) {
      if (payload.projectId !== projectId) return
      setPresenceList((prev) => {
        if (prev.some((u) => u.userId === payload.userId)) return prev
        return [...prev, { userId: payload.userId, issueId: payload.issueId, connectedAt: new Date().toISOString() }]
      })
    }

    function onPresenceLeft(payload: { userId: string; projectId: string }) {
      if (payload.projectId !== projectId) return
      setPresenceList((prev) => prev.filter((u) => u.userId !== payload.userId))
    }

    function onPresenceUpdated(payload: { userId: string; projectId: string; issueId?: string | null }) {
      if (payload.projectId !== projectId) return
      setPresenceList((prev) =>
        prev.map((u) => (u.userId === payload.userId ? { ...u, issueId: payload.issueId } : u)),
      )
    }

    // Register all handlers
    wsClient.on('issue.created', onIssueCreated)
    wsClient.on('issue.updated', onIssueUpdated)
    wsClient.on('issue.moved', onIssueMoved)
    wsClient.on('issue.deleted', onIssueDeleted)
    wsClient.on('run.started', onRunEvent)
    wsClient.on('run.completed', onRunEvent)
    wsClient.on('run.failed', onRunEvent)
    wsClient.on('run.cancelled', onRunEvent)
    wsClient.on('workflow.advanced', onWorkflowAdvanced)
    wsClient.on('presence.snapshot', onPresenceSnapshot)
    wsClient.on('presence.joined', onPresenceJoined)
    wsClient.on('presence.left', onPresenceLeft)
    wsClient.on('presence.updated', onPresenceUpdated)

    return () => {
      wsClient.off('issue.created', onIssueCreated)
      wsClient.off('issue.updated', onIssueUpdated)
      wsClient.off('issue.moved', onIssueMoved)
      wsClient.off('issue.deleted', onIssueDeleted)
      wsClient.off('run.started', onRunEvent)
      wsClient.off('run.completed', onRunEvent)
      wsClient.off('run.failed', onRunEvent)
      wsClient.off('run.cancelled', onRunEvent)
      wsClient.off('workflow.advanced', onWorkflowAdvanced)
      wsClient.off('presence.snapshot', onPresenceSnapshot)
      wsClient.off('presence.joined', onPresenceJoined)
      wsClient.off('presence.left', onPresenceLeft)
      wsClient.off('presence.updated', onPresenceUpdated)
      unsubState()
      wsClient.disconnect()
    }
  }, [projectId, queryClient])

  return { connected, presenceList }
}
