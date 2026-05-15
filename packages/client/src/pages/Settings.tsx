import { useState, useRef } from 'react'
import { useParams } from 'react-router'
import { useProject, useUpdateProject } from '../api/projects.ts'
import { useModels } from '../api/agents.ts'
import { useBudget } from '../api/costs.ts'
import { apiFetch } from '../api/client.ts'
import {
  useExportProject,
  useImportProject,
  useSaveProjectAsTemplate,
  readFileAsJson,
} from '../api/templates.ts'
import { McpConfigPanel } from '../components/settings/McpConfigPanel.tsx'
import { ReviewPolicySection } from '../components/settings/ReviewPolicySection.tsx'
import PageHeader from '../components/layout/PageHeader.tsx'
import {
  Dropdown,
  Option,
  Field,
  Spinner,
  Subtitle2,
  Caption1,
  Body1,
  tokens,
  Dialog,
  DialogSurface,
  DialogBody,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Input,
  Textarea,
} from '@fluentui/react-components'
import {
  TextDescription20Regular,
  PlugConnected20Regular,
  Money20Regular,
  Settings20Regular,
  Shield20Regular,
  FolderArrowRight20Regular,
} from '@fluentui/react-icons'

type Section = 'general' | 'mcp' | 'budget' | 'reviews' | 'portability'

const SECTIONS: { id: Section; label: string; icon: React.ReactNode }[] = [
  { id: 'general', label: 'General', icon: <TextDescription20Regular /> },
  { id: 'mcp', label: 'MCP Config', icon: <PlugConnected20Regular /> },
  { id: 'budget', label: 'Budget', icon: <Money20Regular /> },
  { id: 'reviews', label: 'Review policy', icon: <Shield20Regular /> },
  { id: 'portability', label: 'Portability', icon: <FolderArrowRight20Regular /> },
]

function SectionHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <div style={{ marginBottom: tokens.spacingVerticalL }}>
      <Subtitle2 as="h2" style={{ display: 'block', color: tokens.colorNeutralForeground1 }}>{title}</Subtitle2>
      {sub && (
        <Caption1 style={{ display: 'block', color: tokens.colorNeutralForeground3, marginTop: tokens.spacingVerticalXXS }}>
          {sub}
        </Caption1>
      )}
    </div>
  )
}

function BudgetSection({ projectId }: { projectId: string }) {
  const { data: budget, isLoading, refetch } = useBudget(projectId)
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    const usd = parseFloat(value)
    if (isNaN(usd) || usd < 0) {
      setError('Enter a valid positive number.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await apiFetch(`/api/projects/${projectId}/costs/budget`, {
        method: 'PUT',
        body: JSON.stringify({ monthlyBudgetUsd: usd }),
      })
      setSaved(true)
      void refetch()
      setTimeout(() => setSaved(false), 2500)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  if (isLoading) {
    return <Caption1 style={{ display: 'block', color: tokens.colorNeutralForeground3 }}>Loading budget…</Caption1>
  }

  const mtd = budget?.mtdSpend ?? 0
  const budgetAmt = budget?.monthlyBudgetUsd ?? null
  const pct = budget?.percentUsed ?? 0
  const overBudget = pct >= 100

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Current spend */}
      <div
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: '8px',
          padding: '14px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '8px',
        }}
      >
        <div>
          <div style={{ fontSize: '22px', fontWeight: tokens.fontWeightBold, color: overBudget ? '#f85149' : tokens.colorNeutralForeground1, fontFamily: tokens.fontFamilyMonospace }}>
            ${mtd.toFixed(2)}
          </div>
          <Caption1 style={{ display: 'block', color: tokens.colorNeutralForeground3, marginTop: tokens.spacingVerticalXXS }}>Month-to-date spend</Caption1>
        </div>
        {budgetAmt != null && (
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '14px', color: overBudget ? '#f85149' : '#3fb950', fontWeight: tokens.fontWeightSemibold }}>
              {pct.toFixed(1)}% of ${budgetAmt.toFixed(2)}
            </div>
            {/* Mini progress bar */}
            <div style={{ width: '120px', height: '6px', borderRadius: '3px', background: 'var(--border)', marginTop: '6px', border: '1px solid var(--border)', overflow: 'hidden' }}>
              <div
                style={{
                  width: `${Math.min(pct, 100)}%`,
                  height: '100%',
                  background: overBudget ? '#f85149' : pct > 80 ? '#d29922' : '#3fb950',
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Budget input */}
      <div>
        <label>
          <Caption1 style={{ display: 'block', color: tokens.colorNeutralForeground3, marginBottom: tokens.spacingVerticalSNudge }}>
            Monthly budget (USD)
          </Caption1>
        </label>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: tokens.colorNeutralForeground3, fontSize: '13px' }}>$</span>
            <input
              type="number"
              min="0"
              step="1"
              placeholder={budgetAmt != null ? String(budgetAmt) : '100'}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                color: 'var(--text)',
                padding: '6px 10px 6px 24px',
                fontSize: '13px',
                outline: 'none',
                width: '140px',
              }}
            />
          </div>
          <button
            onClick={handleSave}
            disabled={saving || !value}
            style={{
              background: saved ? 'rgba(63,185,80,0.12)' : saving ? 'rgba(0,0,0,0.05)' : '#238636',
              border: `1px solid ${saved ? 'rgba(63,185,80,0.4)' : '#2ea043'}`,
              color: saved ? '#3fb950' : 'white',
              borderRadius: '6px',
              padding: '6px 16px',
              fontSize: '13px',
              fontWeight: 500,
              cursor: saving || !value ? 'not-allowed' : 'pointer',
              opacity: !value ? 0.6 : 1,
              transition: 'all 0.15s',
            }}
          >
            {saved ? '✓ Saved' : saving ? 'Saving…' : 'Save'}
          </button>
        </div>
        {error && (
          <p style={{ fontSize: '11px', color: '#f85149', margin: '6px 0 0' }}>{error}</p>
        )}
        <Caption1 style={{ display: 'block', color: tokens.colorNeutralForeground3, margin: '6px 0 0' }}>
          Set to 0 to disable budget alerts.
        </Caption1>
      </div>
    </div>
  )
}

function DefaultModelSection({
  projectId,
  current,
}: {
  projectId: string
  current: string | null
}) {
  const { data: models, isLoading } = useModels()
  const update = useUpdateProject(projectId)
  const [pending, setPending] = useState<string | null>(current)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const value = pending ?? '__auto__'

  async function handleChange(next: string | null) {
    setPending(next)
    setError(null)
    try {
      await update.mutateAsync({ defaultModel: next })
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed')
    }
  }

  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: '8px',
        padding: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        maxWidth: '480px',
        marginTop: '12px',
      }}
    >
      <label>
        <Caption1
          style={{
            display: 'block',
            color: tokens.colorNeutralForeground3,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            fontWeight: tokens.fontWeightSemibold,
          }}
        >
          Default model
        </Caption1>
      </label>
      <Caption1 style={{ display: 'block', color: tokens.colorNeutralForeground3, margin: 0 }}>
        Used when an agent's model is "auto" and the request doesn't specify one.
        Resolution chain: <em>session → agent → project → built-in fallback</em>.
      </Caption1>
      {isLoading ? (
        <Spinner size="tiny" label="Loading models…" />
      ) : (
        <Field>
          <Dropdown
            value={value === '__auto__' ? 'Auto (use built-in fallback)' : value}
            selectedOptions={[value]}
            onOptionSelect={(_, data) => {
              const next = data.optionValue === '__auto__' ? null : data.optionValue ?? null
              void handleChange(next)
            }}
          >
            <Option value="__auto__">Auto (use built-in fallback)</Option>
            {(models ?? []).map((m) => (
              <Option key={m.id} value={m.id} text={m.label}>
                {m.label}
              </Option>
            ))}
          </Dropdown>
        </Field>
      )}
      {saved && (
        <p style={{ fontSize: '11px', color: '#3fb950', margin: 0 }}>✓ Saved</p>
      )}
      {error && (
        <p style={{ fontSize: '11px', color: '#f85149', margin: 0 }}>{error}</p>
      )}
    </div>
  )
}

function SaveProjectAsTemplateDialog({
  open,
  onSave,
  onClose,
  isPending,
  error,
}: {
  open: boolean
  onSave: (name: string, description: string) => void
  onClose: () => void
  isPending: boolean
  error: string | null
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  return (
    <Dialog open={open} onOpenChange={(_, d) => { if (!d.open) onClose() }}>
      <DialogSurface style={{ maxWidth: 440 }}>
        <DialogBody>
          <DialogTitle>Save project as template</DialogTitle>
          <DialogContent style={{ display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalM }}>
            <Field label="Template name" required>
              <Input
                value={name}
                onChange={(_, d) => setName(d.value)}
                placeholder="e.g., Standard SaaS project"
                autoFocus
              />
            </Field>
            <Field label="Description">
              <Textarea
                value={description}
                onChange={(_, d) => setDescription(d.value)}
                placeholder="What does this project template include?"
                rows={3}
              />
            </Field>
            {error && (
              <Caption1 style={{ color: tokens.colorPaletteRedForeground1 }}>{error}</Caption1>
            )}
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={onClose}>Cancel</Button>
            <Button
              appearance="primary"
              disabled={!name.trim() || isPending}
              onClick={() => onSave(name.trim(), description.trim())}
            >
              {isPending ? 'Saving…' : 'Save template'}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  )
}

function PortabilitySection({ projectId, projectName }: { projectId: string; projectName: string }) {
  const exportProject = useExportProject()
  const importProject = useImportProject()
  const saveAsTemplate = useSaveProjectAsTemplate(projectId)
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveDone, setSaveDone] = useState(false)
  const [importFeedback, setImportFeedback] = useState<string | null>(null)
  const importFileRef = useRef<HTMLInputElement>(null)

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setImportFeedback(null)
    try {
      const payload = await readFileAsJson(file)
      const result = await importProject.mutateAsync({ payload })
      setImportFeedback(`Project "${result.project.name}" imported successfully.`)
    } catch (err) {
      setImportFeedback(err instanceof Error ? err.message : 'Import failed')
    }
    e.target.value = ''
  }

  async function handleSaveTemplate(name: string, description: string) {
    setSaveError(null)
    try {
      await saveAsTemplate.mutateAsync({ name, description: description || undefined })
      setShowSaveDialog(false)
      setSaveDone(true)
      setTimeout(() => setSaveDone(false), 3000)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed')
    }
  }

  const rowStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 16px',
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: '8px',
    gap: '16px',
  }

  const btnStyle: React.CSSProperties = {
    background: 'var(--bg)',
    border: '1px solid var(--border)',
    borderRadius: '6px',
    color: 'var(--text)',
    padding: '6px 14px',
    fontSize: '13px',
    fontWeight: 500,
    cursor: 'pointer',
    flexShrink: 0,
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: 560 }}>
      {/* Export */}
      <div style={rowStyle}>
        <div>
          <Body1 style={{ display: 'block', fontWeight: tokens.fontWeightSemibold }}>Export project</Body1>
          <Caption1 style={{ display: 'block', color: tokens.colorNeutralForeground3 }}>
            Download this project as a portable JSON file.
          </Caption1>
        </div>
        <button
          style={{ ...btnStyle, opacity: exportProject.isPending ? 0.6 : 1, cursor: exportProject.isPending ? 'not-allowed' : 'pointer' }}
          disabled={exportProject.isPending}
          onClick={() => exportProject.mutate({ projectId, filename: `project-${projectName}.json` })}
        >
          {exportProject.isPending ? 'Exporting…' : '↓ Export'}
        </button>
      </div>

      {/* Import */}
      <div style={rowStyle}>
        <div>
          <Body1 style={{ display: 'block', fontWeight: tokens.fontWeightSemibold }}>Import project</Body1>
          <Caption1 style={{ display: 'block', color: tokens.colorNeutralForeground3 }}>
            Import a project from an exported JSON file.
          </Caption1>
        </div>
        <button
          style={{ ...btnStyle, opacity: importProject.isPending ? 0.6 : 1, cursor: importProject.isPending ? 'not-allowed' : 'pointer' }}
          disabled={importProject.isPending}
          onClick={() => importFileRef.current?.click()}
        >
          {importProject.isPending ? 'Importing…' : '↑ Import'}
        </button>
        <input
          ref={importFileRef}
          type="file"
          accept=".json,application/json"
          style={{ display: 'none' }}
          onChange={(e) => void handleImportFile(e)}
        />
      </div>

      {/* Save as template */}
      <div style={rowStyle}>
        <div>
          <Body1 style={{ display: 'block', fontWeight: tokens.fontWeightSemibold }}>Save as template</Body1>
          <Caption1 style={{ display: 'block', color: tokens.colorNeutralForeground3 }}>
            Save this project structure as a reusable template.
          </Caption1>
        </div>
        <button
          style={btnStyle}
          onClick={() => { setSaveError(null); setShowSaveDialog(true) }}
        >
          {saveDone ? '✓ Saved' : '☆ Save as template'}
        </button>
      </div>

      {importFeedback && (
        <Caption1
          style={{
            display: 'block',
            color: importFeedback.toLowerCase().includes('fail') || importFeedback.toLowerCase().includes('error')
              ? tokens.colorPaletteRedForeground1 : tokens.colorPaletteGreenForeground1,
          }}
        >
          {importFeedback}
        </Caption1>
      )}

      <SaveProjectAsTemplateDialog
        open={showSaveDialog}
        onSave={(name, desc) => void handleSaveTemplate(name, desc)}
        onClose={() => setShowSaveDialog(false)}
        isPending={saveAsTemplate.isPending}
        error={saveError}
      />
    </div>
  )
}

export default function Settings() {
  const { id: projectId = '' } = useParams<{ id: string }>()
  const { data: project, isLoading, isError } = useProject(projectId)
  const [activeSection, setActiveSection] = useState<Section>('general')

  if (isLoading) {
    return (
      <div style={{ padding: '32px' }}>
        <Body1 style={{ color: tokens.colorNeutralForeground3 }}>Loading…</Body1>
      </div>
    )
  }

  if (isError || !project) {
    return <div style={{ padding: '32px', color: 'var(--danger)' }}>Failed to load project.</div>
  }

  const navItemStyle = (active: boolean): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '7px 12px',
    borderRadius: '6px',
    cursor: 'pointer',
    background: active ? 'rgba(56,139,253,0.1)' : 'transparent',
    color: active ? 'var(--text)' : 'var(--text-muted)',
    fontWeight: active ? tokens.fontWeightMedium : tokens.fontWeightRegular,
    fontSize: '13px',
    border: 'none',
    width: '100%',
    textAlign: 'left',
    transition: 'background 0.1s',
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <PageHeader
        eyebrow={project.name}
        icon={<Settings20Regular />}
        title="Settings"
        description="Project configuration · MCP servers · budget · review policy."
      />

      {/* Body: sidebar + content */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
        {/* Settings nav */}
        <aside
          style={{
            width: '180px',
            flexShrink: 0,
            borderRight: '1px solid var(--border)',
            padding: '12px 8px',
            display: 'flex',
            flexDirection: 'column',
            gap: '2px',
          }}
        >
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setActiveSection(s.id)}
              style={navItemStyle(activeSection === s.id)}
            >
              <span>{s.icon}</span>
              {s.label}
            </button>
          ))}
        </aside>

        {/* Section content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
          {activeSection === 'general' && (
            <>
              <SectionHeader title="General" sub="Basic project settings." />
              <div
                style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  padding: '14px 16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                  maxWidth: '480px',
                }}
              >
                <label>
                  <Caption1 style={{ display: 'block', color: tokens.colorNeutralForeground3, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: tokens.fontWeightSemibold }}>
                    Project name
                  </Caption1>
                </label>
                <Subtitle2 style={{ display: 'block', color: tokens.colorNeutralForeground1, margin: 0 }}>{project.name}</Subtitle2>
                <Caption1 style={{ display: 'block', color: tokens.colorNeutralForeground3, margin: '4px 0 0' }}>
                  Squad path: <code style={{ fontFamily: tokens.fontFamilyMonospace, color: tokens.colorNeutralForeground3 }}>{project.squadPath}</code>
                </Caption1>
              </div>
              <DefaultModelSection projectId={projectId} current={project.defaultModel ?? null} />
            </>
          )}

          {activeSection === 'mcp' && (
            <>
              <SectionHeader
                title="MCP Config"
                sub="Connect VS Code (GitHub Copilot) to your board via MCP."
              />
              <McpConfigPanel projectId={projectId} />
            </>
          )}

          {activeSection === 'budget' && (
            <>
              <SectionHeader
                title="Budget"
                sub="Set a monthly LLM spend cap and track month-to-date usage."
              />
              <BudgetSection projectId={projectId} />
            </>
          )}

          {activeSection === 'reviews' && (
            <>
              <SectionHeader
                title="Review policy"
                sub="Default rules for approve steps in this project's workflows. Each workflow can still override per step."
              />
              <ReviewPolicySection projectId={projectId} />
            </>
          )}

          {activeSection === 'portability' && (
            <>
              <SectionHeader
                title="Portability"
                sub="Export, import, and template this project for reuse across environments."
              />
              <PortabilitySection projectId={projectId} projectName={project.name} />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
