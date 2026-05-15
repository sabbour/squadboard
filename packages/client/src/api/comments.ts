import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from './client.ts'

export interface Comment {
  id: string
  issueId: string
  authorId: string | null
  authorName: string | null
  authorAvatarUrl?: string
  authorRole?: string | null
  authorKind: 'human' | 'agent' | 'system'
  authorRef: string | null
  agentId?: string | null
  mentions: string[]
  eventKind?: string | null
  eventPayload?: Record<string, unknown> | null
  body: string
  createdAt: string
  updatedAt?: string
}

export interface AddCommentInput {
  body: string
  authorKind?: 'human' | 'agent' | 'system'
  authorRef?: string | null
  authorId?: string | null
  mentions?: string[]
}

export interface MentionDispatchResult {
  agent: string
  action: 'inject' | 'spawn' | 'skipped' | 'error'
  sessionId?: string
  error?: string
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

export function useDispatchMention(projectId: string, issueId: string) {
  return useMutation<{ results: MentionDispatchResult[] }, Error, { commentId?: string; body: string; mentions: string[] }>({
    mutationFn: (input) =>
      apiFetch<{ results: MentionDispatchResult[] }>(
        `/api/projects/${projectId}/issues/${issueId}/mention`,
        {
          method: 'POST',
          body: JSON.stringify(input),
        },
      ),
  })
}
