import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from './client.ts'

export interface Comment {
  id: string
  issueId: string
  authorId: string
  authorName: string
  authorAvatarUrl?: string
  body: string
  createdAt: string
}

export interface AddCommentInput {
  body: string
}

export function useComments(projectId: string, issueId: string) {
  return useQuery<Comment[]>({
    queryKey: ['comments', projectId, issueId],
    queryFn: () => apiFetch<Comment[]>(`/api/projects/${projectId}/issues/${issueId}/comments`),
    enabled: Boolean(projectId) && Boolean(issueId),
  })
}

export function useAddComment(projectId: string, issueId: string) {
  const queryClient = useQueryClient()
  return useMutation<Comment, Error, AddCommentInput>({
    mutationFn: (input) =>
      apiFetch<Comment>(`/api/projects/${projectId}/issues/${issueId}/comments`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['comments', projectId, issueId] })
      void queryClient.invalidateQueries({ queryKey: ['issues', projectId] })
    },
  })
}
