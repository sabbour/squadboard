import { useMutation, useQuery } from '@tanstack/react-query'
import { apiFetch } from './client.ts'
import type { CastingUniverseId } from './agents.ts'

type Envelope<T> = { ok: boolean; data: T }
const unwrap = <T>(r: Envelope<T>): T => r.data

export interface CastUniverseDescriptor {
  id: CastingUniverseId
  label: string
  characterCount: number
}

export interface CastIssueResult {
  tier: number | null
  agentName: string | null
  agentId: string | null
  score: number | null
  reasoning: string | null
  matchedRule: string | null
}

export interface CastIssueInput {
  title: string
  body?: string
  labels?: string[]
}

export function useCastingUniverses() {
  return useQuery<CastUniverseDescriptor[]>({
    queryKey: ['casting', 'universes'],
    queryFn: () =>
      apiFetch<Envelope<CastUniverseDescriptor[]>>('/api/casting/universes').then(unwrap),
    staleTime: 5 * 60 * 1000,
  })
}

export function useCastIssue(projectId: string) {
  return useMutation<CastIssueResult, Error, CastIssueInput>({
    mutationFn: (input) =>
      apiFetch<Envelope<CastIssueResult>>(`/api/projects/${projectId}/cast`, {
        method: 'POST',
        body: JSON.stringify(input),
      }).then(unwrap),
  })
}
