/**
 * api/inbox.ts — Phase 14 quick-capture client hooks.
 *
 * Mirrors /api/inbox endpoints. All mutations invalidate the inbox list
 * query; publishInboxItem additionally invalidates the issues list for the
 * target project so the new card appears immediately.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from './client.ts'
import type { ColumnId, Issue } from './issues.ts'

export type InboxStatus = 'captured' | 'formulated' | 'published' | 'discarded'

export interface InboxItem {
  id: string
  userId: string | null
  originalDraft: string
  formulatedTitle: string | null
  formulatedBody: string | null
  suggestedLabels: string[]
  suggestedProjectId: string | null
  suggestedColumn: ColumnId | null
  confidence: 'high' | 'medium' | 'low' | null
  rationale: string | null
  status: InboxStatus
  publishedIssueId: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateInboxItemInput {
  originalDraft: string
  suggestedProjectId?: string | null
}

export interface UpdateInboxItemInput {
  formulatedTitle?: string
  formulatedBody?: string
  suggestedLabels?: string[]
  suggestedProjectId?: string | null
  suggestedColumn?: ColumnId | null
  confidence?: 'high' | 'medium' | 'low' | null
  rationale?: string | null
}

export interface PublishInboxItemInput {
  projectId: string
  columnSlug: ColumnId
}

export interface PublishInboxItemResult {
  item: InboxItem
  issue: Issue
}

interface ListFilters {
  status?: InboxStatus
  projectId?: string
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function useInboxItems(filters: ListFilters = {}) {
  const params = new URLSearchParams()
  if (filters.status) params.set('status', filters.status)
  if (filters.projectId) params.set('projectId', filters.projectId)
  const qs = params.toString() ? `?${params.toString()}` : ''
  return useQuery<InboxItem[]>({
    queryKey: ['inbox', filters],
    queryFn: () => apiFetch<InboxItem[]>(`/api/inbox${qs}`),
  })
}

export function useInboxItem(id: string | null | undefined) {
  return useQuery<InboxItem>({
    queryKey: ['inbox', 'item', id],
    queryFn: () => apiFetch<InboxItem>(`/api/inbox/${id}`),
    enabled: Boolean(id),
  })
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export function useCreateInboxItem() {
  const qc = useQueryClient()
  return useMutation<InboxItem, Error, CreateInboxItemInput>({
    mutationFn: (input) =>
      apiFetch<InboxItem>('/api/inbox', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['inbox'] })
    },
  })
}

export function useFormulateInboxItem(id: string | null | undefined) {
  const qc = useQueryClient()
  return useMutation<InboxItem, Error, void>({
    mutationFn: () =>
      apiFetch<InboxItem>(`/api/inbox/${id}/formulate`, { method: 'POST' }),
    onSuccess: (item) => {
      qc.setQueryData(['inbox', 'item', item.id], item)
      void qc.invalidateQueries({ queryKey: ['inbox'] })
    },
  })
}

export function useUpdateInboxItem(id: string | null | undefined) {
  const qc = useQueryClient()
  return useMutation<InboxItem, Error, UpdateInboxItemInput>({
    mutationFn: (patch) =>
      apiFetch<InboxItem>(`/api/inbox/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    onSuccess: (item) => {
      qc.setQueryData(['inbox', 'item', item.id], item)
      void qc.invalidateQueries({ queryKey: ['inbox'] })
    },
  })
}

export function usePublishInboxItem(id: string | null | undefined) {
  const qc = useQueryClient()
  return useMutation<PublishInboxItemResult, Error, PublishInboxItemInput>({
    mutationFn: (input) =>
      apiFetch<PublishInboxItemResult>(`/api/inbox/${id}/publish`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: (result) => {
      qc.setQueryData(['inbox', 'item', result.item.id], result.item)
      void qc.invalidateQueries({ queryKey: ['inbox'] })
      void qc.invalidateQueries({ queryKey: ['issues', result.item.suggestedProjectId] })
      void qc.invalidateQueries({ queryKey: ['issues', result.issue.projectId] })
    },
  })
}

export function useDiscardInboxItem(id: string | null | undefined) {
  const qc = useQueryClient()
  return useMutation<InboxItem, Error, void>({
    mutationFn: () => apiFetch<InboxItem>(`/api/inbox/${id}`, { method: 'DELETE' }),
    onSuccess: (item) => {
      qc.setQueryData(['inbox', 'item', item.id], item)
      void qc.invalidateQueries({ queryKey: ['inbox'] })
    },
  })
}
