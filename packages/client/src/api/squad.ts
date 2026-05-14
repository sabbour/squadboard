import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from './client.ts'

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
