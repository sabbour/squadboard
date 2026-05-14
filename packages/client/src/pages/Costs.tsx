import { useParams } from 'react-router'
import { useProject } from '../api/projects.ts'
import CostDashboard from '../components/costs/CostDashboard.tsx'

export default function Costs() {
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
            {project.name} — Costs
          </h1>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
            Month-to-date LLM spend across all agents and runs
          </p>
        </div>
        <span
          style={{
            marginLeft: 'auto',
          }}
        >
      </div>

      {/* Dashboard */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        <CostDashboard projectId={projectId} />
      </div>
    </div>
  )
}
