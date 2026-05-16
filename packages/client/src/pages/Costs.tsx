import { useParams } from 'react-router'
import { useProject } from '../api/projects.ts'
import CostDashboard from '../components/costs/CostDashboard.tsx'
import PageHeader from '../components/layout/PageHeader.tsx'
import { PageLoading } from '../components/loading/index.tsx'

export default function Costs() {
  const { id } = useParams<{ id: string }>()
  const projectId = id ?? ''

  const { data: project, isLoading, isError } = useProject(projectId)

  if (isLoading) {
    return <PageLoading label="Loading costs…" />
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
      <PageHeader
        eyebrow={project.name}
        title="Costs"
        description="Month-to-date LLM spend across all agents and runs."
      />

      <div style={{ flex: 1, overflow: 'auto' }}>
        <CostDashboard projectId={projectId} />
      </div>
    </div>
  )
}
