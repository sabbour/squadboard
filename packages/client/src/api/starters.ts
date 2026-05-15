import { useMutation, useQuery } from '@tanstack/react-query'
import { apiFetch } from './client.ts'

type Envelope<T> = { ok: boolean; data: T }
const unwrap = <T>(r: Envelope<T>): T => r.data

export interface StarterMeta {
  slug: string
  title: string
  blurb?: string | null
  tags: string[]
  htmlUrl: string
  defaultModel?: string | null
  teamName?: string | null
}

export interface StarterPlannedAgent {
  name: string
  role: string
  model?: string | null
}

export interface StarterPlannedRoutingRule {
  priority: number
  matchType: string
  pattern: string
  agentName: string
}

export interface StarterPlannedCeremony {
  name: string
  filePath: string
}

export interface StarterProvisioningPlan {
  defaultModel: string | null
  teamName: string | null
  agents: StarterPlannedAgent[]
  routingRules: StarterPlannedRoutingRule[]
  ceremonies: StarterPlannedCeremony[]
  warnings: string[]
}

export interface StarterDetail {
  meta: StarterMeta
  readme: string
  plan: StarterProvisioningPlan
  source: string
}

export interface UseStarterInput {
  projectName?: string
  projectPath?: string
}

export interface UseStarterResult {
  project: { id: string; name: string; path?: string }
  result: {
    agentsInserted: number
    routingRulesInserted: number
    filesWritten: number
  }
  plan: {
    agents: { name: string; role: string }[]
    routingRules: number
    ceremonies: number
    warnings: string[]
  }
}

export function useStarter(slug: string | undefined) {
  return useQuery<StarterDetail>({
    queryKey: ['starters', slug ?? null],
    queryFn: () =>
      apiFetch<Envelope<StarterDetail>>(`/api/starters/${slug}`).then(unwrap),
    enabled: Boolean(slug),
    staleTime: 60_000,
  })
}

export function useUseStarter(slug: string | undefined) {
  return useMutation<UseStarterResult, Error, UseStarterInput>({
    mutationFn: (input) =>
      apiFetch<Envelope<UseStarterResult>>(`/api/starters/${slug}/use`, {
        method: 'POST',
        body: JSON.stringify(input ?? {}),
      }).then(unwrap),
  })
}
