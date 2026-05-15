import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from './client.ts'

export interface ColumnMeta {
  id: string
  columnId: string
  label: string
  description: string | null
  color: string
  position: number
}

type Envelope<T> = { ok: boolean; data: T }

export function useColumnMeta(projectId: string) {
  return useQuery<ColumnMeta[]>({
    queryKey: ['column-meta', projectId],
    queryFn: async () => {
      const env = await apiFetch<Envelope<ColumnMeta[]>>(`/api/projects/${projectId}/columns`)
      return env.data
    },
    enabled: Boolean(projectId),
  })
}

export function useUpdateColumn(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation<
    ColumnMeta,
    Error,
    { columnId: string; label?: string; description?: string | null; color?: string }
  >({
    mutationFn: async ({ columnId, ...body }) => {
      const env = await apiFetch<Envelope<ColumnMeta>>(
        `/api/projects/${projectId}/columns/${columnId}`,
        { method: 'PATCH', body: JSON.stringify(body) },
      )
      return env.data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['column-meta', projectId] })
    },
  })
}

export function useResetColumns(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation<ColumnMeta[], Error, void>({
    mutationFn: async () => {
      const env = await apiFetch<Envelope<ColumnMeta[]>>(
        `/api/projects/${projectId}/columns/reset`,
        { method: 'POST' },
      )
      return env.data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['column-meta', projectId] })
    },
  })
}
