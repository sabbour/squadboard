import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

export interface IssueAttachment {
  id: string
  filename: string
  mimeType: string
  sizeBytes: number
  url: string
  createdAt: string
}

export function useIssueAttachments(projectId: string, issueId: string) {
  return useQuery<IssueAttachment[]>({
    queryKey: ['issue-attachments', projectId, issueId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/issues/${issueId}/attachments`)
      if (!res.ok) throw new Error('Failed to load attachments')
      const json = await res.json()
      return json.data as IssueAttachment[]
    },
    enabled: Boolean(projectId) && Boolean(issueId),
  })
}

export function useUploadIssueAttachment(projectId: string, issueId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (file: File): Promise<IssueAttachment> => {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch(`/api/projects/${projectId}/issues/${issueId}/attachments`, {
        method: 'POST',
        body: fd,
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'upload_failed' }))
        throw new Error(err.error || 'upload_failed')
      }
      const json = await res.json()
      return json.data as IssueAttachment
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['issue-attachments', projectId, issueId] }),
  })
}

export function useDeleteIssueAttachment(projectId: string, issueId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (attachmentId: string) => {
      const res = await fetch(
        `/api/projects/${projectId}/issues/${issueId}/attachments/${attachmentId}`,
        { method: 'DELETE' },
      )
      if (!res.ok && res.status !== 204) throw new Error('Delete failed')
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['issue-attachments', projectId, issueId] }),
  })
}
