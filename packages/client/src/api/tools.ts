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
  /** Provenance — Wave 10 D3. */
  source: 'curated' | 'imported' | 'custom' | 'project'
  sourceUri: string | null
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

export interface ImportToolsResult {
  imported: Array<{ id: string; key: string; name: string }>
  skipped: Array<{ key: string; reason: string }>
}

/**
 * Wave 10 D3 — import a tool JSON file (or bundle) as project tool(s).
 * Idempotent — duplicate keys are skipped.
 */
export function useImportToolsFromJson(projectId: string) {
  const qc = useQueryClient()
  return useMutation<
    ImportToolsResult,
    Error,
    { content: string; filename?: string; sourceUri?: string; mcpServerId?: string }
  >({
    mutationFn: ({ content, filename, sourceUri, mcpServerId }) =>
      apiFetch<Envelope<ImportToolsResult>>(`/api/projects/${projectId}/tools/import-from-json`, {
        method: 'POST',
        body: JSON.stringify({ content, filename, sourceUri, mcpServerId }),
      }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tools', projectId] }),
  })
}

// ---------------------------------------------------------------------------
// Formulate (AI-author a tool from a brief description)
// ---------------------------------------------------------------------------

export interface FormulateModelInfo {
  model: string
  via: 'session' | 'agent' | 'project' | 'fallback'
}

export interface FormulatedToolDraft {
  key: string
  name: string
  description: string
  category: string
  inputSchema: unknown
}

export interface FormulateToolResult {
  tool: FormulatedToolDraft
  modelUsed: FormulateModelInfo
}

export function useFormulateTool(projectId: string) {
  return useMutation<FormulateToolResult, Error, string>({
    mutationFn: (draft) =>
      apiFetch<Envelope<FormulateToolResult>>(
        `/api/projects/${projectId}/tools/formulate`,
        { method: 'POST', body: JSON.stringify({ draft }) },
      ).then(unwrap),
  })
}
