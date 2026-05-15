/**
 * Tools page — Phase 13 project-scoped tools registry.
 *
 * Tools represent catalogued external actions (typically MCP-backed). The
 * UI mirrors Skills: list, create/edit, delete. No curated library — tools
 * are project-specific and usually depend on a configured MCP server.
 */

import { useState } from 'react'
import { useParams } from 'react-router'
import {
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
  Dropdown,
  Field,
  Input,
  Option,
  Textarea,
  tokens,
} from '@fluentui/react-components'
import { useProject } from '../api/projects.ts'
import { useMcpServers } from '../api/mcp.ts'
import {
  useCreateTool,
  useDeleteTool,
  useFormulateTool,
  useTools,
  useUpdateTool,
  type FormulateModelInfo,
  type Tool,
} from '../api/tools.ts'
import FormulatePanel from '../components/formulate/FormulatePanel.tsx'
import PageHeader from '../components/layout/PageHeader.tsx'

const KEBAB_RE = /^[a-z_][a-z0-9_]*$/

interface FormState {
  key: string
  name: string
  description: string
  category: string
  mcpServerId: string
}

const EMPTY_FORM: FormState = { key: '', name: '', description: '', category: '', mcpServerId: '' }

export default function Tools() {
  const { id } = useParams<{ id: string }>()
  const projectId = id ?? ''
  const { data: project } = useProject(projectId)
  const { data: tools = [], isLoading } = useTools(projectId)
  const deleteTool = useDeleteTool(projectId)
  const [showCreate, setShowCreate] = useState(false)
  const [editing, setEditing] = useState<Tool | null>(null)

  function confirmDelete(t: Tool) {
    if (!window.confirm(`Delete tool "${t.name}"? It will be unassigned from any agents.`)) return
    deleteTool.mutate(t.id)
  }

  const grouped = tools.reduce<Map<string, Tool[]>>((acc, t) => {
    const key = t.category ?? 'other'
    if (!acc.has(key)) acc.set(key, [])
    acc.get(key)!.push(t)
    return acc
  }, new Map())

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <PageHeader
        eyebrow={project?.name}
        title="Tools"
        description="Catalogued external actions agents can be assigned. Typically backed by an MCP server."
        actions={<Button appearance="primary" onClick={() => setShowCreate(true)}>New tool</Button>}
      />

      <div style={{ flex: 1, overflow: 'auto', padding: '24px', maxWidth: '1100px', width: '100%', margin: '0 auto' }}>
        {isLoading && <Body1 style={{ color: tokens.colorNeutralForeground3 }}>Loading…</Body1>}
        {!isLoading && tools.length === 0 && (
          <div style={{ textAlign: 'center', padding: '48px 16px', color: 'var(--text-muted)' }}>
            <Body1 style={{ display: 'block', marginBottom: tokens.spacingVerticalM }}>No tools yet.</Body1>
            <Button appearance="primary" onClick={() => setShowCreate(true)}>Create the first tool</Button>
          </div>
        )}
        {Array.from(grouped.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([cat, items]) => (
          <section key={cat} style={{ marginBottom: '24px' }}>
            <Caption1 style={{ display: 'block', textTransform: 'uppercase', letterSpacing: '0.05em', color: tokens.colorNeutralForeground3, marginBottom: tokens.spacingVerticalS, fontWeight: tokens.fontWeightSemibold }}>
              {cat}
            </Caption1>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {items.map((t) => <ToolRow key={t.id} tool={t} onEdit={() => setEditing(t)} onDelete={() => confirmDelete(t)} />)}
            </div>
          </section>
        ))}
      </div>

      {showCreate && <ToolFormDialog projectId={projectId} onClose={() => setShowCreate(false)} />}
      {editing && <ToolFormDialog projectId={projectId} tool={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function ToolRow({ tool, onEdit, onDelete }: { tool: Tool; onEdit: () => void; onDelete: () => void }) {
  return (
    <div style={{
      border: '1px solid var(--border)', borderRadius: '6px', padding: '12px 16px',
      background: 'var(--surface)', display: 'flex', gap: '16px', alignItems: 'flex-start',
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
          <Body1Strong style={{ color: tokens.colorNeutralForeground1 }}>{tool.name}</Body1Strong>
          <code style={{ fontSize: '11px', color: tokens.colorNeutralForeground3, fontFamily: tokens.fontFamilyMonospace }}>{tool.key}</code>
        </div>
        <Caption1 style={{ display: 'block', color: tokens.colorNeutralForeground3, margin: '0' }}>{tool.description}</Caption1>
        {tool.mcpServerId && (
          <Caption1 style={{ display: 'block', color: tokens.colorNeutralForeground3, margin: '4px 0 0' }}>
            via MCP server <code style={{ fontFamily: tokens.fontFamilyMonospace }}>{tool.mcpServerId.slice(0, 8)}…</code>
          </Caption1>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <Button appearance="subtle" size="small" onClick={onEdit}>Edit</Button>
        <Button appearance="subtle" size="small" onClick={onDelete}>Delete</Button>
      </div>
    </div>
  )
}

function ToolFormDialog({ projectId, tool, onClose }: { projectId: string; tool?: Tool; onClose: () => void }) {
  const { data: mcpServers = [] } = useMcpServers(projectId)
  const [form, setForm] = useState<FormState>(
    tool
      ? {
          key: tool.key,
          name: tool.name,
          description: tool.description,
          category: tool.category ?? '',
          mcpServerId: tool.mcpServerId ?? '',
        }
      : EMPTY_FORM,
  )
  const [keyError, setKeyError] = useState('')
  const [modelUsed, setModelUsed] = useState<FormulateModelInfo | null>(null)
  const create = useCreateTool(projectId)
  const update = useUpdateTool(projectId)
  const formulate = useFormulateTool(projectId)

  function handleFormulate(draft: string) {
    formulate.mutate(draft, {
      onSuccess: ({ tool: drafted, modelUsed: info }) => {
        setForm({
          key: drafted.key,
          name: drafted.name,
          description: drafted.description,
          category: drafted.category,
          mcpServerId: form.mcpServerId,
        })
        setKeyError('')
        setModelUsed(info)
      },
    })
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!KEBAB_RE.test(form.key)) {
      setKeyError('Must start with letter or underscore; only lowercase letters, digits, underscores')
      return
    }
    const payload = {
      ...form,
      category: form.category || null,
      mcpServerId: form.mcpServerId || null,
    }
    if (tool) {
      update.mutate({ id: tool.id, ...payload }, { onSuccess: onClose })
    } else {
      create.mutate(payload, { onSuccess: onClose })
    }
  }

  return (
    <Dialog open onOpenChange={(_, d) => { if (!d.open) onClose() }}>
      <DialogSurface style={{ maxWidth: '560px', width: '100%' }}>
        <DialogBody>
          <DialogTitle>{tool ? 'Edit tool' : 'New tool'}</DialogTitle>
          <DialogContent>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', paddingTop: '8px' }}>
              {!tool && (
                <FormulatePanel
                  placeholder="e.g. a tool that searches our internal docs and returns the top 3 matching pages with summaries"
                  hint="Sketch a tool in plain language; AI fills the form for you to review."
                  isPending={formulate.isPending}
                  errorMessage={formulate.error?.message ?? null}
                  modelUsed={modelUsed}
                  onFormulate={handleFormulate}
                />
              )}
              <form id="tool-form" onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <Field label="Key (snake_case or kebab-case)" validationMessage={keyError || undefined} validationState={keyError ? 'error' : 'none'}>
                  <Input
                    value={form.key}
                    disabled={!!tool}
                    onChange={(e) => { setForm({ ...form, key: e.target.value }); setKeyError('') }}
                    placeholder="e.g. web_search"
                  />
                </Field>
                <Field label="Name">
                  <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Web Search" />
                </Field>
                <Field label="Description">
                  <Textarea
                    value={form.description}
                    onChange={(_, d) => setForm({ ...form, description: d.value })}
                    rows={3}
                    placeholder="What this tool does — agent-facing summary."
                  />
                </Field>
                <Field label="Category (optional)">
                  <Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="e.g. research" />
                </Field>
                <Field label="Backing MCP server (optional)">
                  <Dropdown
                    value={form.mcpServerId ? mcpServers.find((s) => s.id === form.mcpServerId)?.name ?? '' : 'None'}
                    selectedOptions={form.mcpServerId ? [form.mcpServerId] : ['']}
                    onOptionSelect={(_, d) => setForm({ ...form, mcpServerId: (d.optionValue as string) ?? '' })}
                  >
                    <Option value="">None</Option>
                    {mcpServers.map((s) => (
                      <Option key={s.id} value={s.id}>{s.name}</Option>
                    ))}
                  </Dropdown>
                </Field>
              </form>
            </div>
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={onClose}>Cancel</Button>
            <Button
              appearance="primary"
              type="submit"
              form="tool-form"
              disabled={!form.key || !form.name || !form.description || create.isPending || update.isPending}
            >
              {create.isPending || update.isPending ? 'Saving…' : tool ? 'Save' : 'Create'}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  )
}
