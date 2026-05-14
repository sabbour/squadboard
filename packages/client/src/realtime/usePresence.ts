// Demo 12 — tracks which users are currently viewing the project.
// Fetches initial snapshot from REST, then keeps it live via WS events.

import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch } from '../api/client.ts'
import { wsClient, type PresenceUser } from './ws-client.ts'

export type { PresenceUser }

export function usePresence(projectId: string) {
  const [users, setUsers] = useState<PresenceUser[]>([])

  // Fetch initial presence list
  useEffect(() => {
    if (!projectId) return
    void apiFetch<PresenceUser[]>(`/api/projects/${projectId}/presence`)
      .then(setUsers)
      .catch(() => { /* presence is best-effort */ })
  }, [projectId])

  // Keep live via WS
  useEffect(() => {
    if (!projectId) return

    function onSnapshot(payload: { users: PresenceUser[] }) {
      setUsers(payload.users)
    }
    function onJoined(payload: { userId: string; projectId: string; issueId?: string }) {
      if (payload.projectId !== projectId) return
      setUsers((prev) => {
        if (prev.some((u) => u.userId === payload.userId)) return prev
        return [...prev, { userId: payload.userId, issueId: payload.issueId, connectedAt: new Date().toISOString() }]
      })
    }
    function onLeft(payload: { userId: string; projectId: string }) {
      if (payload.projectId !== projectId) return
      setUsers((prev) => prev.filter((u) => u.userId !== payload.userId))
    }
    function onUpdated(payload: { userId: string; projectId: string; issueId?: string | null }) {
      if (payload.projectId !== projectId) return
      setUsers((prev) =>
        prev.map((u) => (u.userId === payload.userId ? { ...u, issueId: payload.issueId } : u)),
      )
    }

    wsClient.on('presence.snapshot', onSnapshot)
    wsClient.on('presence.joined', onJoined)
    wsClient.on('presence.left', onLeft)
    wsClient.on('presence.updated', onUpdated)

    return () => {
      wsClient.off('presence.snapshot', onSnapshot)
      wsClient.off('presence.joined', onJoined)
      wsClient.off('presence.left', onLeft)
      wsClient.off('presence.updated', onUpdated)
    }
  }, [projectId])

  // Debounced cursor reporter (200ms)
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const reportCursor = useCallback((issueId: string | null) => {
    if (debounceTimer.current !== null) clearTimeout(debounceTimer.current)
    debounceTimer.current = setTimeout(() => {
      wsClient.sendPresence(issueId)
      debounceTimer.current = null
    }, 200)
  }, [])

  return { users, reportCursor }
}
