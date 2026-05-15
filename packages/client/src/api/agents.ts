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

type Envelope<T> = { ok: boolean; data: T }
const unwrap = <T>(r: Envelope<T>): T => r.data

export function useAgents(projectId: string) {
  return useQuery<Agent[]>({
    queryKey: ['agents', projectId],
    queryFn: () => apiFetch<Envelope<Agent[]>>(`/api/projects/${projectId}/agents`).then(unwrap),
    enabled: Boolean(projectId),
  })
}

export function useAgent(projectId: string, agentId: string) {
  return useQuery<AgentWithHistory>({
    queryKey: ['agents', projectId, agentId],
    queryFn: () => apiFetch<Envelope<AgentWithHistory>>(`/api/projects/${projectId}/agents/${agentId}`).then(unwrap),
    enabled: Boolean(projectId) && Boolean(agentId),
  })
}

export function useCreateAgent(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation<Agent, Error, CreateAgentInput>({
    mutationFn: (input) =>
      apiFetch<Envelope<Agent>>(`/api/projects/${projectId}/agents`, {
        method: 'POST',
        body: JSON.stringify(input),
      }).then(unwrap),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['agents', projectId] })
    },
  })
}

export function useUpdateAgent(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation<Agent, Error, { agentId: string } & UpdateAgentInput>({
    mutationFn: ({ agentId, ...input }) =>
      apiFetch<Envelope<Agent>>(`/api/projects/${projectId}/agents/${agentId}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }).then(unwrap),
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
    queryFn: () => apiFetch<Envelope<{ content: string }>>(`/api/projects/${projectId}/agents/${agentId}/charter`).then(unwrap),
    enabled: Boolean(projectId) && Boolean(agentId),
  })
}

export function useUpdateCharter(projectId: string, agentId: string) {
  const queryClient = useQueryClient()
  return useMutation<Agent, Error, string>({
    mutationFn: (content) =>
      apiFetch<Envelope<Agent>>(`/api/projects/${projectId}/agents/${agentId}/charter`, {
        method: 'PATCH',
        body: JSON.stringify({ content }),
      }).then(unwrap),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['agents', projectId, agentId, 'charter'] })
      void queryClient.invalidateQueries({ queryKey: ['agents', projectId, agentId] })
    },
  })
}

export interface ModelInfo {
  id: string
  label: string
  vendor: 'anthropic' | 'openai' | 'google' | 'other'
  tier: 'fast' | 'balanced' | 'powerful'
  multiplier?: number
  contextWindow?: number
  supportsVision?: boolean
  supportsReasoningEffort?: boolean
  policyState?: 'enabled' | 'disabled' | 'unconfigured'
}

export function useModels() {
  return useQuery<ModelInfo[]>({
    queryKey: ['models'],
    queryFn: () => apiFetch<Envelope<ModelInfo[]>>('/api/models').then(unwrap),
    staleTime: 5 * 60 * 1000,
  })
}

// ---------------------------------------------------------------------------
// Hire-team / casting types and hooks
//
// Mirrors the SDK casting surface (universes + roles) so the HireTeamModal
// can request a proposed cast and then confirm/materialise selected members
// into Squadboard agents.
// ---------------------------------------------------------------------------

export type CastingUniverseId = 'usual-suspects' | 'oceans-eleven' | 'the-office' | 'seinfeld' | 'the-simpsons' | 'parks-and-rec'

export type CastingAgentRole =
  | 'lead'
  | 'developer'
  | 'tester'
  | 'reviewer'
  | 'devops'
  | 'security'
  | 'designer'
  | 'prompt-engineer'
  | 'scribe'

export interface CastedMember {
  name: string
  agentName: string
  role: CastingAgentRole
  personality: string
  backstory: string
  suggestedRoleId: string
  suggestedRoleTitle: string
}

export interface HireTeamProposeInput {
  universe: CastingUniverseId
  teamSize?: number
  requiredRoles?: CastingAgentRole[]
}

export interface HireTeamProposeResult {
  members: CastedMember[]
}

export interface HireTeamConfirmInput {
  members: CastedMember[]
}

export interface HireTeamConfirmResult {
  created: Agent[]
  errors: { agentName: string; error: string }[]
}

export function useHireTeamPropose(projectId: string) {
  return useMutation<HireTeamProposeResult, Error, HireTeamProposeInput>({
    mutationFn: (input) =>
      apiFetch<Envelope<HireTeamProposeResult>>(
        `/api/projects/${projectId}/agents/hire-team/propose`,
        { method: 'POST', body: JSON.stringify(input) },
      ).then(unwrap),
  })
}

export function useHireTeamConfirm(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation<HireTeamConfirmResult, Error, HireTeamConfirmInput>({
    mutationFn: (input) =>
      apiFetch<Envelope<HireTeamConfirmResult>>(
        `/api/projects/${projectId}/agents/hire-team/confirm`,
        { method: 'POST', body: JSON.stringify(input) },
      ).then(unwrap),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['agents', projectId] })
    },
  })
}

// ---------------------------------------------------------------------------
// Formulate (AI-author a hire-agent draft / hire-team config from prose)
// ---------------------------------------------------------------------------

export interface FormulateModelInfo {
  model: string
  via: 'session' | 'agent' | 'project' | 'fallback'
}

export interface FormulatedAgentDraft {
  name: string
  role: string
  expertise: string[]
  model: string
}

export interface FormulateAgentResult {
  agent: FormulatedAgentDraft
  modelUsed: FormulateModelInfo
}

export function useFormulateAgent(projectId: string) {
  return useMutation<FormulateAgentResult, Error, string>({
    mutationFn: (draft) =>
      apiFetch<Envelope<FormulateAgentResult>>(
        `/api/projects/${projectId}/agents/formulate`,
        { method: 'POST', body: JSON.stringify({ draft }) },
      ).then(unwrap),
  })
}

export interface FormulatedTeamDraft {
  universe: CastingUniverseId
  teamSize: number
  requiredRoles: CastingAgentRole[]
  rationale: string
}

export interface FormulateTeamResult {
  team: FormulatedTeamDraft
  modelUsed: FormulateModelInfo
}

export function useFormulateTeam(projectId: string) {
  return useMutation<FormulateTeamResult, Error, string>({
    mutationFn: (draft) =>
      apiFetch<Envelope<FormulateTeamResult>>(
        `/api/projects/${projectId}/agents/team/formulate`,
        { method: 'POST', body: JSON.stringify({ draft }) },
      ).then(unwrap),
  })
}
