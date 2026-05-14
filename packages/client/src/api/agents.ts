import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from './client.ts'

export interface Agent {
  id: string
  name: string
  role: string
  model?: string
  status: 'active' | 'disabled' | 'retired'
  charterPath: string
  createdAt: string
  updatedAt: string
}

export interface AgentWithHistory extends Agent {
  historyExcerpt?: string
}

export interface CreateAgentInput {
  name: string
  role: string
  model?: string
  expertise?: string[]
}

export interface UpdateAgentInput {
  role?: string
  model?: string
  status?: Agent['status']
}

export function useAgents(projectId: string) {
  return useQuery<Agent[]>({
    queryKey: ['agents', projectId],
    queryFn: () => apiFetch<Agent[]>(`/api/projects/${projectId}/agents`),
    enabled: Boolean(projectId),
  })
}

export function useAgent(projectId: string, agentId: string) {
  return useQuery<AgentWithHistory>({
    queryKey: ['agents', projectId, agentId],
    queryFn: () => apiFetch<AgentWithHistory>(`/api/projects/${projectId}/agents/${agentId}`),
    enabled: Boolean(projectId) && Boolean(agentId),
  })
}

export function useCreateAgent(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation<Agent, Error, CreateAgentInput>({
    mutationFn: (input) =>
      apiFetch<Agent>(`/api/projects/${projectId}/agents`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['agents', projectId] })
    },
  })
}

export function useUpdateAgent(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation<Agent, Error, { agentId: string } & UpdateAgentInput>({
    mutationFn: ({ agentId, ...input }) =>
      apiFetch<Agent>(`/api/projects/${projectId}/agents/${agentId}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    onSuccess: (_, vars) => {
      void queryClient.invalidateQueries({ queryKey: ['agents', projectId] })
      void queryClient.invalidateQueries({ queryKey: ['agents', projectId, vars.agentId] })
    },
  })
}

export function useDisableAgent(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation<void, Error, string>({
    mutationFn: (agentId) =>
      apiFetch<void>(`/api/projects/${projectId}/agents/${agentId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['agents', projectId] })
    },
  })
}

export function useAgentCharter(projectId: string, agentId: string) {
  return useQuery<{ content: string }>({
    queryKey: ['agents', projectId, agentId, 'charter'],
    queryFn: () => apiFetch<{ content: string }>(`/api/projects/${projectId}/agents/${agentId}/charter`),
    enabled: Boolean(projectId) && Boolean(agentId),
  })
}

export function useUpdateCharter(projectId: string, agentId: string) {
  const queryClient = useQueryClient()
  return useMutation<Agent, Error, string>({
    mutationFn: (content) =>
      apiFetch<Agent>(`/api/projects/${projectId}/agents/${agentId}/charter`, {
        method: 'PATCH',
        body: JSON.stringify({ content }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['agents', projectId, agentId, 'charter'] })
      void queryClient.invalidateQueries({ queryKey: ['agents', projectId, agentId] })
    },
  })
}
