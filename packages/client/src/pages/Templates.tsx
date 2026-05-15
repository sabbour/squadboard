/**
 * Templates.tsx — Template catalog (Phase 10 ceremony templates + Phase 19 user templates).
 *
 * Tab layout:
 *   Ceremonies  — built-in ceremony templates (Hockney's original content)
 *   Workflows   — user-saved workflow templates (apply / delete)
 *   Teams       — user-saved team templates (apply / delete / drag-import)
 *   Projects    — user-saved project templates (apply / delete / drag-import)
 *
 * Active tab is persisted in the URL: ?tab=ceremonies|workflows|teams|projects
 * Drag-and-drop zone validates payload.kind matches the active tab before import.
 */

import { useState, useRef, DragEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useParams, useNavigate, useSearchParams } from 'react-router'
import {
  Subtitle1,
  Body1,
  Caption1,
  Button,
  Spinner,
  tokens,
  makeStyles,
  TabList,
  Tab,
  Dialog,
  DialogSurface,
  DialogBody,
  DialogTitle,
  DialogContent,
  DialogActions,
  Input,
  Field,
  type SelectTabData,
  type SelectTabEvent,
} from '@fluentui/react-components'
import {
  DocumentArrowDown20Regular,
  Delete20Regular,
  Play20Regular,
} from '@fluentui/react-icons'
import { useCeremonyTemplates } from '../api/ceremonies.ts'
import {
  useTemplates,
  useDeleteTemplate,
  useImportTeam,
  useImportProject,
  useImportWorkflow,
  useInstantiateTeamTemplate,
  useInstantiateProjectTemplate,
  useInstantiateWorkflowTemplate,
  readFileAsJson,
  type TemplateKind,
  type TemplateSummary,
} from '../api/templates.ts'
import { safeRelativeTime } from '../utils/dates.ts'
import PageHeader from '../components/layout/PageHeader.tsx'

const useStyles = makeStyles({
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
    gap: tokens.spacingVerticalL,
    padding: `${tokens.spacingVerticalL} ${tokens.spacingHorizontalXXL}`,
  },
  card: {
    background: tokens.colorNeutralBackground2,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalM}`,
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalS,
  },
  tagRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: tokens.spacingHorizontalXS,
  },
  tag: {
    background: tokens.colorBrandBackground2,
    color: tokens.colorBrandForeground2,
    borderRadius: tokens.borderRadiusMedium,
    padding: `2px ${tokens.spacingHorizontalS}`,
    fontSize: '11px',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  },
  center: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: tokens.spacingVerticalM,
    padding: '80px 24px',
    textAlign: 'center',
  },
  dropZone: {
    margin: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalXXL} 0`,
    border: `2px dashed ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalM}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: tokens.spacingHorizontalS,
    color: tokens.colorNeutralForeground3,
    cursor: 'pointer',
    transition: 'border 0.15s, background 0.15s',
  },
})

// ---------------------------------------------------------------------------
// Apply dialog — collects name (all kinds) + squadPath (project kind only)
// ---------------------------------------------------------------------------

function ApplyTemplateDialog({
  open,
  kind,
  templateName,
  onApply,
  onClose,
}: {
  open: boolean
  kind: TemplateKind
  templateName: string
  onApply: (name: string, squadPath?: string) => void
  onClose: () => void
}) {
  const [name, setName] = useState(templateName)
  const [squadPath, setSquadPath] = useState('')
  const canSubmit = name.trim() && (kind !== 'project' || squadPath.trim())
  return (
    <Dialog open={open} onOpenChange={(_, d) => { if (!d.open) onClose() }}>
      <DialogSurface style={{ maxWidth: 460 }}>
        <DialogBody>
          <DialogTitle>Apply template</DialogTitle>
          <DialogContent style={{ display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalM }}>
            <Field label="Name for the new item" required>
              <Input
                value={name}
                onChange={(_, d) => setName(d.value)}
                placeholder={templateName}
                autoFocus
              />
            </Field>
            {kind === 'project' && (
              <Field
                label="Squad directory path"
                required
                hint="Absolute path on disk where the new project's .squad/ folder will live."
              >
                <Input
                  value={squadPath}
                  onChange={(_, d) => setSquadPath(d.value)}
                  placeholder="/home/you/projects/my-new-project/.squad"
                />
              </Field>
            )}
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={onClose}>Cancel</Button>
            <Button
              appearance="primary"
              disabled={!canSubmit}
              onClick={() => {
                onApply(name.trim(), kind === 'project' ? squadPath.trim() : undefined)
                onClose()
              }}
            >
              Apply
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// User template grid (Workflows / Teams / Projects)
// ---------------------------------------------------------------------------

function TemplateGrid({
  kind,
  projectId,
}: {
  kind: TemplateKind
  projectId: string
}) {
  const styles = useStyles()
  const navigate = useNavigate()
  const { data: templates = [], isLoading, isError, error } = useTemplates(kind)
  const deleteTemplate = useDeleteTemplate()
  const instantiateTeam = useInstantiateTeamTemplate(projectId)
  const instantiateProject = useInstantiateProjectTemplate()
  const instantiateWorkflow = useInstantiateWorkflowTemplate(projectId)
  const [applyTarget, setApplyTarget] = useState<TemplateSummary | null>(null)
  const [applyError, setApplyError] = useState<string | null>(null)

  async function handleApply(tpl: TemplateSummary, name?: string, squadPath?: string) {
    setApplyError(null)
    try {
      if (kind === 'team') {
        await instantiateTeam.mutateAsync({ templateId: tpl.id })
      } else if (kind === 'project') {
        const result = await instantiateProject.mutateAsync({
          templateId: tpl.id,
          name: name ?? tpl.name,
          squadPath: squadPath ?? '',
        })
        void navigate(`/projects/${result.id}/board`)
        return
      } else {
        await instantiateWorkflow.mutateAsync({ templateId: tpl.id, name: name ?? tpl.name })
        void navigate(`/projects/${projectId}/ceremonies`)
        return
      }
    } catch (e: unknown) {
      setApplyError(e instanceof Error ? e.message : 'Apply failed')
    }
  }

  if (isLoading) {
    return (
      <div className={styles.center}>
        <Spinner size="medium" />
        <Body1 style={{ color: tokens.colorNeutralForeground3 }}>Loading…</Body1>
      </div>
    )
  }

  if (isError) {
    return (
      <div className={styles.center}>
        <Subtitle1 style={{ color: tokens.colorPaletteRedForeground1 }}>
          Couldn't load templates
        </Subtitle1>
        <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>
          {error instanceof Error ? error.message : String(error)}
        </Caption1>
      </div>
    )
  }

  if (templates.length === 0) {
    return (
      <div className={styles.center}>
        <Body1 style={{ color: tokens.colorNeutralForeground3 }}>
          No {kind} templates yet.{' '}
          {kind === 'team' && 'Use "Save as template" on the Agents page.'}
          {kind === 'project' && 'Use "Save as template" on the Settings page.'}
          {kind === 'workflow' && 'Use "Save as template" on a ceremony.'}
        </Body1>
      </div>
    )
  }

  return (
    <>
      {applyError && (
        <div style={{ padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalXXL}` }}>
          <Caption1 style={{ color: tokens.colorPaletteRedForeground1 }}>{applyError}</Caption1>
        </div>
      )}
      <div className={styles.grid}>
        {templates.map((tpl) => (
          <div key={tpl.id} className={styles.card}>
            <span style={{ fontWeight: 600, fontSize: '14px', color: tokens.colorNeutralForeground1 }}>
              {tpl.name}
            </span>
            {tpl.description && (
              <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>
                {tpl.description}
              </Caption1>
            )}
            <Caption1 style={{ color: tokens.colorNeutralForeground4, fontSize: '11px' }}>
              {safeRelativeTime(tpl.createdAt)}
            </Caption1>
            <div style={{ display: 'flex', gap: tokens.spacingHorizontalS, marginTop: tokens.spacingVerticalXS }}>
              <Button
                appearance="outline"
                size="small"
                icon={<Play20Regular />}
                onClick={() => {
                  if (kind === 'team') {
                    void handleApply(tpl)
                  } else {
                    setApplyTarget(tpl)
                  }
                }}
                disabled={
                  instantiateTeam.isPending ||
                  instantiateProject.isPending ||
                  instantiateWorkflow.isPending
                }
              >
                Apply
              </Button>
              <Button
                appearance="subtle"
                size="small"
                icon={<Delete20Regular />}
                onClick={() => deleteTemplate.mutate(tpl.id)}
                disabled={deleteTemplate.isPending}
              >
                Delete
              </Button>
            </div>
          </div>
        ))}
      </div>

      {applyTarget && (
        <ApplyTemplateDialog
          open
          kind={kind}
          templateName={applyTarget.name}
          onApply={(name, squadPath) => void handleApply(applyTarget, name, squadPath)}
          onClose={() => setApplyTarget(null)}
        />
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Drag-import zone
// ---------------------------------------------------------------------------

function DragImportZone({
  activeKind,
  projectId,
}: {
  activeKind: TemplateKind
  projectId: string
}) {
  const styles = useStyles()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null)
  // For project imports, we need to collect squadPath before proceeding.
  const [pendingPayload, setPendingPayload] = useState<unknown>(null)
  const [squadPathInput, setSquadPathInput] = useState('')
  const importTeam = useImportTeam()
  const importProject = useImportProject()
  const importWorkflow = useImportWorkflow()

  function validateKind(raw: unknown): boolean {
    if (
      raw !== null &&
      typeof raw === 'object' &&
      'payload' in raw &&
      (raw as Record<string, unknown>).payload !== null &&
      typeof (raw as Record<string, unknown>).payload === 'object' &&
      'kind' in ((raw as Record<string, unknown>).payload as Record<string, unknown>)
    ) {
      const payloadKind = ((raw as Record<string, unknown>).payload as Record<string, unknown>).kind
      if (payloadKind !== activeKind) {
        setFeedback({ type: 'err', msg: `File kind "${String(payloadKind)}" doesn't match active tab "${activeKind}".` })
        return false
      }
    }
    return true
  }

  async function doImport(raw: unknown, squadPath?: string) {
    try {
      if (activeKind === 'team') {
        const result = await importTeam.mutateAsync({ projectId, payload: raw })
        setFeedback({ type: 'ok', msg: `Imported ${result.imported} agents.` })
      } else if (activeKind === 'project') {
        const result = await importProject.mutateAsync({ payload: raw, squadPath: squadPath ?? '' })
        setFeedback({ type: 'ok', msg: `Project "${result.name}" imported.` })
        setPendingPayload(null)
        setSquadPathInput('')
      } else {
        await importWorkflow.mutateAsync({ projectId, payload: raw })
        setFeedback({ type: 'ok', msg: 'Workflow imported.' })
      }
    } catch (e: unknown) {
      setFeedback({ type: 'err', msg: e instanceof Error ? e.message : 'Import failed' })
    }
  }

  async function ingestFile(file: File) {
    setFeedback(null)
    try {
      const raw = await readFileAsJson(file)
      if (!validateKind(raw)) return
      if (activeKind === 'project') {
        // Need squadPath — park the payload and prompt
        setPendingPayload(raw)
        return
      }
      await doImport(raw)
    } catch (err) {
      setFeedback({ type: 'err', msg: err instanceof Error ? err.message : 'Invalid file' })
    }
  }

  async function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (!file) return
    await ingestFile(file)
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    await ingestFile(file)
    e.target.value = ''
  }

  return (
    <div>
      <div
        className={styles.dropZone}
        style={isDragging ? {
          border: `2px dashed ${tokens.colorBrandStroke1}`,
          background: tokens.colorBrandBackground2,
          color: tokens.colorBrandForeground2,
        } : undefined}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => void handleDrop(e)}
        onClick={() => fileInputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click() }}
        aria-label={`Drop a ${activeKind} JSON file here to import`}
      >
        <DocumentArrowDown20Regular />
        <Caption1>
          Drop a <strong>{activeKind}</strong> JSON file here to import, or click to browse
        </Caption1>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        style={{ display: 'none' }}
        onChange={(e) => void handleFileChange(e)}
      />
      {feedback && (
        <Caption1
          style={{
            display: 'block',
            margin: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalXXL} 0`,
            color: feedback.type === 'ok'
              ? tokens.colorPaletteGreenForeground1
              : tokens.colorPaletteRedForeground1,
          }}
        >
          {feedback.msg}
        </Caption1>
      )}

      {/* Squad path prompt — shown after a project file is dropped */}
      {pendingPayload !== null && activeKind === 'project' && (
        <div style={{
          margin: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalXXL} 0`,
          padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalM}`,
          background: tokens.colorNeutralBackground2,
          border: `1px solid ${tokens.colorNeutralStroke2}`,
          borderRadius: tokens.borderRadiusMedium,
          display: 'flex',
          flexDirection: 'column',
          gap: tokens.spacingVerticalS,
        }}>
          <Field
            label="Squad directory path"
            required
            hint="Absolute path on disk where the new project's .squad/ folder will live."
          >
            <Input
              value={squadPathInput}
              onChange={(_, d) => setSquadPathInput(d.value)}
              placeholder="/home/you/projects/my-new-project/.squad"
              autoFocus
            />
          </Field>
          <div style={{ display: 'flex', gap: tokens.spacingHorizontalS }}>
            <Button
              appearance="primary"
              size="small"
              disabled={!squadPathInput.trim() || importProject.isPending}
              onClick={() => void doImport(pendingPayload, squadPathInput.trim())}
            >
              {importProject.isPending ? 'Importing…' : 'Import project'}
            </Button>
            <Button
              appearance="subtle"
              size="small"
              onClick={() => { setPendingPayload(null); setSquadPathInput('') }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Ceremony templates tab (Hockney's original content, preserved)
// ---------------------------------------------------------------------------

function CeremonyTemplatesTab() {
  const styles = useStyles()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { id: projectId = '' } = useParams<{ id: string }>()
  const { data: templates, isLoading, isError, error } = useCeremonyTemplates()

  function handleRetry() {
    void queryClient.invalidateQueries({ queryKey: ['ceremony-templates'] })
  }

  if (isLoading) {
    return (
      <div className={styles.center}>
        <Spinner size="medium" />
        <Body1 style={{ color: tokens.colorNeutralForeground3 }}>Loading templates…</Body1>
      </div>
    )
  }

  if (isError) {
    return (
      <div className={styles.center}>
        <Subtitle1 style={{ color: tokens.colorPaletteRedForeground1 }}>
          Couldn't load templates — try again
        </Subtitle1>
        {error && (
          <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>
            {error instanceof Error ? error.message : String(error)}
          </Caption1>
        )}
        <Button appearance="primary" onClick={handleRetry}>
          Retry
        </Button>
      </div>
    )
  }

  if (!templates || templates.length === 0) {
    return (
      <div className={styles.center}>
        <Body1 style={{ color: tokens.colorNeutralForeground3 }}>
          No workload templates yet.
        </Body1>
      </div>
    )
  }

  return (
    <div className={styles.grid}>
      {templates.map((tpl) => (
        <div key={tpl.slug} className={styles.card}>
          <span style={{ fontWeight: 600, fontSize: '14px' }}>{tpl.name}</span>
          {tpl.description && (
            <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>
              {tpl.description}
            </Caption1>
          )}
          {tpl.tags && tpl.tags.length > 0 && (
            <div className={styles.tagRow}>
              {tpl.tags.map((tag) => (
                <span key={tag} className={styles.tag}>{tag}</span>
              ))}
            </div>
          )}
          <Button
            appearance="outline"
            size="small"
            style={{ alignSelf: 'flex-end', marginTop: tokens.spacingVerticalXS }}
            onClick={() => navigate(`/projects/${projectId}/ceremonies/new?template=${tpl.slug}`)}
          >
            Use template
          </Button>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Root page
// ---------------------------------------------------------------------------

type TabId = 'ceremonies' | 'workflows' | 'teams' | 'projects'
const TAB_LABELS: Record<TabId, string> = {
  ceremonies: 'Ceremonies',
  workflows: 'Workflows',
  teams: 'Teams',
  projects: 'Projects',
}
const USER_TEMPLATE_KINDS: Record<Exclude<TabId, 'ceremonies'>, TemplateKind> = {
  workflows: 'workflow',
  teams: 'team',
  projects: 'project',
}

export default function Templates() {
  const { id: projectId = '' } = useParams<{ id: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const rawTab = searchParams.get('tab') ?? 'ceremonies'
  const activeTab: TabId =
    rawTab === 'workflows' || rawTab === 'teams' || rawTab === 'projects'
      ? rawTab
      : 'ceremonies'

  function handleTabSelect(_e: SelectTabEvent, data: SelectTabData) {
    const next = new URLSearchParams(searchParams)
    next.set('tab', String(data.value))
    setSearchParams(next, { replace: true })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'auto' }}>
      <PageHeader
        title="Templates"
        description="Built-in ceremony templates and your saved workflow · team · project templates."
      />

      {/* Tab bar */}
      <div style={{ padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalXXL} 0`, borderBottom: `1px solid var(--border)`, flexShrink: 0 }}>
        <TabList
          selectedValue={activeTab}
          onTabSelect={handleTabSelect}
        >
          {(Object.keys(TAB_LABELS) as TabId[]).map((id) => (
            <Tab key={id} value={id}>
              {TAB_LABELS[id]}
            </Tab>
          ))}
        </TabList>
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {activeTab === 'ceremonies' && <CeremonyTemplatesTab />}

        {activeTab !== 'ceremonies' && (
          <>
            <DragImportZone
              activeKind={USER_TEMPLATE_KINDS[activeTab]}
              projectId={projectId}
            />
            <TemplateGrid
              kind={USER_TEMPLATE_KINDS[activeTab]}
              projectId={projectId}
            />
          </>
        )}
      </div>
    </div>
  )
}
