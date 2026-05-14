import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from './client.ts'

export interface InitSquadInput {
  path: string
  projectName?: string
}

export interface InitSquadResult {
  projectId: string
  projectName: string
  squadPath: string
}

export interface CreateSquadInput {
  parentPath: string
  projectName: string
}

export interface CreateSquadResult {
  projectId: string
  projectName: string
  squadPath: string
  projectPath: string
}

export interface SquadDirectory {
  path: string
  name: string
  hasAgents: boolean
}

export interface RegisterSquadInput {
  path: string
  projectName?: string
}

export interface RegisterSquadResult {
  projectId: string
  projectName: string
  squadPath: string
}

export function useDiscoverSquad() {
  return useQuery<SquadDirectory[]>({
    queryKey: ['squad', 'discover'],
    queryFn: () =>
      apiFetch<{ ok: boolean; data: SquadDirectory[] }>('/api/squad/discover').then((r) => r.data),
    enabled: false, // triggered manually
  })
}

export function useRegisterSquad() {
  const queryClient = useQueryClient()
  return useMutation<RegisterSquadResult, Error, RegisterSquadInput>({
    mutationFn: (input) =>
      apiFetch<{ ok: boolean; data: { projectId: string; name: string; squadPath: string } }>(
        '/api/squad/register',
        {
          method: 'POST',
          // Backend expects { path, name } — map projectName → name
          body: JSON.stringify({ path: input.path, name: input.projectName }),
        },
      ).then((r) => ({
        projectId: r.data.projectId,
        projectName: r.data.name,
        squadPath: r.data.squadPath,
      })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projects'] })
    },
  })
}

export function useInitSquad() {
  const queryClient = useQueryClient()
  return useMutation<InitSquadResult, Error, InitSquadInput>({
    mutationFn: (input) =>
      apiFetch<{ ok: boolean; data: InitSquadResult }>('/api/squad/init', {
        method: 'POST',
        body: JSON.stringify(input),
      }).then((r) => r.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projects'] })
    },
  })
}

export function useCreateSquad() {
  const queryClient = useQueryClient()
  return useMutation<CreateSquadResult, Error, CreateSquadInput>({
    mutationFn: (input) =>
      apiFetch<{ ok: boolean; data: CreateSquadResult }>('/api/squad/create', {
        method: 'POST',
        body: JSON.stringify(input),
      }).then((r) => r.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projects'] })
    },
  })
}
