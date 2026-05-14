import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router'
import { Button, Title2, Title3, Body1, Dialog, DialogSurface, DialogBody, DialogTitle, DialogContent, DialogActions, tokens } from '@fluentui/react-components'
import { Folder20Regular } from '@fluentui/react-icons'
import { useProjects } from '../api/projects.ts'
import { useDiscoverSquad, useRegisterSquad, useInitSquad, useCreateSquad } from '../api/squad.ts'
import type { SquadDirectory } from '../api/squad.ts'
import ProjectCard from '../components/ProjectCard.tsx'

export default function ProjectPicker() {
  const navigate = useNavigate()
  const { data: projects, isLoading, isError } = useProjects()
  const [showModal, setShowModal] = useState(false)

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
        <Button
          appearance="primary"
          onClick={() => setShowModal(true)}
        >
          Add Project
        </Button>
      </div>

      {isLoading && (
        <p style={{ color: 'var(--text-muted)' }}>Loading projects…</p>
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
    </div>
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
  const [activeTab, setActiveTab] = useState<'discover' | 'connect' | 'create'>('discover')
  const tabLabels = { discover: 'Discover', connect: 'Connect existing', create: 'Create new' } as const

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
                borderBottom: '1px solid var(--border)',
                marginBottom: '16px',
              }}
            >
              {(['discover', 'connect', 'create'] as const).map((tab) => {
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
                    {tabLabels[tab]}
                  </button>
                )
              })}
            </div>

            {/* Tab body */}
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {activeTab === 'discover' && <DiscoverTab onCreated={onCreated} />}
              {activeTab === 'connect' && <ConnectTab onCreated={onCreated} />}
              {activeTab === 'create' && <CreateTab onCreated={onCreated} />}
            </div>
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={onClose}>Close</Button>
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
      <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '16px' }}>
        Scan the filesystem for existing <code style={{ fontFamily: 'monospace' }}>.squad/</code> directories.
      </p>

      <button
        onClick={() => void refetch()}
        disabled={isFetching}
        style={{
          background: 'none',
          border: '1px solid var(--border)',
          color: 'var(--text)',
          borderRadius: 'var(--radius)',
          padding: '6px 14px',
          fontSize: '13px',
          marginBottom: '16px',
        }}
      >
        {isFetching ? 'Scanning…' : 'Scan filesystem'}
      </button>

      {isDiscoverError && (
        <p style={{ color: 'var(--danger)', fontSize: '13px', marginBottom: '8px' }}>
          Scan failed: {discoverError?.message ?? 'Unknown error'}
        </p>
      )}

      {!isDiscoverError && dirs && dirs.length === 0 && (
        <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
          No .squad/ directories found on the filesystem.
        </p>
      )}

      {!isDiscoverError && dirs && dirs.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {dirs.map((dir) => (
            <button
              key={dir.path}
              onClick={() => handleSelect(dir)}
              disabled={isRegistering}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                background: 'var(--bg)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                padding: '10px 14px',
                color: 'var(--text)',
                textAlign: 'left',
                width: '100%',
              }}
            >
              <span style={{ fontWeight: 500 }}>{dir.name}</span>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                {dir.path}
              </span>
            </button>
          ))}
        </div>
      )}

      {registerError && (
        <p style={{ color: 'var(--danger)', marginTop: '12px', fontSize: '13px' }}>
          {registerError.message}
        </p>
      )}
    </div>
  )
}

function ConnectTab({ onCreated }: { onCreated: (id: string) => void }) {
  const [path, setPath] = useState('')
  const [name, setName] = useState('')
  const { mutate: initSquad, isPending, error } = useInitSquad()

  const errorMsg = error
    ? error.message.startsWith('API 409')
      ? 'A .squad/ directory already exists here — use Discover instead.'
      : error.message.startsWith('API 422')
        ? 'Directory not found — check the path.'
        : error.message
    : null

  function handleConnect() {
    if (!path.trim()) return
    initSquad(
      { path: path.trim(), projectName: name.trim() || undefined },
      { onSuccess: (res) => onCreated(res.projectId) },
    )
  }

  return (
    <div>
      <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '16px' }}>
        Scaffold a <code style={{ fontFamily: 'monospace' }}>.squad/</code> directory in an existing project folder.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div>
          <label style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
            Directory path
          </label>
          <input
            type="text"
            placeholder="/absolute/path/to/project"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleConnect() }}
            style={inputStyle}
          />
        </div>

        <div>
          <label style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
            Project name <span style={{ opacity: 0.6 }}>(optional)</span>
          </label>
          <input
            type="text"
            placeholder="my-project"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={inputStyle}
          />
        </div>

        {errorMsg && (
          <p style={{ color: 'var(--danger)', fontSize: '13px', margin: 0 }}>{errorMsg}</p>
        )}

        <button
          onClick={handleConnect}
          disabled={!path.trim() || isPending}
          style={primaryButtonStyle}
        >
          {isPending ? 'Connecting…' : 'Connect'}
        </button>
      </div>
    </div>
  )
}

function CreateTab({ onCreated }: { onCreated: (id: string) => void }) {
  const [parentPath, setParentPath] = useState('')
  const [projectName, setProjectName] = useState('')
  const { mutate: createSquad, isPending, error } = useCreateSquad()

  // Default parentPath to the server's home directory on mount
  useEffect(() => {
    fetch('/api/squad/home')
      .then((r) => r.json())
      .then((data: { path: string }) => {
        if (data.path) setParentPath(data.path)
      })
      .catch(() => { /* ignore, user can type manually */ })
  }, [])

  // Parse the structured error message from the API
  const errorMsg = (() => {
    if (!error) return null
    const m = error.message.match(/^API \d+: (.+)$/)
    if (m) {
      try {
        const body = JSON.parse(m[1]) as { error?: string }
        if (body.error) return body.error
      } catch { /* fall through */ }
    }
    return error.message
  })()

  const preview = parentPath.trim() && projectName.trim()
    ? `${parentPath.trim().replace(/\/$/, '')}/${projectName.trim()}/.squad/`
    : null

  function handleCreate() {
    if (!parentPath.trim() || !projectName.trim()) return
    createSquad(
      { parentPath: parentPath.trim(), projectName: projectName.trim() },
      { onSuccess: (res) => onCreated(res.projectId) },
    )
  }

  return (
    <div>
      <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '16px' }}>
        Create a new directory with a <code style={{ fontFamily: 'monospace' }}>.squad/</code> scaffold inside it.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div>
          <label style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
            Parent directory
          </label>
          <input
            type="text"
            placeholder="/absolute/path/to/parent"
            value={parentPath}
            onChange={(e) => setParentPath(e.target.value)}
            style={inputStyle}
          />
        </div>

        <div>
          <label style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
            Project name
          </label>
          <input
            type="text"
            placeholder="my-new-project"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreate() }}
            style={inputStyle}
          />
        </div>

        {preview && (
          <div
            style={{
              background: 'var(--bg)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              padding: '8px 12px',
              fontSize: '12px',
              fontFamily: 'monospace',
              color: 'var(--text-muted)',
            }}
          >
            Will create: <span style={{ color: 'var(--accent)' }}>{preview}</span>
          </div>
        )}

        {errorMsg && (
          <p style={{ color: 'var(--danger)', fontSize: '13px', margin: 0 }}>{errorMsg}</p>
        )}

        <button
          onClick={handleCreate}
          disabled={!parentPath.trim() || !projectName.trim() || isPending}
          style={primaryButtonStyle}
        >
          {isPending ? 'Creating…' : 'Create project'}
        </button>
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

const primaryButtonStyle: React.CSSProperties = {
  background: 'var(--accent)',
  color: '#fff',
  border: 'none',
  borderRadius: 'var(--radius)',
  padding: '8px 16px',
  fontWeight: 500,
  fontSize: '13px',
  alignSelf: 'flex-start',
}
