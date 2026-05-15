/**
 * api/mcp.ts — Phase 13 client hooks for the MCP server registry.
 *
 * GET responses NEVER expose plaintext header values — they carry
 * { name, hasSecret } only. Header values can only be set on
 * create / update by sending [{name, value}] entries.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from './client.ts'

export type McpTransport = 'http' | 'stdio'

export interface ScrubbedHeader {
  name: string
  hasSecret: boolean
}

export interface HeaderInput {
  name: string
  value: string
}

export interface McpServer {
  id: string
  projectId: string
  name: string
  description: string | null
  transport: McpTransport
  url: string | null
  command: string | null
  args: string[]
  headers: ScrubbedHeader[]
  enabled: boolean
  /** Provenance — Wave 10 D3. */
  source: 'curated' | 'imported' | 'custom' | 'project'
  sourceUri: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateMcpServerInput {
  name: string
  description?: string | null
  transport: McpTransport
  url?: string | null
  command?: string | null
  args?: string[]
  headers?: HeaderInput[]
  enabled?: boolean
}

export interface UpdateMcpServerInput {
  name?: string
  description?: string | null
  transport?: McpTransport
  url?: string | null
  command?: string | null
  args?: string[]
  headers?: HeaderInput[]
  enabled?: boolean
}

export interface McpTestResult {
  ok: boolean
  status?: number
  latencyMs: number
  error?: string
}

type Envelope<T> = { ok: boolean; data: T }
const unwrap = <T>(r: Envelope<T>): T => r.data

export function useMcpServers(projectId: string) {
  return useQuery<McpServer[]>({
    queryKey: ['mcp-servers', projectId],
    queryFn: () => apiFetch<Envelope<McpServer[]>>(`/api/projects/${projectId}/mcp-servers`).then(unwrap),
    enabled: Boolean(projectId),
  })
}

export function useAgentMcpServers(projectId: string, agentId: string) {
  return useQuery<McpServer[]>({
    queryKey: ['mcp-servers', projectId, 'agent', agentId],
    queryFn: () =>
      apiFetch<Envelope<McpServer[]>>(`/api/projects/${projectId}/agents/${agentId}/mcp-servers`).then(unwrap),
    enabled: Boolean(projectId) && Boolean(agentId),
  })
}

export function useCreateMcpServer(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateMcpServerInput) =>
      apiFetch<Envelope<McpServer>>(`/api/projects/${projectId}/mcp-servers`, {
        method: 'POST',
        body: JSON.stringify(input),
      }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mcp-servers', projectId] }),
  })
}

export function useUpdateMcpServer(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateMcpServerInput & { id: string }) =>
      apiFetch<Envelope<McpServer>>(`/api/projects/${projectId}/mcp-servers/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mcp-servers', projectId] }),
  })
}

export function useDeleteMcpServer(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<Envelope<unknown>>(`/api/projects/${projectId}/mcp-servers/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mcp-servers', projectId] }),
  })
}

export function useTestMcpServer(projectId: string) {
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<Envelope<McpTestResult>>(`/api/projects/${projectId}/mcp-servers/${id}/test`, {
        method: 'POST',
      }).then(unwrap),
  })
}

export function useAssignMcpServersToAgent(projectId: string, agentId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (mcpServerIds: string[]) =>
      apiFetch<Envelope<{ assigned: string[]; skipped: string[] }>>(
        `/api/projects/${projectId}/agents/${agentId}/mcp-servers`,
        { method: 'POST', body: JSON.stringify({ mcpServerIds }) },
      ).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mcp-servers', projectId, 'agent', agentId] }),
  })
}

export function useUnassignMcpServerFromAgent(projectId: string, agentId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (mcpServerId: string) =>
      apiFetch<Envelope<unknown>>(
        `/api/projects/${projectId}/agents/${agentId}/mcp-servers/${mcpServerId}`,
        { method: 'DELETE' },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mcp-servers', projectId, 'agent', agentId] }),
  })
}

export interface ImportMcpResult {
  imported: Array<{ id: string; name: string; transport: McpTransport }>
  skipped: Array<{ name: string; reason: string }>
}

/**
 * Wave 10 D3 — import an MCP server config JSON document.
 *
 * Accepts the standard Claude/VS Code/Continue MCP shape:
 *   { "mcpServers": { "github": { "command": "npx", "args": [...], "env": {...} } } }
 * Or a single server object: { "name": "remote", "url": "https://…", "headers": {...} }
 * Idempotent — duplicate names are skipped.
 */
export function useImportMcpServersFromJson(projectId: string) {
  const qc = useQueryClient()
  return useMutation<
    ImportMcpResult,
    Error,
    { content: string; filename?: string; sourceUri?: string }
  >({
    mutationFn: ({ content, filename, sourceUri }) =>
      apiFetch<Envelope<ImportMcpResult>>(`/api/projects/${projectId}/mcp-servers/import-from-json`, {
        method: 'POST',
        body: JSON.stringify({ content, filename, sourceUri }),
      }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mcp-servers', projectId] }),
  })
}
