import { useParams } from 'react-router'
import { useProject } from '../api/projects.ts'
import WorkflowList from '../components/workflows/WorkflowList.tsx'

export default function Workflows() {
  const { id } = useParams<{ id: string }>()
  const projectId = id ?? ''

  const { data: project, isLoading, isError } = useProject(projectId)

  if (isLoading) {
    return <div style={{ padding: '32px', color: 'var(--text-muted)' }}>Loading project…</div>
  }

  if (isError || !project) {
    return (
      <div style={{ padding: '32px', color: 'var(--danger)' }}>
        Failed to load project.
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Page header */}
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
            {project.name} — Workflows
          </h1>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
            Define, edit, and attach YAML workflows to issues
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
          Demo 11
        </span>
      </div>

      {/* Workflow list */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        <WorkflowList projectId={projectId} />
      </div>
    </div>
  )
}
