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

// Frontend contract for the cross-surface sync status panel.
export const SQUAD_SYNC_API_NAMESPACE = 'squad-sync' as const
export type SquadSyncAuthority = 'filesystem' | 'squad_storage' | 'mcp_broker' | 'unknown'
export type SquadSyncStorageMode = 'filesystem' | 'postgresql' | 'unknown'
export type SquadSyncDatabaseRuntime = 'pglite' | 'postgresql' | 'none' | 'unknown'
export type SquadSyncCheckStatus = 'ok' | 'missing' | 'partial' | 'drifted' | 'unknown'
export type SquadSyncDriftStatus = 'none' | 'detected' | 'unknown'
export type SquadSyncArtifactStatus = 'present' | 'missing' | 'unknown'
export type SquadSyncArtifactRequirement = 'required' | 'recommended' | 'optional'
export type SquadSyncSurface = 'squad-sdk' | 'squadboard' | 'filesystem' | 'copilot-cli' | 'mcp' | string
export type SquadSyncRepairAction =
  | 'project_governance'
  | 'ceremony_defaults'
  | 'agent_files'
  | 'rescan_drift'
  | 'repair-scaffold-squad'
  | 'project-copilot-agent-file'
  | 'generate-github-agent'
  | 'generate-client-artifact'
  | 'seed-ceremony-defaults'
  | 'project-squad-to-fs'
  | 'rescan-drift'
  | 'expose-sync-status-api'
  | 'write-mcp-config'
  | 'onboard-to-squadboard'

export interface SquadSyncFileCheck {
  path: string
  label: string
  status: SquadSyncCheckStatus
  present: boolean | null
  required: boolean
  requirement?: SquadSyncArtifactRequirement
  repairAction?: SquadSyncRepairAction
  message?: string
}

export interface SquadSyncStorageContract {
  rawProvider?: string | null
  mode?: Exclude<SquadSyncStorageMode, 'unknown'>
  authority?: Exclude<SquadSyncAuthority, 'unknown' | 'mcp_broker'>
  importBehavior?: string
  mirrorBehavior?: string
  sharedExternalAccess?: string
  squadStorage?: SquadSyncStorageMetadata | null
}

export interface SquadSyncRuntimeStatus {
  kind: 'filesystem' | 'local-pglite' | 'hosted-postgresql' | string
  note: string
}

export interface SquadSyncAuthorityStatus {
  storageMode: Exclude<SquadSyncStorageMode, 'unknown'>
  sourceOfTruth: Exclude<SquadSyncAuthority, 'unknown'>
  rawProvider?: string | null
  importBehavior?: string
  mirrorBehavior?: string
  sharedExternalAccess?: string
  continuousSync?: boolean
  runtime?: SquadSyncRuntimeStatus
}

export interface SquadSyncStorageMetadata {
  available: boolean
  rowCount: number | null
  lastUpdatedAt: string | null
  error?: {
    code: string
    message: string
  }
}

export interface SquadSyncProjectionArtifact {
  id: string
  path: string
  status: SquadSyncArtifactStatus
  requirement: SquadSyncArtifactRequirement
  owner: SquadSyncSurface
  purpose?: string
}

export interface SquadSyncSurfaceContract {
  surface: SquadSyncSurface
  owns: string[]
  doesNotOwn: string[]
}

export interface SquadSyncOwnershipRepairAction {
  id: SquadSyncRepairAction
  owner?: string
  reason: string
  severity?: 'critical' | 'warning' | 'info' | string
  mode?: 'automatic' | 'user-confirmed' | 'manual' | string
  artifactIds?: string[]
  surfaces?: string[]
  legacyIds?: string[]
}

export interface SquadSyncAvailableRepairAction {
  id: SquadSyncRepairAction
  aliases?: SquadSyncRepairAction[]
  owner?: string
  reason: string
  available?: boolean
  required?: boolean
  destructive?: boolean
  endpoint?: string
}

export type SquadSyncRepairActionDescriptor =
  | SquadSyncRepairAction
  | SquadSyncAvailableRepairAction

export interface SquadSyncDriftIssue {
  code: string
  severity: 'info' | 'warning' | 'error' | string
  artifactId?: string
  message: string
}

export interface SquadSyncStatus {
  projectId?: string
  squadPath?: string | null
  checkedAt?: string
  sourceOfTruth?: SquadSyncAuthority
  storageMode?: SquadSyncStorageMode
  databaseRuntime?: SquadSyncDatabaseRuntime
  summary?: {
    status: SquadSyncCheckStatus
    message: string
  }
  governance?: {
    status: SquadSyncCheckStatus
    files: SquadSyncFileCheck[]
    projectionRoot?: string | null
  }
  ceremonies?: {
    status: SquadSyncCheckStatus
    defaultsPresent: boolean | null
    defaultsMissing: string[]
    count: number | null
    filePath?: string | null
  }
  drift?: {
    status?: SquadSyncDriftStatus
    surfaces?: string[]
    message?: string
    detected?: boolean
    level?: 'ready' | 'warning' | 'error' | string
    summary?: string
    issues?: SquadSyncDriftIssue[]
    continuousSync?: boolean
  }
  repair?: {
    available?: boolean
    dryRunSupported?: boolean
    actions: SquadSyncRepairActionDescriptor[]
    endpoint?: string | null
    disabledReason?: string | null
  }
  contractVersion?: string
  clientArtifactContractVersion?: string
  authority?: SquadSyncAuthorityStatus
  storage?: SquadSyncStorageContract
  bootstrap?: {
    status: 'ready' | 'partial' | 'missing' | 'unknown'
    missingRequired: string[]
    missingRecommended: string[]
  }
  projection?: {
    projectRoot: string | null
    squadPath: string | null
    artifacts: SquadSyncProjectionArtifact[]
    requiredArtifacts?: string[]
    recommendedArtifacts?: string[]
    optionalArtifacts?: string[]
    missing?: {
      required?: string[]
      recommended?: string[]
      optional?: string[]
    }
  }
  clients?: Record<string, {
    client: string
    status: 'ready' | 'degraded' | 'blocked' | string
    authority: SquadSyncAuthority
    writeTarget: string
    blockers: string[]
    warnings: string[]
    message: string
  }>
  surfaces?: SquadSyncSurfaceContract[]
  repairActions?: SquadSyncOwnershipRepairAction[]
}

export interface RepairSquadSyncInput {
  actions?: SquadSyncRepairAction[]
  dryRun?: boolean
}

export interface RepairSquadSyncResult {
  projectId?: string
  dryRun?: boolean
  results?: Array<{
    action: SquadSyncRepairAction
    status: 'applied' | 'dry-run' | 'skipped' | 'failed' | string
    reason: string
    changes?: Array<{
      path: string
      operation: string
      status: string
      reason?: string
      message?: string
    }>
  }>
  status?: SquadSyncStatus
  statusAfter?: SquadSyncStatus
  repaired?: SquadSyncRepairAction[]
  skipped?: Array<{ action: SquadSyncRepairAction; reason: string }>
}

interface ApiEnvelope<T> {
  ok: boolean
  data: T
  error?: string | { message?: string }
}

function unwrapEnvelope<T>(response: ApiEnvelope<T>): T {
  if (!response.ok) {
    const message = typeof response.error === 'string' ? response.error : response.error?.message
    throw new Error(message ?? 'Server returned ok: false')
  }
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
    queryKey: ['projects', projectId, SQUAD_SYNC_API_NAMESPACE, 'status'],
    queryFn: () =>
      apiFetch<ApiEnvelope<SquadSyncStatus>>(`/api/projects/${projectId}/${SQUAD_SYNC_API_NAMESPACE}/status`)
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
      apiFetch<ApiEnvelope<RepairSquadSyncResult>>(`/api/projects/${projectId}/${SQUAD_SYNC_API_NAMESPACE}/repair`, {
        method: 'POST',
        body: JSON.stringify(input),
      }).then(unwrapEnvelope),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projects', projectId, SQUAD_SYNC_API_NAMESPACE, 'status'] })
    },
  })
}
