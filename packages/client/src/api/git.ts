import { useMutation } from '@tanstack/react-query'
import { apiFetch } from './client.ts'

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

export interface PushResult {
  branch: string
  branchUrl: string
  pushOutput: string
}

export interface PrResult {
  prUrl: string
  prNumber?: number
}

export interface CreatePrPayload {
  title?: string
  body?: string
  draft?: boolean
}

export interface CommentResult {
  commentUrl: string
  issueNumber: number
}

export interface MergeResult {
  prUrl: string
  sha: string
  method: 'merge' | 'squash' | 'rebase'
}

export type MergeMethod = 'merge' | 'squash' | 'rebase'

export function usePushBranch(projectId: string) {
  return useMutation<PushResult, Error, { runId: string }>({
    mutationFn: ({ runId }) =>
      apiFetch<PushResult>(`/api/projects/${projectId}/runs/${runId}/git/push`, {
        method: 'POST',
      }),
  })
}

export function useCreatePr(projectId: string) {
  return useMutation<PrResult, Error, { runId: string } & CreatePrPayload>({
    mutationFn: ({ runId, ...payload }) =>
      apiFetch<PrResult>(`/api/projects/${projectId}/runs/${runId}/git/pr`, {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
  })
}

export function useCommentOnIssue(projectId: string) {
  return useMutation<CommentResult, Error, { runId: string; issueNumber: number; body: string }>({
    mutationFn: ({ runId, ...payload }) =>
      apiFetch<CommentResult>(`/api/projects/${projectId}/runs/${runId}/git/comment`, {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
  })
}

export function useMergePr(projectId: string) {
  return useMutation<MergeResult, Error, { runId: string; method?: MergeMethod }>({
    mutationFn: ({ runId, method }) =>
      apiFetch<MergeResult>(`/api/projects/${projectId}/runs/${runId}/git/pr/merge`, {
        method: 'POST',
        body: JSON.stringify({ method }),
      }),
  })
}

/** Fetch the default PR body template pre-filled with run context. */
export async function fetchPrTemplate(
  projectId: string,
  runId: string,
): Promise<{ title: string; body: string }> {
  const res = await fetch(`${BASE}/api/projects/${projectId}/runs/${runId}/git/pr-template`)
  if (!res.ok) return { title: '', body: '' }
  return res.json() as Promise<{ title: string; body: string }>
}
