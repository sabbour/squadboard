import { useParams } from 'react-router'
import { useProject } from '../api/projects.ts'
import EmptyBoard from '../components/EmptyBoard.tsx'

export default function Board() {
  const { id } = useParams<{ id: string }>()
  const { data: project, isLoading, isError } = useProject(id ?? '')

  if (isLoading) {
    return (
      <div style={{ padding: '32px', color: 'var(--text-muted)' }}>Loading project…</div>
    )
  }

  if (isError || !project) {
    return (
      <div style={{ padding: '32px', color: 'var(--danger)' }}>
        Failed to load project. Make sure the backend is running.
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Board header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
          padding: '16px 24px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}
      >
        <div>
          <h1 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--text)' }}>
            {project.name}
          </h1>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: 'monospace', marginTop: '2px' }}>
            {project.squadPath}
          </p>
        </div>
        <span
          style={{
            marginLeft: 'auto',
            fontSize: '11px',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: '4px',
            padding: '3px 8px',
            color: 'var(--text-muted)',
          }}
        >
          Demo 1
        </span>
      </div>

      {/* Board body */}
      <div style={{ flex: 1, overflow: 'auto', padding: '24px' }}>
        <EmptyBoard />
      </div>
    </div>
  )
}
