import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from './client.ts'

export interface DiagnosticCheck {
  id: string
  label: string
  status: 'ok' | 'warn' | 'fail'
  detail?: string
  remediation?: string
  durationMs: number
}

export interface DiagnosticsResponse {
  checks: DiagnosticCheck[]
  generatedAt: string
  durationMs: number
}

function diagnosticsUrl(projectId?: string): string {
  return projectId
    ? `/api/projects/${projectId}/diagnostics`
    : '/api/diagnostics'
}

export function useDiagnostics(opts?: { projectId?: string }) {
  const url = diagnosticsUrl(opts?.projectId)
  return useQuery<DiagnosticsResponse>({
    queryKey: ['diagnostics', opts?.projectId ?? 'global'],
    queryFn: () => apiFetch<DiagnosticsResponse>(url),
    refetchInterval: 30_000,
    staleTime: 5_000,
    retry: (failureCount, error) => {
      // Don't retry 404 — server hasn't deployed the service yet.
      if (error instanceof Error && error.message.startsWith('API 404')) return false
      return failureCount < 2
    },
  })
}

export function useRunDiagnostics(opts?: { projectId?: string }) {
  const queryClient = useQueryClient()
  const url = diagnosticsUrl(opts?.projectId)
  const queryKey = ['diagnostics', opts?.projectId ?? 'global']
  return useMutation<DiagnosticsResponse, Error, void>({
    mutationFn: () =>
      apiFetch<DiagnosticsResponse>(`${url}?bust=${Date.now()}`),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKey, data)
    },
  })
}
