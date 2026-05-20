import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from './client.ts'

export interface Project {
  id: string
  name: string
  squadPath: string
  defaultModel: string | null
  // Stream D — D6: which cost model the Costs page renders. null falls back
  // to env SQUADBOARD_COST_MODEL (server-side default).
  costModel?: 'usd' | 'gh_multipliers' | null
  createdAt: string
}

interface RawProject extends Omit<Project, 'squadPath'> {
  path?: string
  squadPath?: string
}

function normalizeProject(project: RawProject): Project {
  return {
    ...project,
    squadPath: project.squadPath ?? project.path ?? '',
  }
}

export interface CreateProjectInput {
  name: string
  squadPath: string
}

export interface UpdateProjectInput {
  defaultModel?: string | null
  costModel?: 'usd' | 'gh_multipliers' | null
}

export function useProjects() {
  return useQuery<Project[]>({
    queryKey: ['projects'],
    queryFn: () => apiFetch<RawProject[]>('/api/projects').then((rows) => rows.map(normalizeProject)),
  })
}

export function useProject(id: string) {
  return useQuery<Project>({
    queryKey: ['projects', id],
    queryFn: () => apiFetch<RawProject>(`/api/projects/${id}`).then(normalizeProject),
    enabled: Boolean(id),
  })
}

export function useUpdateProject(id: string) {
  const queryClient = useQueryClient()
  return useMutation<Project, Error, UpdateProjectInput>({
    mutationFn: (input) =>
      apiFetch<RawProject>(`/api/projects/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }).then(normalizeProject),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projects', id] })
      void queryClient.invalidateQueries({ queryKey: ['projects'] })
    },
  })
}

export function useCreateProject() {
  const queryClient = useQueryClient()
  return useMutation<Project, Error, CreateProjectInput>({
    mutationFn: (input) =>
      apiFetch<RawProject>('/api/projects', {
        method: 'POST',
        body: JSON.stringify({ name: input.name, path: input.squadPath }),
      }).then(normalizeProject),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projects'] })
    },
  })
}

export interface DeleteProjectInput {
  id: string
  /** When true, instructs the backend to also remove the project folder on disk. Defaults to false. */
  deleteFolder?: boolean
}

export interface DeleteProjectResult {
  ok: true
  deleted: {
    metadata: true
    folder: string | false
    folderError?: string
  }
}

export function useDeleteProject() {
  const queryClient = useQueryClient()
  return useMutation<DeleteProjectResult, Error, DeleteProjectInput>({
    mutationFn: ({ id, deleteFolder }: DeleteProjectInput) =>
      apiFetch<DeleteProjectResult>(`/api/projects/${id}`, {
        method: 'DELETE',
        ...(deleteFolder ? { body: JSON.stringify({ deleteFolder: true }) } : {}),
      }),
    onSuccess: (_, vars) => {
      void queryClient.invalidateQueries({ queryKey: ['projects'] })
      queryClient.removeQueries({ queryKey: ['projects', vars.id] })
    },
  })
}

// ---------------------------------------------------------------------------
// O1 — Wave 20: project setup suggestion
// ---------------------------------------------------------------------------

export interface ProjectSuggestionTeamMember {
  name: string
  role: string
  kind?: 'project-agent' | 'human' | 'virtual-copilot'
  badge?: string
}

export interface ProjectSuggestionCeremony {
  name: string
  cadence: string
}

export interface ProjectSuggestionColumn {
  slug: string
  label: string
}

export interface ProjectSuggestion {
  bundleId: string
  bundleName: string
  description: string
  team: ProjectSuggestionTeamMember[]
  ceremonies: ProjectSuggestionCeremony[]
  columns: ProjectSuggestionColumn[]
  skills: string[]
  matchedKeywords: string[]
  source?: 'llm' | 'deterministic' | 'deterministic-fallback'
  rationale?: string | null
}

export function useSuggestProjectSetup() {
  return useMutation<ProjectSuggestion, Error, { description: string }>({
    mutationFn: (input) =>
      apiFetch<ProjectSuggestion>('/api/projects/suggest', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
  })
}
