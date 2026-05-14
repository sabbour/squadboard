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
    queryFn: () => apiFetch<SquadDirectory[]>('/api/squad/discover'),
    enabled: false, // triggered manually
  })
}

export function useRegisterSquad() {
  const queryClient = useQueryClient()
  return useMutation<RegisterSquadResult, Error, RegisterSquadInput>({
    mutationFn: (input) =>
      apiFetch<RegisterSquadResult>('/api/squad/register', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projects'] })
    },
  })
}
