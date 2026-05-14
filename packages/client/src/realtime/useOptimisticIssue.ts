// Demo 12 — wraps issue update mutation with optimistic update + version tracking.
// On 409 conflict: reverts optimistic change, shows ConflictToast, and refetches.

import { useState, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../api/client.ts'
import type { Issue } from '../api/issues.ts'

export interface UpdateIssueInput {
  title?: string
  body?: string
  column?: Issue['column']
  labelIds?: string[]
  assigneeId?: string | null
  /** Optimistic-concurrency token — pass the issue's current updatedAt timestamp */
  version?: string
}

interface UseOptimisticIssueOptions {
  projectId: string
  issue: Issue
  onConflict?: () => void
}

export function useOptimisticIssue({ projectId, issue, onConflict }: UseOptimisticIssueOptions) {
  const queryClient = useQueryClient()
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)

  const update = useCallback(
    async (input: UpdateIssueInput): Promise<Issue | null> => {
      setIsPending(true)
      setError(null)
      setConflict(false)

      // Snapshot for rollback
      const snapshot = queryClient.getQueriesData<Issue[]>({ queryKey: ['issues', projectId], exact: false })

      // Optimistic update in cache
      queryClient.setQueriesData<Issue[]>(
        { queryKey: ['issues', projectId], exact: false },
        (old = []) =>
          old.map((i) =>
            i.id === issue.id
              ? {
                  ...i,
                  ...input,
                  // column comes from input if provided, else keep
                  column: input.column ?? i.column,
                }
              : i,
          ),
      )

      try {
        const body: UpdateIssueInput & { version?: string } = {
          ...input,
          version: input.version ?? issue.updatedAt,
        }
        const updated = await apiFetch<Issue>(
          `/api/projects/${projectId}/issues/${issue.id}`,
          { method: 'PATCH', body: JSON.stringify(body) },
        )

        // Replace optimistic entry with server truth
        queryClient.setQueriesData<Issue[]>(
          { queryKey: ['issues', projectId], exact: false },
          (old = []) => old.map((i) => (i.id === updated.id ? updated : i)),
        )
        setIsPending(false)
        return updated
      } catch (err) {
        const isConflict =
          err instanceof Error && (err.message.includes('409') || err.message.toLowerCase().includes('conflict'))

        // Rollback
        for (const [queryKey, data] of snapshot) {
          queryClient.setQueryData(queryKey, data)
        }

        if (isConflict) {
          setConflict(true)
          onConflict?.()
          // Refetch authoritative data
          void queryClient.invalidateQueries({ queryKey: ['issues', projectId] })
        } else {
          setError(err instanceof Error ? err.message : 'Update failed')
        }
        setIsPending(false)
        return null
      }
    },
    [issue, projectId, queryClient, onConflict],
  )

  const dismissConflict = useCallback(() => setConflict(false), [])

  return { update, isPending, error, conflict, dismissConflict }
}
