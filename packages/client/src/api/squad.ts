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

// Frontend contract for the cross-surface sync status panel. The backend route
// is intentionally not consumed by visible UI until Hockney lands it.
export type SquadSyncAuthority = 'filesystem' | 'squad_storage' | 'mcp_broker' | 'unknown'
export type SquadSyncStorageMode = 'filesystem' | 'postgresql' | 'unknown'
export type SquadSyncDatabaseRuntime = 'pglite' | 'postgresql' | 'none' | 'unknown'
export type SquadSyncCheckStatus = 'ok' | 'missing' | 'partial' | 'drifted' | 'unknown'
export type SquadSyncDriftStatus = 'none' | 'detected' | 'unknown'
export type SquadSyncRepairAction =
  | 'project_governance'
  | 'ceremony_defaults'
  | 'agent_files'
  | 'rescan_drift'

export interface SquadSyncFileCheck {
  path: string
  label: string
  status: SquadSyncCheckStatus
  present: boolean | null
  required: boolean
  repairAction?: SquadSyncRepairAction
  message?: string
}

export interface SquadSyncStatus {
  projectId: string
  squadPath: string
  checkedAt: string
  sourceOfTruth: SquadSyncAuthority
  storageMode: SquadSyncStorageMode
  databaseRuntime: SquadSyncDatabaseRuntime
  summary: {
    status: SquadSyncCheckStatus
    message: string
  }
  governance: {
    status: SquadSyncCheckStatus
    files: SquadSyncFileCheck[]
    projectionRoot?: string | null
  }
  ceremonies: {
    status: SquadSyncCheckStatus
    defaultsPresent: boolean | null
    defaultsMissing: string[]
    count: number | null
    filePath?: string | null
  }
  drift: {
    status: SquadSyncDriftStatus
    surfaces: string[]
    message?: string
  }
  repair: {
    available: boolean
    actions: SquadSyncRepairAction[]
    endpoint?: string | null
    disabledReason?: string | null
  }
}

export interface RepairSquadSyncInput {
  actions?: SquadSyncRepairAction[]
  dryRun?: boolean
}

export interface RepairSquadSyncResult {
  status: SquadSyncStatus
  repaired: SquadSyncRepairAction[]
  skipped: Array<{ action: SquadSyncRepairAction; reason: string }>
}

interface ApiEnvelope<T> {
  ok: boolean
  data: T
  error?: string
}

function unwrapEnvelope<T>(response: ApiEnvelope<T>): T {
  if (!response.ok) throw new Error(response.error ?? 'Server returned ok: false')
  return response.data
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

export function useSquadSyncStatus(projectId: string) {
  return useQuery<SquadSyncStatus>({
    queryKey: ['projects', projectId, 'squad-sync', 'status'],
    queryFn: () =>
      apiFetch<ApiEnvelope<SquadSyncStatus>>(`/api/projects/${projectId}/squad-sync/status`)
        .then(unwrapEnvelope),
    enabled: Boolean(projectId),
    retry: (failureCount, error) => {
      if (error instanceof Error && error.message.startsWith('API 404')) return false
      return failureCount < 2
    },
  })
}

export function useRepairSquadSync(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation<RepairSquadSyncResult, Error, RepairSquadSyncInput>({
    mutationFn: (input) =>
      apiFetch<ApiEnvelope<RepairSquadSyncResult>>(`/api/projects/${projectId}/squad-sync/repair`, {
        method: 'POST',
        body: JSON.stringify(input),
      }).then(unwrapEnvelope),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'squad-sync', 'status'] })
    },
  })
}
