/**
 * Tools page — Phase 13 project-scoped tools registry.
 *
 * Tools represent catalogued external actions (typically MCP-backed). The
 * UI mirrors Skills: list, create/edit, delete. No curated library — tools
 * are project-specific and usually depend on a configured MCP server.
 */

import { useRef, useState } from 'react'
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
import { Add20Regular, ArrowUpload20Regular, WrenchRegular } from '@fluentui/react-icons'
import { useProject } from '../api/projects.ts'
import { useMcpServers } from '../api/mcp.ts'
import {
  useCreateTool,
  useDeleteTool,
  useFormulateTool,
  useImportToolsFromJson,
  useTools,
  useUpdateTool,
  type FormulateModelInfo,
  type Tool,
} from '../api/tools.ts'
import FormulatePanel from '../components/formulate/FormulatePanel.tsx'
import PageHeader from '../components/layout/PageHeader.tsx'
import EmptyState from '../components/layout/EmptyState.tsx'

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
  const importJson = useImportToolsFromJson(projectId)
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const [importMessage, setImportMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [editing, setEditing] = useState<Tool | null>(null)

  function confirmDelete(t: Tool) {
    if (!window.confirm(`Delete tool "${t.name}"? It will be unassigned from any agents.`)) return
    deleteTool.mutate(t.id)
  }

  async function handleImportFile(file: File) {
    setImportMessage(null)
    try {
      const text = await file.text()
      const result = await importJson.mutateAsync({ content: text, filename: file.name })
      const parts: string[] = []
      if (result.imported.length) parts.push(`Imported ${result.imported.length} tool(s): ${result.imported.map((t) => t.key).join(', ')}.`)
      if (result.skipped.length) parts.push(`Skipped ${result.skipped.length}: ${result.skipped.map((s) => `${s.key} (${s.reason})`).join(', ')}.`)
      setImportMessage({ kind: result.imported.length > 0 ? 'ok' : 'error', text: parts.join(' ') || 'Nothing imported.' })
    } catch (err) {
      setImportMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Import failed' })
    }
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
        actions={
          <>
            <input
              ref={importInputRef}
              type="file"
              accept=".json,application/json"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) handleImportFile(f)
                e.target.value = ''
              }}
            />
            <Button
              appearance="secondary"
              icon={<ArrowUpload20Regular />}
              onClick={() => importInputRef.current?.click()}
              disabled={importJson.isPending}
            >
              {importJson.isPending ? 'Importing…' : 'Import .json'}
            </Button>
            <Button appearance="primary" icon={<Add20Regular />} onClick={() => setShowCreate(true)}>New tool</Button>
          </>
        }
      />

      <div style={{ flex: 1, overflow: 'auto', padding: '24px', maxWidth: '1100px', width: '100%', margin: '0 auto' }}>
        {importMessage && (
          <div
            style={{
              padding: '8px 12px',
              borderRadius: '6px',
              marginBottom: '12px',
              fontSize: '13px',
              background: importMessage.kind === 'ok' ? tokens.colorPaletteGreenBackground2 : tokens.colorPaletteRedBackground2,
              color: importMessage.kind === 'ok' ? tokens.colorPaletteGreenForeground2 : tokens.colorPaletteRedForeground2,
              border: `1px solid ${importMessage.kind === 'ok' ? tokens.colorPaletteGreenBorderActive : tokens.colorPaletteRedBorderActive}`,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <span>{importMessage.text}</span>
            <Button size="small" appearance="subtle" onClick={() => setImportMessage(null)}>Dismiss</Button>
          </div>
        )}
        {isLoading && <Body1 style={{ color: tokens.colorNeutralForeground3 }}>Loading…</Body1>}
        {!isLoading && tools.length === 0 && (
          /* Wave 10 C5: Ceremonies-style empty state. Stream D's import-json
             flow remains the secondary action. */
          <EmptyState
            icon={<WrenchRegular />}
            title="No tools yet"
            description="Tools represent catalogued external actions an agent can call — typically backed by an MCP server. Author one inline or import a tool.json from another project."
            actions={
              <>
                <Button
                  appearance="secondary"
                  icon={<ArrowUpload20Regular />}
                  onClick={() => importInputRef.current?.click()}
                  disabled={importJson.isPending}
                >
                  {importJson.isPending ? 'Importing…' : 'Import .json'}
                </Button>
                <Button appearance="primary" icon={<Add20Regular />} onClick={() => setShowCreate(true)}>
                  New tool
                </Button>
              </>
            }
          />
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

function ToolSourceBadge({ source }: { source: Tool['source'] }) {
  const meta = (() => {
    switch (source) {
      case 'curated':
        return { label: 'Built-in catalog', bg: tokens.colorBrandBackground2, fg: tokens.colorBrandForeground1 }
      case 'imported':
        return { label: 'Imported', bg: tokens.colorPaletteGreenBackground2, fg: tokens.colorPaletteGreenForeground2 }
      case 'project':
        return { label: 'Project', bg: tokens.colorNeutralBackground3, fg: tokens.colorNeutralForeground2 }
      case 'custom':
      default:
        return { label: 'Custom', bg: tokens.colorNeutralBackground3, fg: tokens.colorNeutralForeground2 }
    }
  })()
  return (
    <span
      style={{
        fontSize: '10px',
        padding: '1px 6px',
        borderRadius: '8px',
        background: meta.bg,
        color: meta.fg,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        fontWeight: 600,
      }}
      title={`Tool provenance: ${meta.label.toLowerCase()}`}
    >
      {meta.label}
    </span>
  )
}

function ToolRow({ tool, onEdit, onDelete }: { tool: Tool; onEdit: () => void; onDelete: () => void }) {
  return (
    <div style={{
      border: '1px solid var(--border)', borderRadius: '6px', padding: '12px 16px',
      background: 'var(--surface)', display: 'flex', gap: '16px', alignItems: 'flex-start',
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
          <Body1Strong style={{ color: tokens.colorNeutralForeground1 }}>{tool.name}</Body1Strong>
          <code style={{ fontSize: '11px', color: tokens.colorNeutralForeground3, fontFamily: tokens.fontFamilyMonospace }}>{tool.key}</code>
          <ToolSourceBadge source={tool.source} />
        </div>
        <Caption1 style={{ display: 'block', color: tokens.colorNeutralForeground3, margin: '0' }}>{tool.description}</Caption1>
        {tool.mcpServerId && (
          <Caption1 style={{ display: 'block', color: tokens.colorNeutralForeground3, margin: '4px 0 0' }}>
            via MCP server <code style={{ fontFamily: tokens.fontFamilyMonospace }}>{tool.mcpServerId.slice(0, 8)}…</code>
          </Caption1>
        )}
        {tool.sourceUri && (
          <Caption1 style={{ display: 'block', color: tokens.colorNeutralForeground3, margin: '4px 0 0', fontFamily: tokens.fontFamilyMonospace, fontSize: '11px' }}>
            ↳ {tool.sourceUri}
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
