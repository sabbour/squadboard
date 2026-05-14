import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useProjects } from '../api/projects.ts'
import { useDiscoverSquad, useRegisterSquad } from '../api/squad.ts'
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
          <h1 style={{ fontSize: '20px', fontWeight: 600, color: 'var(--text)' }}>Projects</h1>
          <p style={{ color: 'var(--text-muted)', marginTop: '4px' }}>
            Select a project to open its board, or connect a new .squad/ directory.
          </p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          style={{
            background: 'var(--accent)',
            color: '#fff',
            border: 'none',
            borderRadius: 'var(--radius)',
            padding: '8px 16px',
            fontWeight: 500,
            fontSize: '14px',
          }}
        >
          Add Project
        </button>
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
      <div style={{ fontSize: '32px', marginBottom: '16px' }}>📁</div>
      <h2 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '8px' }}>No projects yet</h2>
      <p style={{ color: 'var(--text-muted)', maxWidth: '320px', marginBottom: '24px' }}>
        Connect a <code style={{ fontFamily: 'monospace', color: 'var(--accent)' }}>.squad/</code>{' '}
        directory to get started. Squadboard will discover your agents and workflows automatically.
      </p>
      <button
        onClick={onDiscover}
        style={{
          background: 'var(--accent)',
          color: '#fff',
          border: 'none',
          borderRadius: 'var(--radius)',
          padding: '10px 20px',
          fontWeight: 500,
          fontSize: '14px',
        }}
      >
        Discover .squad/ directories
      </button>
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
  const { data: dirs, isFetching, refetch } = useDiscoverSquad()
  const { mutate: register, isPending: isRegistering, error: registerError } = useRegisterSquad()
  const [manualPath, setManualPath] = useState('')
  const [manualName, setManualName] = useState('')

  function handleDiscover() {
    void refetch()
  }

  function handleSelect(dir: SquadDirectory) {
    register(
      { path: dir.path, projectName: dir.name },
      { onSuccess: (res) => onCreated(res.projectId) },
    )
  }

  function handleManualRegister() {
    if (!manualPath.trim()) return
    register(
      { path: manualPath.trim(), projectName: manualName.trim() || undefined },
      { onSuccess: (res) => onCreated(res.projectId) },
    )
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          width: '560px',
          maxWidth: '90vw',
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 20px',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <h2 style={{ fontSize: '16px', fontWeight: 600 }}>Connect a .squad/ directory</h2>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              fontSize: '18px',
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '20px', overflowY: 'auto', flex: 1 }}>
          {/* Auto-discover */}
          <div style={{ marginBottom: '24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
              <h3 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Auto-discover
              </h3>
              <button
                onClick={handleDiscover}
                disabled={isFetching}
                style={{
                  background: 'none',
                  border: '1px solid var(--border)',
                  color: 'var(--text)',
                  borderRadius: 'var(--radius)',
                  padding: '4px 10px',
                  fontSize: '12px',
                }}
              >
                {isFetching ? 'Scanning…' : 'Scan filesystem'}
              </button>
            </div>

            {dirs && dirs.length === 0 && (
              <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
                No .squad/ directories found on the filesystem.
              </p>
            )}

            {dirs && dirs.length > 0 && (
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
          </div>

          {/* Manual entry */}
          <div>
            <h3 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '12px' }}>
              Manual entry
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <input
                type="text"
                placeholder="Project name (optional)"
                value={manualName}
                onChange={(e) => setManualName(e.target.value)}
                style={{
                  background: 'var(--bg)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                  padding: '8px 12px',
                  color: 'var(--text)',
                  width: '100%',
                  outline: 'none',
                }}
              />
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  placeholder="/absolute/path/to/.squad"
                  value={manualPath}
                  onChange={(e) => setManualPath(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleManualRegister() }}
                  style={{
                    background: 'var(--bg)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)',
                    padding: '8px 12px',
                    color: 'var(--text)',
                    flex: 1,
                    fontFamily: 'monospace',
                    outline: 'none',
                  }}
                />
                <button
                  onClick={handleManualRegister}
                  disabled={!manualPath.trim() || isRegistering}
                  style={{
                    background: 'var(--accent)',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 'var(--radius)',
                    padding: '8px 14px',
                    fontWeight: 500,
                    fontSize: '13px',
                  }}
                >
                  {isRegistering ? 'Connecting…' : 'Connect'}
                </button>
              </div>
            </div>
          </div>

          {registerError && (
            <p style={{ color: 'var(--danger)', marginTop: '12px', fontSize: '13px' }}>
              {registerError.message}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
