import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router'
import {
  Button,
  Title2,
  Title3,
  Body1,
  Caption1,
  Badge,
  Field,
  Input,
  Textarea,
  Dialog,
  DialogSurface,
  DialogBody,
  DialogTitle,
  DialogContent,
  DialogActions,
  Spinner,
  tokens,
} from '@fluentui/react-components'
import { Folder20Regular, DocumentCopy20Regular, ArrowSync20Regular, Beaker20Regular, Sparkle20Regular } from '@fluentui/react-icons'
import { useProjects, useSuggestProjectSetup } from '../api/projects.ts'
import type { ProjectSuggestion } from '../api/projects.ts'
import { useDiscoverSquad, useRegisterSquad, useInitSquad, useCreateSquad } from '../api/squad.ts'
import type { SquadDirectory } from '../api/squad.ts'
import {
  useTemplates,
  useInstantiateProjectTemplate,
  useBuiltinProjectTemplates,
  useApplyBuiltinProjectTemplate,
} from '../api/templates.ts'
import ProjectCard from '../components/ProjectCard.tsx'

export default function ProjectPicker() {
  const navigate = useNavigate()
  const { data: projects, isLoading, isError } = useProjects()
  const [showModal, setShowModal] = useState(false)
  const [showFromTemplate, setShowFromTemplate] = useState(false)

  const hasProjects = projects && projects.length > 0

  return (
    <div style={{ padding: '32px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
        <div>
          <Title2 as="h1">Projects</Title2>
          <Body1 style={{ color: 'var(--text-muted)', marginTop: '4px', display: 'block' }}>
            Select a project to open its board, or connect a new .squad/ directory.
          </Body1>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <Button
            appearance="outline"
            icon={<DocumentCopy20Regular />}
            onClick={() => setShowFromTemplate(true)}
          >
            Create from template
          </Button>
          <Button
            appearance="primary"
            onClick={() => setShowModal(true)}
          >
            Add Project
          </Button>
        </div>
      </div>

      {isLoading && (
        <Body1 style={{ display: 'block', color: tokens.colorNeutralForeground3, marginBottom: tokens.spacingVerticalM }}>Loading projects…</Body1>
      )}

      {isError && (
        <p style={{ color: 'var(--danger)' }}>
          Failed to load projects. Is the backend running on port 3000?
        </p>
      )}

      {!isLoading && !isError && !hasProjects && (
        <EmptyState onDiscover={() => setShowModal(true)} />
      )}

      {hasProjects && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: '16px',
          }}
        >
          {projects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              onClick={() => void navigate(`/projects/${project.id}/board`)}
            />
          ))}
        </div>
      )}

      {showModal && (
        <DiscoveryModal
          onClose={() => setShowModal(false)}
          onCreated={(id) => void navigate(`/projects/${id}/board`)}
        />
      )}

      {showFromTemplate && (
        <CreateFromTemplateModal
          onClose={() => setShowFromTemplate(false)}
          onCreated={(id) => void navigate(`/projects/${id}/board`)}
        />
      )}
    </div>
  )
}

function CreateFromTemplateModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const { data: savedTemplates = [], isLoading: savedLoading, isError: savedError } = useTemplates('project')
  const { data: builtinTemplates = [], isLoading: builtinLoading } = useBuiltinProjectTemplates()
  const instantiate = useInstantiateProjectTemplate()
  const applyBuiltin = useApplyBuiltinProjectTemplate()

  // selectedKind: 'builtin' | 'saved'
  const [selectedKind, setSelectedKind] = useState<'builtin' | 'saved' | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [squadPath, setSquadPath] = useState('')
  const [error, setError] = useState<string | null>(null)

  const isLoading = savedLoading || builtinLoading
  const isPending = instantiate.isPending || applyBuiltin.isPending

  async function handleCreate() {
    if (!selectedId || !selectedKind || !name.trim() || !squadPath.trim()) return
    setError(null)
    try {
      if (selectedKind === 'builtin') {
        const result = await applyBuiltin.mutateAsync({
          bundleId: selectedId,
          name: name.trim(),
          squadPath: squadPath.trim(),
        })
        onCreated(result.id)
      } else {
        const result = await instantiate.mutateAsync({
          templateId: selectedId,
          name: name.trim(),
          squadPath: squadPath.trim(),
        })
        onCreated(result.id)
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create project')
    }
  }

  function selectBuiltin(bundleId: string, bundleName: string) {
    setSelectedKind('builtin')
    setSelectedId(bundleId)
    setName(bundleName)
  }

  function selectSaved(id: string, tplName: string) {
    setSelectedKind('saved')
    setSelectedId(id)
    setName(tplName)
  }

  const hasAny = builtinTemplates.length > 0 || savedTemplates.length > 0

  return (
    <Dialog open onOpenChange={(_, d) => { if (!d.open) onClose() }}>
      <DialogSurface style={{ maxWidth: 560, width: '100%' }}>
        <DialogBody>
          <DialogTitle>Create project from template</DialogTitle>
          <DialogContent style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {isLoading && (
              <Body1 style={{ color: 'var(--text-muted)' }}>Loading templates…</Body1>
            )}
            {!isLoading && !hasAny && (
              <Body1 style={{ color: 'var(--text-muted)' }}>
                No project templates available.
              </Body1>
            )}

            {/* Built-in templates section */}
            {!isLoading && builtinTemplates.length > 0 && (
              <>
                <div style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>
                  Built-in
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {builtinTemplates.map((tpl) => (
                    <button
                      key={tpl.bundleId}
                      onClick={() => selectBuiltin(tpl.bundleId, tpl.name)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        background: selectedKind === 'builtin' && selectedId === tpl.bundleId
                          ? 'rgba(56,139,253,0.12)'
                          : 'var(--bg)',
                        border: `1px solid ${selectedKind === 'builtin' && selectedId === tpl.bundleId ? tokens.colorBrandStroke1 : 'var(--border)'}`,
                        borderRadius: 'var(--radius)',
                        padding: '10px 14px',
                        color: 'var(--text)',
                        textAlign: 'left',
                        width: '100%',
                        cursor: 'pointer',
                      }}
                    >
                      {tpl.icon && <span style={{ fontSize: '20px', lineHeight: 1 }}>{tpl.icon}</span>}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 500 }}>{tpl.name}</div>
                        {tpl.description && (
                          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {tpl.description}
                          </div>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}

            {/* User-saved templates section */}
            {!isLoading && savedTemplates.length > 0 && (
              <>
                <div style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>
                  My templates
                </div>
                {savedError && (
                  <Body1 style={{ color: 'var(--danger)' }}>Failed to load saved templates.</Body1>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '180px', overflowY: 'auto' }}>
                  {savedTemplates.map((tpl) => (
                    <button
                      key={tpl.id}
                      onClick={() => selectSaved(tpl.id, tpl.name)}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'flex-start',
                        background: selectedKind === 'saved' && selectedId === tpl.id
                          ? 'rgba(56,139,253,0.12)'
                          : 'var(--bg)',
                        border: `1px solid ${selectedKind === 'saved' && selectedId === tpl.id ? tokens.colorBrandStroke1 : 'var(--border)'}`,
                        borderRadius: 'var(--radius)',
                        padding: '10px 14px',
                        color: 'var(--text)',
                        textAlign: 'left',
                        width: '100%',
                        cursor: 'pointer',
                      }}
                    >
                      <span style={{ fontWeight: 500 }}>{tpl.name}</span>
                      {tpl.description && (
                        <span style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>{tpl.description}</span>
                      )}
                    </button>
                  ))}
                </div>
              </>
            )}

            {/* Project name + squad path fields — shown once any template is selected */}
            {selectedId && (
              <>
                <div>
                  <label style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                    Project name <span style={{ color: 'var(--danger)' }}>*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="my-new-project"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                    Squad directory path <span style={{ color: 'var(--danger)' }}>*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="/home/you/projects/my-new-project/.squad"
                    value={squadPath}
                    onChange={(e) => setSquadPath(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void handleCreate() }}
                    style={inputStyle}
                  />
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginTop: '4px' }}>
                    Absolute path on disk where the new project's .squad/ folder will live.
                  </span>
                </div>
              </>
            )}

            {error && <p style={{ color: 'var(--danger)', fontSize: '13px', margin: 0 }}>{error}</p>}
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={onClose}>Cancel</Button>
            <Button
              appearance="primary"
              disabled={!selectedId || !name.trim() || !squadPath.trim() || isPending}
              onClick={() => void handleCreate()}
            >
              {isPending ? 'Creating…' : 'Create project'}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  )
}

function EmptyState({ onDiscover }: { onDiscover: () => void }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '80px 32px',
        textAlign: 'center',
        border: '1px dashed var(--border)',
        borderRadius: 'var(--radius)',
      }}
    >
      <div style={{ fontSize: '32px', marginBottom: '16px' }}><Folder20Regular style={{ fontSize: '32px', width: '32px', height: '32px' }} /></div>
      <Title3 as="h2" style={{ marginBottom: '8px', display: 'block' }}>No projects yet</Title3>
      <Body1 style={{ color: 'var(--text-muted)', maxWidth: '320px', marginBottom: '24px', display: 'block' }}>
        Connect a <code style={{ fontFamily: 'monospace', color: 'var(--accent)' }}>.squad/</code>{' '}
        directory to get started. Squadboard will discover your agents and workflows automatically.
      </Body1>
      <Button appearance="primary" onClick={onDiscover}>
        Discover .squad/ directories
      </Button>
    </div>
  )
}

function DiscoveryModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (id: string) => void
}) {
  type ModalTab = 'discover' | 'connect' | 'create' | 'suggest'
  const [activeTab, setActiveTab] = useState<ModalTab>('discover')
  const tabLabels: Record<ModalTab, string> = { discover: 'Discover', connect: 'Connect existing', create: 'Create new', suggest: 'Suggest setup' }

  // Wave 10 C2: form state lifted up so the dialog can render a single
  // right-aligned DialogActions row whose primary button changes by tab.
  // Previously each tab body had its own stacked primary button which
  // looked off vs Fluent2 dialogs.
  const [connectPath, setConnectPath] = useState('')
  const [connectName, setConnectName] = useState('')
  const initSquad = useInitSquad()

  const [createParent, setCreateParent] = useState('')
  const [createName, setCreateName] = useState('')
  const createSquad = useCreateSquad()

  // Suggest tab state (O1 Wave 20)
  const applyBuiltinTemplate = useApplyBuiltinProjectTemplate()

  // Default the Create tab parent path to the server's home directory the
  // first time it's mounted so the user doesn't have to type the prefix.
  useEffect(() => {
    fetch('/api/squad/home')
      .then((r) => r.json())
      .then((data: { path: string }) => {
        if (data.path) setCreateParent((cur) => cur || data.path)
      })
      .catch(() => { /* ignore — user can type manually */ })
  }, [])

  // Per-tab error parsing. The squad APIs return structured errors as
  // `API <code>: <body>` so unwrap when possible.
  const connectError = (() => {
    const err = initSquad.error
    if (!err) return null
    if (err.message.startsWith('API 409')) return 'A .squad/ directory already exists here — use Discover instead.'
    if (err.message.startsWith('API 422')) return 'Directory not found — check the path.'
    return err.message
  })()

  const createError = (() => {
    const err = createSquad.error
    if (!err) return null
    const m = err.message.match(/^API \d+: (.+)$/)
    if (m) {
      try {
        const body = JSON.parse(m[1]) as { error?: string }
        if (body.error) return body.error
      } catch { /* fall through */ }
    }
    return err.message
  })()

  const createPreview = createParent.trim() && createName.trim()
    ? `${createParent.trim().replace(/\/$/, '')}/${createName.trim()}/.squad/`
    : null

  function handleConnect() {
    if (!connectPath.trim()) return
    initSquad.mutate(
      { path: connectPath.trim(), projectName: connectName.trim() || undefined },
      { onSuccess: (res) => onCreated(res.projectId) },
    )
  }

  function handleCreate() {
    if (!createParent.trim() || !createName.trim()) return
    createSquad.mutate(
      { parentPath: createParent.trim(), projectName: createName.trim() },
      { onSuccess: (res) => onCreated(res.projectId) },
    )
  }

  // Per-tab primary action descriptor used by DialogActions below. The
  // Discover tab has no primary action (rows act as click targets).
  const primaryAction = (() => {
    if (activeTab === 'connect') {
      return {
        label: initSquad.isPending ? 'Connecting…' : 'Connect',
        disabled: !connectPath.trim() || initSquad.isPending,
        onClick: handleConnect,
      }
    }
    if (activeTab === 'create') {
      return {
        label: createSquad.isPending ? 'Creating…' : 'Create project',
        disabled: !createParent.trim() || !createName.trim() || createSquad.isPending,
        onClick: handleCreate,
      }
    }
    return null
  })()

  return (
    <Dialog open onOpenChange={(_, data) => { if (!data.open) onClose() }}>
      <DialogSurface style={{ maxWidth: '560px', width: '100%', maxHeight: '80vh' }}>
        <DialogBody style={{ maxHeight: 'inherit', display: 'flex', flexDirection: 'column' }}>
          <DialogTitle>Add Project</DialogTitle>
          <DialogContent style={{ display: 'flex', flexDirection: 'column', gap: 0, overflow: 'hidden' }}>
            {/* Tab bar */}
            <div
              style={{
                display: 'flex',
                borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
                marginBottom: tokens.spacingVerticalM,
              }}
            >
              {(['discover', 'connect', 'create', 'suggest'] as const).map((tab) => {
                const isActive = activeTab === tab
                return (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    style={{
                      background: 'none',
                      border: 'none',
                      borderBottom: isActive ? `2px solid ${tokens.colorBrandForeground1}` : '2px solid transparent',
                      padding: '8px 14px',
                      fontSize: '13px',
                      fontWeight: isActive ? 600 : 400,
                      color: isActive ? tokens.colorBrandForeground1 : tokens.colorNeutralForeground3,
                      cursor: 'pointer',
                      marginBottom: '-1px',
                    }}
                  >
                    {tab === 'suggest' && (
                      <Sparkle20Regular style={{ width: '14px', height: '14px', marginRight: '4px', verticalAlign: 'middle' }} />
                    )}
                    {tabLabels[tab]}
                  </button>
                )
              })}
            </div>

            {/* Tab body */}
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {activeTab === 'discover' && <DiscoverTab onCreated={onCreated} />}
              {activeTab === 'connect' && (
                <ConnectTab
                  path={connectPath}
                  setPath={setConnectPath}
                  name={connectName}
                  setName={setConnectName}
                  errorMsg={connectError}
                  onSubmit={handleConnect}
                />
              )}
              {activeTab === 'create' && (
                <CreateTab
                  parentPath={createParent}
                  setParentPath={setCreateParent}
                  projectName={createName}
                  setProjectName={setCreateName}
                  errorMsg={createError}
                  preview={createPreview}
                  onSubmit={handleCreate}
                />
              )}
              {activeTab === 'suggest' && (
                <SuggestTab
                  onCustomize={(suggestion) => {
                    setCreateName(suggestion.bundleName)
                    setActiveTab('create')
                  }}
                  onApplied={(id) => onCreated(id)}
                  applyBuiltinTemplate={applyBuiltinTemplate}
                  createParent={createParent}
                  setCreateParent={setCreateParent}
                />
              )}
            </div>
          </DialogContent>
          {/* Wave 10 C2: single right-aligned DialogActions row. The primary
              swaps based on active tab (or hides on Discover, which is row-
              triggered). Cancel always available. */}
          <DialogActions>
            <Button appearance="secondary" onClick={onClose}>
              {primaryAction ? 'Cancel' : 'Close'}
            </Button>
            {primaryAction && (
              <Button
                appearance="primary"
                disabled={primaryAction.disabled}
                onClick={primaryAction.onClick}
              >
                {primaryAction.label}
              </Button>
            )}
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  )
}

function DiscoverTab({ onCreated }: { onCreated: (id: string) => void }) {
  const { data: dirs, isFetching, isError: isDiscoverError, error: discoverError, refetch } = useDiscoverSquad()
  const { mutate: register, isPending: isRegistering, error: registerError } = useRegisterSquad()

  function handleSelect(dir: SquadDirectory) {
    register(
      { path: dir.path, projectName: dir.name },
      { onSuccess: (res) => onCreated(res.projectId) },
    )
  }

  return (
    <div>
      <Body1 style={{ display: 'block', color: tokens.colorNeutralForeground3, marginBottom: tokens.spacingVerticalM }}>
        Scan the filesystem for existing <code style={{ fontFamily: tokens.fontFamilyMonospace }}>.squad/</code> directories.
      </Body1>

      <Button
        appearance="secondary"
        size="small"
        icon={isFetching ? <Spinner size="extra-tiny" /> : <ArrowSync20Regular />}
        disabled={isFetching}
        onClick={() => void refetch()}
        style={{ marginBottom: tokens.spacingVerticalM }}
      >
        {isFetching ? 'Scanning…' : 'Scan filesystem'}
      </Button>

      {isDiscoverError && (
        <Caption1 style={{ display: 'block', color: tokens.colorPaletteRedForeground1, marginBottom: tokens.spacingVerticalS }}>
          Scan failed: {discoverError?.message ?? 'Unknown error'}
        </Caption1>
      )}

      {!isDiscoverError && dirs && dirs.length === 0 && (
        <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>
          No .squad/ directories found on the filesystem.
        </Caption1>
      )}

      {!isDiscoverError && dirs && dirs.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalXS }}>
          {dirs.map((dir) => (
            <button
              key={dir.path}
              onClick={() => handleSelect(dir)}
              disabled={isRegistering}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                gap: 2,
                background: tokens.colorNeutralBackground1,
                border: `1px solid ${tokens.colorNeutralStroke2}`,
                borderRadius: tokens.borderRadiusMedium,
                padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
                color: tokens.colorNeutralForeground1,
                textAlign: 'left',
                width: '100%',
                cursor: isRegistering ? 'wait' : 'pointer',
              }}
            >
              <span style={{ fontWeight: tokens.fontWeightSemibold }}>{dir.name}</span>
              <Caption1 style={{ color: tokens.colorNeutralForeground3, fontFamily: tokens.fontFamilyMonospace }}>
                {dir.path}
              </Caption1>
            </button>
          ))}
        </div>
      )}

      {registerError && (
        <Caption1 style={{ display: 'block', color: tokens.colorPaletteRedForeground1, marginTop: tokens.spacingVerticalS }}>
          {registerError.message}
        </Caption1>
      )}
    </div>
  )
}

function ConnectTab({
  path,
  setPath,
  name,
  setName,
  errorMsg,
  onSubmit,
}: {
  path: string
  setPath: (v: string) => void
  name: string
  setName: (v: string) => void
  errorMsg: string | null
  onSubmit: () => void
}) {
  return (
    <div>
      <Body1 style={{ display: 'block', color: tokens.colorNeutralForeground3, marginBottom: tokens.spacingVerticalM }}>
        Scaffold a <code style={{ fontFamily: tokens.fontFamilyMonospace }}>.squad/</code> directory in an existing project folder.
      </Body1>

      <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalS }}>
        <Field label="Directory path" required>
          <Input
            value={path}
            onChange={(_, d) => setPath(d.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') onSubmit() }}
            placeholder="/absolute/path/to/project"
            input={{ style: { fontFamily: tokens.fontFamilyMonospace } }}
          />
        </Field>

        <Field label="Project name" hint="Optional — defaults to directory name.">
          <Input
            value={name}
            onChange={(_, d) => setName(d.value)}
            placeholder="my-project"
          />
        </Field>

        {errorMsg && (
          <Caption1 style={{ color: tokens.colorPaletteRedForeground1 }}>{errorMsg}</Caption1>
        )}
      </div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  padding: '8px 12px',
  color: 'var(--text)',
  width: '100%',
  fontFamily: 'monospace',
  fontSize: '13px',
  outline: 'none',
  boxSizing: 'border-box',
}

function CreateTab({
  parentPath,
  setParentPath,
  projectName,
  setProjectName,
  errorMsg,
  preview,
  onSubmit,
}: {
  parentPath: string
  setParentPath: (v: string) => void
  projectName: string
  setProjectName: (v: string) => void
  errorMsg: string | null
  preview: string | null
  onSubmit: () => void
}) {
  return (
    <div>
      <Body1 style={{ display: 'block', color: tokens.colorNeutralForeground3, marginBottom: tokens.spacingVerticalM }}>
        Create a new directory with a <code style={{ fontFamily: tokens.fontFamilyMonospace }}>.squad/</code> scaffold inside it.
      </Body1>

      <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalS }}>
        <Field label="Parent directory" required>
          <Input
            value={parentPath}
            onChange={(_, d) => setParentPath(d.value)}
            placeholder="/absolute/path/to/parent"
            input={{ style: { fontFamily: tokens.fontFamilyMonospace } }}
          />
        </Field>

        <Field label="Project name" required>
          <Input
            value={projectName}
            onChange={(_, d) => setProjectName(d.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') onSubmit() }}
            placeholder="my-new-project"
          />
        </Field>

        {preview && (
          <div
            style={{
              background: tokens.colorNeutralBackground2,
              border: `1px solid ${tokens.colorNeutralStroke2}`,
              borderRadius: tokens.borderRadiusMedium,
              padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalM}`,
              fontSize: '12px',
              fontFamily: tokens.fontFamilyMonospace,
              color: tokens.colorNeutralForeground3,
            }}
          >
            Will create: <span style={{ color: tokens.colorBrandForeground1 }}>{preview}</span>
          </div>
        )}

        {errorMsg && (
          <Caption1 style={{ color: tokens.colorPaletteRedForeground1 }}>{errorMsg}</Caption1>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// SuggestTab — O1 Wave 20: "Suggest setup" third entry point
// ---------------------------------------------------------------------------
function SuggestTab({
  onCustomize,
  onApplied,
  applyBuiltinTemplate,
  createParent,
  setCreateParent,
}: {
  onCustomize: (suggestion: ProjectSuggestion) => void
  onApplied: (id: string) => void
  applyBuiltinTemplate: ReturnType<typeof useApplyBuiltinProjectTemplate>
  createParent: string
  setCreateParent: (v: string) => void
}) {
  const [description, setDescription] = useState('')
  const suggest = useSuggestProjectSetup()

  const [applyName, setApplyName] = useState('')
  const [applyPath, setApplyPath] = useState(createParent)
  const [showApplyForm, setShowApplyForm] = useState(false)

  const suggestion = suggest.data

  function handleSuggest() {
    const trimmed = description.trim()
    if (!trimmed) return
    suggest.mutate({ description: trimmed })
  }

  function handleApply() {
    if (!suggestion || !applyName.trim() || !applyPath.trim()) return
    applyBuiltinTemplate.mutate(
      { bundleId: suggestion.bundleId, name: applyName.trim(), squadPath: applyPath.trim() },
      { onSuccess: (res) => onApplied(res.id) },
    )
  }

  // Preview panel colors
  const sectionStyle: React.CSSProperties = {
    marginBottom: tokens.spacingVerticalM,
  }
  const headingStyle: React.CSSProperties = {
    fontSize: '11px',
    fontWeight: Number(tokens.fontWeightSemibold),
    color: tokens.colorNeutralForeground3,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    marginBottom: tokens.spacingVerticalXS,
  }
  const chipRowStyle: React.CSSProperties = {
    display: 'flex',
    flexWrap: 'wrap',
    gap: tokens.spacingHorizontalXS,
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalM }}>
      <Body1 style={{ display: 'block', color: tokens.colorNeutralForeground3 }}>
        Describe what you're building and we'll recommend a team, ceremonies, and board setup.
      </Body1>

      <Field label="Project description">
        <Textarea
          value={description}
          onChange={(_, d) => setDescription(d.value)}
          placeholder="e.g. I'm building a CLI in Rust that helps developers manage…"
          rows={3}
          aria-label="Describe your project to get a suggested setup"
        />
      </Field>

      <Button
        appearance="primary"
        icon={suggest.isPending ? <Spinner size="tiny" /> : <Beaker20Regular />}
        disabled={!description.trim() || suggest.isPending}
        onClick={handleSuggest}
      >
        {suggest.isPending ? 'Suggesting…' : 'Suggest setup'}
      </Button>

      {suggest.error && (
        <Caption1 style={{ color: tokens.colorPaletteRedForeground1 }}>
          {suggest.error.message}
        </Caption1>
      )}

      {suggestion && !showApplyForm && (
        <div
          aria-live="polite"
          style={{
            border: `1px solid ${tokens.colorNeutralStroke2}`,
            borderRadius: tokens.borderRadiusMedium,
            padding: tokens.spacingVerticalM,
            background: tokens.colorNeutralBackground2,
            display: 'flex',
            flexDirection: 'column',
            gap: tokens.spacingVerticalS,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: tokens.spacingHorizontalS }}>
            <span style={{ fontWeight: Number(tokens.fontWeightSemibold), fontSize: '14px' }}>
              {suggestion.bundleName}
            </span>
            {suggestion.matchedKeywords.length > 0 && (
              <div style={chipRowStyle}>
                {suggestion.matchedKeywords.slice(0, 4).map((kw) => (
                  <Badge key={kw} appearance="tint" color="informative" size="small">{kw}</Badge>
                ))}
              </div>
            )}
          </div>
          <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>{suggestion.description}</Caption1>

          {/* Recommended team */}
          <div style={sectionStyle}>
            <div style={headingStyle}>Team</div>
            <div style={chipRowStyle}>
              {suggestion.team.map((m) => (
                <Badge key={m.name} appearance="outline" size="small">{m.name} · {m.role}</Badge>
              ))}
            </div>
          </div>

          {/* Recommended ceremonies */}
          <div style={sectionStyle}>
            <div style={headingStyle}>Ceremonies</div>
            <div style={chipRowStyle}>
              {suggestion.ceremonies.map((c) => (
                <Badge key={c.name} appearance="outline" size="small">{c.name} ({c.cadence})</Badge>
              ))}
            </div>
          </div>

          {/* Kanban columns */}
          <div style={sectionStyle}>
            <div style={headingStyle}>Board columns</div>
            <div style={chipRowStyle}>
              {suggestion.columns.map((col, i) => (
                <Badge key={col.slug} appearance="filled" color="subtle" size="small">
                  {i + 1}. {col.label}
                </Badge>
              ))}
            </div>
          </div>

          {/* Skills */}
          {suggestion.skills.length > 0 && (
            <div style={sectionStyle}>
              <div style={headingStyle}>Starter skills</div>
              <div style={chipRowStyle}>
                {suggestion.skills.map((s) => (
                  <Badge key={s} appearance="tint" color="success" size="small">{s}</Badge>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: tokens.spacingHorizontalS, marginTop: tokens.spacingVerticalXS }}>
            <Button
              appearance="primary"
              size="small"
              onClick={() => {
                setApplyName(suggestion.bundleName)
                setApplyPath(createParent)
                setShowApplyForm(true)
              }}
            >
              Apply suggestion
            </Button>
            <Button
              appearance="outline"
              size="small"
              onClick={() => onCustomize(suggestion)}
            >
              Customize
            </Button>
          </div>
        </div>
      )}

      {/* Apply form — shown after user clicks "Apply suggestion" */}
      {suggestion && showApplyForm && (
        <div
          style={{
            border: `1px solid ${tokens.colorBrandStroke1}`,
            borderRadius: tokens.borderRadiusMedium,
            padding: tokens.spacingVerticalM,
            background: tokens.colorNeutralBackground2,
            display: 'flex',
            flexDirection: 'column',
            gap: tokens.spacingVerticalS,
          }}
        >
          <Body1 style={{ display: 'block', fontWeight: Number(tokens.fontWeightSemibold) }}>
            Apply "{suggestion.bundleName}"
          </Body1>

          <Field label="Project name" required>
            <Input
              value={applyName}
              onChange={(_, d) => setApplyName(d.value)}
              placeholder="my-project"
            />
          </Field>

          <Field label="Parent directory" required hint="Where to create the .squad/ scaffold.">
            <Input
              value={applyPath}
              onChange={(_, d) => {
                setApplyPath(d.value)
                setCreateParent(d.value)
              }}
              placeholder="/absolute/path/to/parent"
              input={{ style: { fontFamily: tokens.fontFamilyMonospace } }}
            />
          </Field>

          {applyBuiltinTemplate.error && (
            <Caption1 style={{ color: tokens.colorPaletteRedForeground1 }}>
              {applyBuiltinTemplate.error.message}
            </Caption1>
          )}

          <div style={{ display: 'flex', gap: tokens.spacingHorizontalS }}>
            <Button
              appearance="primary"
              size="small"
              disabled={!applyName.trim() || !applyPath.trim() || applyBuiltinTemplate.isPending}
              icon={applyBuiltinTemplate.isPending ? <Spinner size="tiny" /> : undefined}
              onClick={handleApply}
            >
              {applyBuiltinTemplate.isPending ? 'Creating…' : 'Create project'}
            </Button>
            <Button appearance="outline" size="small" onClick={() => setShowApplyForm(false)}>
              Back
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
