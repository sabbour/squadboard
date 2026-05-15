/**
 * api/tools.ts — Phase 13 client hooks for the tools registry.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from './client.ts'

export interface Tool {
  id: string
  projectId: string
  key: string
  name: string
  description: string
  category: string | null
  mcpServerId: string | null
  inputSchema: unknown
  outputSchema: unknown
  createdAt: string
  updatedAt: string
}

export interface AgentTool extends Tool {
  assignedAt: string
}

type Envelope<T> = { ok: boolean; data: T }
const unwrap = <T>(r: Envelope<T>): T => r.data

export function useTools(projectId: string) {
  return useQuery<Tool[]>({
    queryKey: ['tools', projectId],
    queryFn: () => apiFetch<Envelope<Tool[]>>(`/api/projects/${projectId}/tools`).then(unwrap),
    enabled: Boolean(projectId),
  })
}

export function useAgentTools(projectId: string, agentId: string) {
  return useQuery<AgentTool[]>({
    queryKey: ['tools', projectId, 'agent', agentId],
    queryFn: () =>
      apiFetch<Envelope<AgentTool[]>>(`/api/projects/${projectId}/agents/${agentId}/tools`).then(unwrap),
    enabled: Boolean(projectId) && Boolean(agentId),
  })
}

export function useCreateTool(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: Partial<Tool> & { key: string; name: string; description: string }) =>
      apiFetch<Envelope<Tool>>(`/api/projects/${projectId}/tools`, {
        method: 'POST',
        body: JSON.stringify(input),
      }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tools', projectId] }),
  })
}

export function useUpdateTool(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: Partial<Tool> & { id: string }) =>
      apiFetch<Envelope<Tool>>(`/api/projects/${projectId}/tools/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tools', projectId] }),
  })
}

export function useDeleteTool(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<Envelope<unknown>>(`/api/projects/${projectId}/tools/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tools', projectId] }),
  })
}

export function useAssignToolsToAgent(projectId: string, agentId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (toolIds: string[]) =>
      apiFetch<Envelope<{ assigned: string[]; skipped: string[] }>>(
        `/api/projects/${projectId}/agents/${agentId}/tools`,
        { method: 'POST', body: JSON.stringify({ toolIds }) },
      ).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tools', projectId, 'agent', agentId] }),
  })
}

export function useUnassignToolFromAgent(projectId: string, agentId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (toolId: string) =>
      apiFetch<Envelope<unknown>>(
        `/api/projects/${projectId}/agents/${agentId}/tools/${toolId}`,
        { method: 'DELETE' },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tools', projectId, 'agent', agentId] }),
  })
}
