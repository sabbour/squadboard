/**
 * McpServers page — Phase 13 project-scoped MCP server registry.
 *
 * Header values are write-only: the form sends them on create/update; GET
 * responses only carry { name, hasSecret } so we can render a list of
 * configured headers without ever exposing the cipher. Updating a server
 * with `headers` overwrites the stored array — the UI surfaces this with
 * a warning banner so users don't accidentally clobber existing secrets.
 */

import { useState } from 'react'
import { useParams } from 'react-router'
import {
  Badge,
  Body1,
  Body1Strong,
  Button,
  Caption1,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Input,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Textarea,
  tokens,
} from '@fluentui/react-components'
import { useProject } from '../api/projects.ts'
import {
  useCreateMcpServer,
  useDeleteMcpServer,
  useMcpServers,
  useTestMcpServer,
  useUpdateMcpServer,
  type HeaderInput,
  type McpServer,
  type McpTransport,
} from '../api/mcp.ts'
import PageHeader from '../components/layout/PageHeader.tsx'

interface FormState {
  name: string
  description: string
  transport: McpTransport
  url: string
  command: string
  args: string  // newline-separated
  headers: HeaderInput[]
  enabled: boolean
}

const EMPTY_FORM: FormState = {
  name: '', description: '', transport: 'http', url: '', command: '', args: '', headers: [], enabled: true,
}

export default function McpServers() {
  const { id } = useParams<{ id: string }>()
  const projectId = id ?? ''
  const { data: project } = useProject(projectId)
  const { data: servers = [], isLoading } = useMcpServers(projectId)
  const deleteServer = useDeleteMcpServer(projectId)
  const testServer = useTestMcpServer(projectId)
  const [showCreate, setShowCreate] = useState(false)
  const [editing, setEditing] = useState<McpServer | null>(null)
  const [testing, setTesting] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, string>>({})

  function confirmDelete(s: McpServer) {
    if (!window.confirm(`Delete MCP server "${s.name}"? It will be unassigned from any agents.`)) return
    deleteServer.mutate(s.id)
  }

  function runTest(s: McpServer) {
    setTesting(s.id)
    setResults((r) => ({ ...r, [s.id]: 'Testing…' }))
    testServer.mutate(s.id, {
      onSuccess: (data) => setResults((r) => ({
        ...r,
        [s.id]: data.ok
          ? `OK${data.status ? ` (${data.status})` : ''} — ${data.latencyMs}ms`
          : `Failed: ${data.error ?? 'unknown'}`,
      })),
      onError: (e) => setResults((r) => ({ ...r, [s.id]: `Error: ${(e as Error).message}` })),
      onSettled: () => setTesting(null),
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <PageHeader
        eyebrow={project?.name}
        title="MCP Servers"
        description="Model Context Protocol gateways. Header values are AES-256-GCM encrypted at rest with a per-project key."
        actions={<Button appearance="primary" onClick={() => setShowCreate(true)}>New MCP server</Button>}
      />

      <div style={{ flex: 1, overflow: 'auto', padding: '24px', maxWidth: '1100px', width: '100%', margin: '0 auto' }}>
        {isLoading && <Body1 style={{ color: tokens.colorNeutralForeground3 }}>Loading…</Body1>}
        {!isLoading && servers.length === 0 && (
          <div style={{ textAlign: 'center', padding: '48px 16px', color: 'var(--text-muted)' }}>
            <Body1 style={{ display: 'block', marginBottom: tokens.spacingVerticalM }}>No MCP servers configured.</Body1>
            <Button appearance="primary" onClick={() => setShowCreate(true)}>Add a server</Button>
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {servers.map((s) => (
            <McpRow
              key={s.id}
              server={s}
              testing={testing === s.id}
              result={results[s.id]}
              onEdit={() => setEditing(s)}
              onDelete={() => confirmDelete(s)}
              onTest={() => runTest(s)}
            />
          ))}
        </div>
      </div>

      {showCreate && <McpFormDialog projectId={projectId} onClose={() => setShowCreate(false)} />}
      {editing && <McpFormDialog projectId={projectId} server={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function McpRow({ server, testing, result, onEdit, onDelete, onTest }: {
  server: McpServer
  testing: boolean
  result?: string
  onEdit: () => void
  onDelete: () => void
  onTest: () => void
}) {
  return (
    <div style={{
      border: '1px solid var(--border)', borderRadius: '6px', padding: '14px 16px',
      background: 'var(--surface)', display: 'flex', gap: '16px', alignItems: 'flex-start',
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
          <Body1Strong style={{ color: tokens.colorNeutralForeground1 }}>{server.name}</Body1Strong>
          <Badge appearance="outline" color={server.enabled ? 'success' : 'subtle'}>
            {server.enabled ? 'enabled' : 'disabled'}
          </Badge>
          <Badge appearance="outline">{server.transport}</Badge>
        </div>
        {server.description && (
          <Caption1 style={{ display: 'block', color: tokens.colorNeutralForeground3, margin: '0 0 6px' }}>{server.description}</Caption1>
        )}
        <Caption1 style={{ display: 'block', color: tokens.colorNeutralForeground3, fontFamily: tokens.fontFamilyMonospace, marginTop: '4px' }}>
          {server.transport === 'http' ? server.url : `${server.command ?? ''} ${server.args.join(' ')}`}
        </Caption1>
        {server.headers.length > 0 && (
          <div style={{ marginTop: '8px', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {server.headers.map((h) => (
              <span key={h.name} style={{
                fontSize: '11px', padding: '2px 8px', borderRadius: '10px',
                background: tokens.colorNeutralBackground3, color: 'var(--text-muted)',
                border: '1px solid var(--border)', fontFamily: 'ui-monospace,monospace',
              }}>
                {h.name}: {h.hasSecret ? '🔒 ***' : '∅'}
              </span>
            ))}
          </div>
        )}
        {result && (
          <p style={{ fontSize: '12px', marginTop: '8px', color: result.startsWith('OK') ? '#3fb950' : '#f85149' }}>
            {result}
          </p>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <Button appearance="subtle" size="small" onClick={onTest} disabled={testing}>
          {testing ? 'Testing…' : 'Test'}
        </Button>
        <Button appearance="subtle" size="small" onClick={onEdit}>Edit</Button>
        <Button appearance="subtle" size="small" onClick={onDelete}>Delete</Button>
      </div>
    </div>
  )
}

function McpFormDialog({ projectId, server, onClose }: { projectId: string; server?: McpServer; onClose: () => void }) {
  const [form, setForm] = useState<FormState>(
    server
      ? {
          name: server.name,
          description: server.description ?? '',
          transport: server.transport,
          url: server.url ?? '',
          command: server.command ?? '',
          args: server.args.join('\n'),
          // Editing: prefill known header NAMES with empty values — values
          // are write-only, so we cannot recover them. User has to re-enter
          // any secret they want to keep. The warning banner explains this.
          headers: server.headers.map((h) => ({ name: h.name, value: '' })),
          enabled: server.enabled,
        }
      : EMPTY_FORM,
  )
  const create = useCreateMcpServer(projectId)
  const update = useUpdateMcpServer(projectId)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const payload = {
      name: form.name,
      description: form.description || null,
      transport: form.transport,
      url: form.transport === 'http' ? form.url : null,
      command: form.transport === 'stdio' ? form.command : null,
      args: form.args.split(/\r?\n/).map((s) => s.trim()).filter(Boolean),
      headers: form.headers.filter((h) => h.name.trim()),
      enabled: form.enabled,
    }
    if (server) {
      update.mutate({ id: server.id, ...payload }, { onSuccess: onClose })
    } else {
      create.mutate(payload, { onSuccess: onClose })
    }
  }

  function addHeader() {
    setForm({ ...form, headers: [...form.headers, { name: '', value: '' }] })
  }
  function removeHeader(idx: number) {
    setForm({ ...form, headers: form.headers.filter((_, i) => i !== idx) })
  }
  function setHeader(idx: number, patch: Partial<HeaderInput>) {
    setForm({ ...form, headers: form.headers.map((h, i) => i === idx ? { ...h, ...patch } : h) })
  }

  return (
    <Dialog open onOpenChange={(_, d) => { if (!d.open) onClose() }}>
      <DialogSurface style={{ maxWidth: '640px', width: '100%' }}>
        <DialogBody>
          <DialogTitle>{server ? 'Edit MCP server' : 'New MCP server'}</DialogTitle>
          <DialogContent>
            <form id="mcp-form" onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px', paddingTop: '8px' }}>
              <Field label="Name">
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. GitHub MCP" />
              </Field>
              <Field label="Description (optional)">
                <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Short summary" />
              </Field>
              <Field label="Transport">
                <div style={{ display: 'flex', gap: '12px' }}>
                  <label style={{ fontSize: '13px' }}>
                    <input
                      type="radio"
                      checked={form.transport === 'http'}
                      onChange={() => setForm({ ...form, transport: 'http' })}
                    /> HTTP
                  </label>
                  <label style={{ fontSize: '13px' }}>
                    <input
                      type="radio"
                      checked={form.transport === 'stdio'}
                      onChange={() => setForm({ ...form, transport: 'stdio' })}
                    /> stdio
                  </label>
                </div>
              </Field>
              {form.transport === 'http' ? (
                <Field label="URL">
                  <Input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://api.example.com/mcp/" />
                </Field>
              ) : (
                <>
                  <Field label="Command">
                    <Input value={form.command} onChange={(e) => setForm({ ...form, command: e.target.value })} placeholder="e.g. npx" />
                  </Field>
                  <Field label="Args (one per line)">
                    <Textarea value={form.args} onChange={(_, d) => setForm({ ...form, args: d.value })} rows={3} />
                  </Field>
                </>
              )}

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <strong style={{ fontSize: '13px' }}>Headers</strong>
                  <Button size="small" appearance="subtle" onClick={addHeader} type="button">+ Add header</Button>
                </div>
                {server && (
                  <MessageBar intent="warning" style={{ marginBottom: '8px' }}>
                    <MessageBarBody>
                      <MessageBarTitle>Header values are write-only</MessageBarTitle>
                      Submitting this form replaces the entire header array.
                      Re-enter any secret you want to keep.
                    </MessageBarBody>
                  </MessageBar>
                )}
                {form.headers.length === 0 && (
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>No headers configured.</p>
                )}
                {form.headers.map((h, i) => (
                  <div key={i} style={{ display: 'flex', gap: '6px', marginBottom: '6px' }}>
                    <Input
                      placeholder="Name (e.g. Authorization)"
                      value={h.name}
                      onChange={(e) => setHeader(i, { name: e.target.value })}
                      style={{ flex: 1 }}
                    />
                    <Input
                      placeholder="Value (encrypted at rest)"
                      type="password"
                      value={h.value}
                      onChange={(e) => setHeader(i, { value: e.target.value })}
                      style={{ flex: 2 }}
                    />
                    <Button size="small" appearance="subtle" type="button" onClick={() => removeHeader(i)}>Remove</Button>
                  </div>
                ))}
              </div>

              <Field label="Enabled">
                <label style={{ fontSize: '13px' }}>
                  <input
                    type="checkbox"
                    checked={form.enabled}
                    onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
                  /> Server available to assigned agents
                </label>
              </Field>
            </form>
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={onClose}>Cancel</Button>
            <Button
              appearance="primary"
              type="submit"
              form="mcp-form"
              disabled={
                !form.name ||
                (form.transport === 'http' && !form.url) ||
                (form.transport === 'stdio' && !form.command) ||
                create.isPending || update.isPending
              }
            >
              {create.isPending || update.isPending ? 'Saving…' : server ? 'Save' : 'Create'}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  )
}
