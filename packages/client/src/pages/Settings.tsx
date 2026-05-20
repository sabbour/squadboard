import { useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router'
import { useProject, useUpdateProject, useDeleteProject } from '../api/projects.ts'
import type { Project } from '../api/projects.ts'
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
import { SquadSyncStatusPanel } from '../components/settings/SquadSyncStatusPanel.tsx'
import { ReviewPolicySection } from '../components/settings/ReviewPolicySection.tsx'
import { SystemBackupSection } from '../components/settings/SystemBackupSection.tsx'
import { SystemGitHubSection } from '../components/settings/SystemGitHubSection.tsx'
import { GitHubActivityFeed } from '../components/GitHubActivityFeed.tsx'
import PageHeader from '../components/layout/PageHeader.tsx'
import { useUserPrefs } from '../utils/userPrefs.ts'
import { useUnsavedChangesWarning } from '../hooks/useUnsavedChangesWarning.ts'
import {
  Dropdown,
  Option,
  Field,
  Subtitle2,
  Caption1,
  Body1,
  Switch,
  Checkbox,
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
  BookmarkAdd20Regular,
  BookmarkAddFilled,
  ArrowDownload20Regular,
  ArrowUpload20Regular,
  DatabaseArrowRight20Regular,
  Branch20Regular,
  Eye20Regular,
  Checkmark20Regular,
  ArrowSync20Regular,
  Delete20Regular,
} from '@fluentui/react-icons'
import { PageLoading, SectionLoading } from '../components/loading/index.tsx'

type Section = 'general' | 'display' | 'mcp' | 'sync' | 'budget' | 'reviews' | 'portability' | 'backup' | 'github' | 'danger'

const SECTIONS: { id: Section; label: string; icon: React.ReactNode }[] = [
  { id: 'general', label: 'General', icon: <TextDescription20Regular /> },
  { id: 'display', label: 'Display', icon: <Eye20Regular /> },
  { id: 'mcp', label: 'MCP Config', icon: <PlugConnected20Regular /> },
  { id: 'sync', label: 'Team Sync', icon: <ArrowSync20Regular /> },
  { id: 'budget', label: 'Budget', icon: <Money20Regular /> },
  { id: 'reviews', label: 'Review policy', icon: <Shield20Regular /> },
  { id: 'portability', label: 'Portability', icon: <FolderArrowRight20Regular /> },
  { id: 'backup', label: 'Backup & Restore', icon: <DatabaseArrowRight20Regular /> },
  { id: 'github', label: 'GitHub', icon: <Branch20Regular /> },
  { id: 'danger', label: 'Danger Zone', icon: <Delete20Regular /> },
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

function DisplaySection() {
  const { prefs, setPref } = useUserPrefs()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalM, maxWidth: 480 }}>
      <div
        style={{
          background: 'var(--surface)',
          border: `1px solid ${tokens.colorNeutralStroke1}`,
          borderRadius: '8px',
          padding: '14px 16px',
        }}
      >
        <Switch
          checked={prefs.routeProgressBar}
          onChange={(_, data) => setPref('routeProgressBar', data.checked)}
          label={
            <div>
              <Body1 style={{ display: 'block', fontWeight: tokens.fontWeightSemibold }}>
                Route progress bar
              </Body1>
              <Caption1 style={{ display: 'block', color: tokens.colorNeutralForeground3 }}>
                Show a thin progress bar at the top of the page during navigation. (Ctrl+K → Conjure)
              </Caption1>
            </div>
          }
        />
      </div>
    </div>
  )
}

function BudgetSection({ projectId }: { projectId: string }) {
  const { data: budget, isLoading, refetch } = useBudget(projectId)
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useUnsavedChangesWarning(Boolean(value.trim()))

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
      setValue('')
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
            {saved ? <><Checkmark20Regular style={{ verticalAlign: 'middle', marginRight: '4px' }} />Saved</> : saving ? 'Saving…' : 'Save'}
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
        <SectionLoading label="Loading models…" size="tiny" />
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
        <p style={{ fontSize: '11px', color: '#3fb950', margin: 0 }}>
          <Checkmark20Regular style={{ verticalAlign: 'middle', marginRight: '4px' }} />Saved
        </p>
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
  const [showImportDialog, setShowImportDialog] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveDone, setSaveDone] = useState(false)
  // Stream D — D7: surface the on-disk template mirror path so the user knows
  // where the JSON copy was written (useful for git-tracking and sharing).
  const [savedStoragePath, setSavedStoragePath] = useState<string | null>(null)
  const [importFeedback, setImportFeedback] = useState<string | null>(null)
  // Import dialog state
  const [importSquadPath, setImportSquadPath] = useState('')
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const importFileRef = useRef<HTMLInputElement>(null)

  async function handleImport() {
    if (!importFile || !importSquadPath.trim()) return
    setImportError(null)
    try {
      const payload = await readFileAsJson(importFile)
      const result = await importProject.mutateAsync({ payload, squadPath: importSquadPath.trim() })
      setImportFeedback(`Project "${result.name}" imported successfully.`)
      setShowImportDialog(false)
      setImportFile(null)
      setImportSquadPath('')
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import failed')
    }
  }

  async function handleSaveTemplate(name: string, description: string) {
    setSaveError(null)
    setSavedStoragePath(null)
    try {
      const result = await saveAsTemplate.mutateAsync({ name, description: description || undefined })
      setShowSaveDialog(false)
      setSaveDone(true)
      setSavedStoragePath(result.storagePath)
      setTimeout(() => {
        setSaveDone(false)
        setSavedStoragePath(null)
      }, 6000)
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
        <Button
          appearance="secondary"
          icon={<ArrowDownload20Regular />}
          disabled={exportProject.isPending}
          onClick={() => exportProject.mutate({ projectId, filename: `project-${projectName}.json` })}
        >
          {exportProject.isPending ? 'Exporting…' : 'Export'}
        </Button>
      </div>

      {/* Import */}
      <div style={rowStyle}>
        <div>
          <Body1 style={{ display: 'block', fontWeight: tokens.fontWeightSemibold }}>Import project</Body1>
          <Caption1 style={{ display: 'block', color: tokens.colorNeutralForeground3 }}>
            Import a project from an exported JSON file.
          </Caption1>
        </div>
        <Button
          appearance="secondary"
          icon={<ArrowUpload20Regular />}
          onClick={() => { setImportError(null); setShowImportDialog(true) }}
        >
          Import
        </Button>
      </div>

      {/* Save as template — Wave 10 C7: Fluent2 Button + BookmarkAdd icon */}
      <div style={rowStyle}>
        <div>
          <Body1 style={{ display: 'block', fontWeight: tokens.fontWeightSemibold }}>Save as template</Body1>
          <Caption1 style={{ display: 'block', color: tokens.colorNeutralForeground3 }}>
            Save this project structure as a reusable template.
          </Caption1>
        </div>
        <Button
          appearance="secondary"
          icon={saveDone ? <BookmarkAddFilled /> : <BookmarkAdd20Regular />}
          onClick={() => { setSaveError(null); setShowSaveDialog(true) }}
        >
          {saveDone ? 'Saved' : 'Save as template'}
        </Button>
      </div>

      {/* Stream D — D7: tell the user where the JSON copy landed on disk */}
      {savedStoragePath && (
        <Caption1
          style={{
            display: 'block',
            color: tokens.colorNeutralForeground3,
            fontFamily: 'var(--font-mono, monospace)',
            wordBreak: 'break-all',
          }}
        >
          Saved to: {savedStoragePath}
        </Caption1>
      )}

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

      {/* Import project dialog — collects squadPath + JSON file */}
      {showImportDialog && (
        <Dialog open onOpenChange={(_, d) => { if (!d.open) setShowImportDialog(false) }}>
          <DialogSurface style={{ maxWidth: 480 }}>
            <DialogBody>
              <DialogTitle>Import project</DialogTitle>
              <DialogContent style={{ display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalM }}>
                <Field
                  label="Squad directory path"
                  required
                  hint="Absolute path on disk where the new project's .squad/ folder will live."
                >
                  <Input
                    value={importSquadPath}
                    onChange={(_, d) => setImportSquadPath(d.value)}
                    placeholder="/home/you/projects/my-new-app/.squad"
                    autoFocus
                  />
                </Field>
                <Field label="Project JSON file" required>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <Button
                      appearance="outline"
                      size="small"
                      onClick={() => importFileRef.current?.click()}
                    >
                      {importFile ? importFile.name : 'Choose file…'}
                    </Button>
                    {importFile && (
                      <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>
                        {(importFile.size / 1024).toFixed(1)} KB
                      </Caption1>
                    )}
                    <input
                      ref={importFileRef}
                      type="file"
                      accept=".json,application/json"
                      style={{ display: 'none' }}
                      onChange={(e) => { setImportFile(e.target.files?.[0] ?? null); e.target.value = '' }}
                    />
                  </div>
                </Field>
                {importError && (
                  <Caption1 style={{ color: tokens.colorPaletteRedForeground1 }}>{importError}</Caption1>
                )}
              </DialogContent>
              <DialogActions>
                <Button appearance="secondary" onClick={() => setShowImportDialog(false)}>Cancel</Button>
                <Button
                  appearance="primary"
                  disabled={!importFile || !importSquadPath.trim() || importProject.isPending}
                  onClick={() => void handleImport()}
                >
                  {importProject.isPending ? 'Importing…' : 'Import'}
                </Button>
              </DialogActions>
            </DialogBody>
          </DialogSurface>
        </Dialog>
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

/**
 * Strips HTML tags and collapses whitespace from an error message so that a
 * backend 500 HTML page (or any other raw markup) never reaches the modal UI.
 * Structured JSON error messages from apiFetch are already clean, so this is
 * purely a safety-net for unexpected responses.
 */
function sanitizeApiError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e)
  // If there are no angle brackets the message is already plain text.
  if (!raw.includes('<')) return raw
  const stripped = raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  return stripped || 'Delete failed — an unexpected error occurred.'
}

function DangerZoneSection({ project }: { project: Project }) {
  const [deleteFolder, setDeleteFolder] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { mutate: deleteProject, isPending } = useDeleteProject()
  const navigate = useNavigate()
  const squadPath = project.squadPath
  const projectFolderPath = displayProjectFolderPath(squadPath)

  function handleConfirm() {
    setError(null)
    deleteProject(
      { id: project.id, deleteFolder: deleteFolder || undefined },
      {
        onSuccess: (result) => {
          if (result.deleted.folderError) {
            window.alert(
              `Project metadata was removed, but Squadboard could not delete the folder on disk: ${result.deleted.folderError}`,
            )
          }
          navigate('/')
        },
        onError: (e) => {
          console.error('[DangerZone] delete project error:', e)
          setError(sanitizeApiError(e))
        },
      },
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: 560 }}>
      <div
        style={{
          border: `1px solid ${tokens.colorPaletteRedBorderActive}`,
          borderRadius: '8px',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            background: tokens.colorPaletteRedBackground2,
            borderBottom: `1px solid ${tokens.colorPaletteRedBorderActive}`,
            padding: '10px 16px',
          }}
        >
          <Body1 style={{ fontWeight: tokens.fontWeightSemibold, color: tokens.colorPaletteRedForeground1 }}>
            Danger Zone
          </Body1>
        </div>

        <div
          style={{
            padding: '16px',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: '16px',
            borderBottom: `1px solid var(--border)`,
          }}
        >
          <div>
            <Body1 style={{ display: 'block', fontWeight: tokens.fontWeightSemibold }}>
              Remove project from Squadboard
            </Body1>
            <Caption1 style={{ display: 'block', color: tokens.colorNeutralForeground3, marginTop: '4px' }}>
              Removes this project's metadata from Squadboard. Your files at{' '}
              <code style={{ fontFamily: tokens.fontFamilyMonospace }}>{squadPath}</code>{' '}
              will <strong>not</strong> be touched.
            </Caption1>
          </div>
          <Button
            appearance="outline"
            style={{
              flexShrink: 0,
              borderColor: tokens.colorPaletteRedBorderActive,
              color: tokens.colorPaletteRedForeground1,
            }}
            onClick={() => { setError(null); setConfirmOpen(true) }}
          >
            Delete project...
          </Button>
        </div>

        <div style={{ padding: '12px 16px' }}>
          <Checkbox
            checked={deleteFolder}
            onChange={(_, data) => setDeleteFolder(Boolean(data.checked))}
            label={
              <div>
                <Body1
                  style={{
                    display: 'block',
                    fontWeight: tokens.fontWeightSemibold,
                    color: tokens.colorPaletteRedForeground1,
                  }}
                >
                  Also permanently delete the folder on disk
                </Body1>
                <Caption1 style={{ display: 'block', color: tokens.colorNeutralForeground3, marginTop: '2px' }}>
                  Warning: irreversible. The entire directory at{' '}
                  <code style={{ fontFamily: tokens.fontFamilyMonospace }}>{projectFolderPath}</code>{' '}
                  and all its contents will be permanently removed from disk. This cannot be undone.
                </Caption1>
              </div>
            }
          />
        </div>
      </div>

      <Dialog open={confirmOpen} onOpenChange={(_, d) => { if (!d.open && !isPending) setConfirmOpen(false) }}>
        <DialogSurface style={{ maxWidth: 480 }}>
          <DialogBody>
            <DialogTitle>
              {deleteFolder ? 'Permanently delete project and folder?' : 'Remove project from Squadboard?'}
            </DialogTitle>
            <DialogContent style={{ display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalM }}>
              {deleteFolder ? (
                <>
                  <Body1>
                    This will remove <strong>{project.name}</strong> from Squadboard and{' '}
                    <strong>permanently delete</strong> the folder at:
                  </Body1>
                  <code
                    style={{
                      display: 'block',
                      fontFamily: tokens.fontFamilyMonospace,
                      color: tokens.colorPaletteRedForeground1,
                      background: tokens.colorPaletteRedBackground2,
                      border: `1px solid ${tokens.colorPaletteRedBorderActive}`,
                      borderRadius: '4px',
                      padding: '6px 10px',
                      wordBreak: 'break-all',
                    }}
                  >
                    {projectFolderPath}
                  </code>
                  <Body1
                    style={{
                      color: tokens.colorPaletteRedForeground1,
                      fontWeight: tokens.fontWeightSemibold,
                    }}
                  >
                    This action is irreversible. All files in that directory will be gone.
                  </Body1>
                </>
              ) : (
                <>
                  <Body1>
                    This will remove <strong>{project.name}</strong> from Squadboard.
                  </Body1>
                  <Body1>
                    Your files at{' '}
                    <code style={{ fontFamily: tokens.fontFamilyMonospace }}>{squadPath}</code>{' '}
                    will not be touched. You can re-add this project later from the project picker using its squad path.
                  </Body1>
                </>
              )}
              {error && (
                <Caption1 style={{ color: tokens.colorPaletteRedForeground1 }}>{error}</Caption1>
              )}
            </DialogContent>
            <DialogActions>
              <Button
                appearance="secondary"
                onClick={() => setConfirmOpen(false)}
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button
                appearance="primary"
                style={{ background: '#da3633', borderColor: '#da3633' }}
                disabled={isPending}
                onClick={handleConfirm}
              >
                {isPending
                  ? 'Deleting...'
                  : deleteFolder
                    ? 'Delete project and folder'
                    : 'Remove from Squadboard'}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  )
}

function displayProjectFolderPath(squadPath: string): string {
  if (squadPath === '.squad') return '.'
  if (squadPath === '/.squad') return '/'
  if (squadPath.endsWith('/.squad')) return squadPath.slice(0, -'/.squad'.length) || '/'
  if (squadPath.endsWith('\\.squad')) return squadPath.slice(0, -'\\.squad'.length)
  return squadPath
}

export default function Settings() {
  const { id: projectId = '' } = useParams<{ id: string }>()
  const { data: project, isLoading, isError } = useProject(projectId)
  const [activeSection, setActiveSection] = useState<Section>('general')

  if (isLoading) {
    return <PageLoading label="Loading settings…" />
  }

  if (isError || !project) {
    return <div style={{ padding: '32px', color: 'var(--danger)' }}>Failed to load project.</div>
  }

  const navItemStyle = (active: boolean, isDanger = false): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '7px 12px',
    borderRadius: '6px',
    cursor: 'pointer',
    background: active ? (isDanger ? 'rgba(218,54,51,0.1)' : 'rgba(56,139,253,0.1)') : 'transparent',
    color: isDanger ? tokens.colorPaletteRedForeground1 : (active ? 'var(--text)' : 'var(--text-muted)'),
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
        description="Project configuration · sync status · MCP servers · budget · review policy."
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
              style={navItemStyle(activeSection === s.id, s.id === 'danger')}
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

          {activeSection === 'display' && (
            <>
              <SectionHeader title="Display" sub="UI preferences stored locally in this browser." />
              <DisplaySection />
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

          {activeSection === 'sync' && (
            <>
              <SectionHeader
                title="Team Sync"
                sub="Verify whether Squadboard and CLI/Copilot can start or continue work interchangeably."
              />
              <SquadSyncStatusPanel projectId={projectId} />
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

          {activeSection === 'backup' && (
            <>
              <SectionHeader
                title="Backup & Restore"
                sub="Create and restore PGlite data snapshots. Restore preserves a pre-restore rollback copy."
              />
              <SystemBackupSection />
            </>
          )}

          {activeSection === 'github' && (
            <>
              <SectionHeader
                title="GitHub Integration"
                sub="Authentication status, required permissions, branch convention, and connectivity tests."
              />
              <SystemGitHubSection />
              <SectionHeader
                title="GitHub Activity"
                sub="Recent GitHub events (pushes, PRs, issues, workflow runs) linked to this project."
              />
              <GitHubActivityFeed projectId={projectId} />
            </>
          )}

          {activeSection === 'danger' && (
            <>
              <SectionHeader
                title="Danger Zone"
                sub="Destructive actions. These cannot be undone; read carefully before proceeding."
              />
              <DangerZoneSection project={project} />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
