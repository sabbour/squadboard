import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from './client.ts'

export interface ColumnMeta {
  id: string
  columnId: string
  label: string
  description: string | null
  color: string
  position: number
  /** Roll-up bucket for analytics and GitHub sync. */
  semantic: 'backlog' | 'ready' | 'in_progress' | 'review' | 'done' | 'custom'
  /** True on exactly one column per project — new issues land here. */
  isDefault: boolean
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
    {
      columnId: string
      label?: string
      description?: string | null
      color?: string
      semantic?: ColumnMeta['semantic']
      isDefault?: boolean
    }
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

export function useCreateColumn(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation<
    ColumnMeta,
    Error,
    {
      columnId: string
      label: string
      description?: string | null
      color: string
      position?: number
      semantic?: ColumnMeta['semantic']
    }
  >({
    mutationFn: async (body) => {
      const env = await apiFetch<Envelope<ColumnMeta>>(
        `/api/projects/${projectId}/columns`,
        { method: 'POST', body: JSON.stringify(body) },
      )
      return env.data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['column-meta', projectId] })
    },
  })
}

export function useDeleteColumn(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation<void, Error, { columnId: string; reassignTo: string }>({
    mutationFn: async ({ columnId, reassignTo }) => {
      await apiFetch<Envelope<void>>(
        `/api/projects/${projectId}/columns/${columnId}?reassignTo=${encodeURIComponent(reassignTo)}`,
        { method: 'DELETE' },
      )
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['column-meta', projectId] })
    },
  })
}

export function useReorderColumns(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation<ColumnMeta[], Error, { order: string[] }>({
    mutationFn: async (body) => {
      const env = await apiFetch<Envelope<ColumnMeta[]>>(
        `/api/projects/${projectId}/columns/reorder`,
        { method: 'PATCH', body: JSON.stringify(body) },
      )
      return env.data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['column-meta', projectId] })
    },
  })
}
