/**
 * api/skills.ts — Phase 13 client hooks for the skills registry.
 *
 * Mirrors the server's response envelope { ok, data } via `unwrap`.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from './client.ts'

export interface CuratedSkill {
  key: string
  name: string
  description: string
  category: string
  promptAddendum: string
}

export interface Skill {
  id: string
  projectId: string
  key: string
  name: string
  description: string | null
  category: string | null
  promptAddendum: string
  curatedKey: string | null
  createdAt: string
  updatedAt: string
}

export interface AgentSkill extends Skill {
  assignedAt: string
}

type Envelope<T> = { ok: boolean; data: T }
const unwrap = <T>(r: Envelope<T>): T => r.data

export function useCuratedSkills() {
  return useQuery<CuratedSkill[]>({
    queryKey: ['skills', 'curated'],
    queryFn: () => apiFetch<Envelope<CuratedSkill[]>>('/api/skills/curated').then(unwrap),
  })
}

export function useSkills(projectId: string) {
  return useQuery<Skill[]>({
    queryKey: ['skills', projectId],
    queryFn: () => apiFetch<Envelope<Skill[]>>(`/api/projects/${projectId}/skills`).then(unwrap),
    enabled: Boolean(projectId),
  })
}

export function useAgentSkills(projectId: string, agentId: string) {
  return useQuery<AgentSkill[]>({
    queryKey: ['skills', projectId, 'agent', agentId],
    queryFn: () =>
      apiFetch<Envelope<AgentSkill[]>>(`/api/projects/${projectId}/agents/${agentId}/skills`).then(unwrap),
    enabled: Boolean(projectId) && Boolean(agentId),
  })
}

export function useCreateSkill(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: Partial<Skill> & { key: string; name: string; promptAddendum: string }) =>
      apiFetch<Envelope<Skill>>(`/api/projects/${projectId}/skills`, {
        method: 'POST',
        body: JSON.stringify(input),
      }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['skills', projectId] }),
  })
}

export function useUpdateSkill(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: Partial<Skill> & { id: string }) =>
      apiFetch<Envelope<Skill>>(`/api/projects/${projectId}/skills/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['skills', projectId] }),
  })
}

export function useDeleteSkill(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<Envelope<unknown>>(`/api/projects/${projectId}/skills/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['skills', projectId] }),
  })
}

export function useCloneCuratedSkill(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (key: string) =>
      apiFetch<Envelope<Skill>>(`/api/projects/${projectId}/skills/clone-curated`, {
        method: 'POST',
        body: JSON.stringify({ key }),
      }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['skills', projectId] }),
  })
}

export function useAssignSkillsToAgent(projectId: string, agentId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (skillIds: string[]) =>
      apiFetch<Envelope<{ assigned: string[]; skipped: string[] }>>(
        `/api/projects/${projectId}/agents/${agentId}/skills`,
        { method: 'POST', body: JSON.stringify({ skillIds }) },
      ).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['skills', projectId, 'agent', agentId] }),
  })
}

export function useUnassignSkillFromAgent(projectId: string, agentId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (skillId: string) =>
      apiFetch<Envelope<unknown>>(
        `/api/projects/${projectId}/agents/${agentId}/skills/${skillId}`,
        { method: 'DELETE' },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['skills', projectId, 'agent', agentId] }),
  })
}
