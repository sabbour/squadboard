/**
 * CeremonyList.tsx — Phase 10 page wrapper around <WorkflowList>.
 *
 * Replaces the old "Workflows" page; keeps the same column layout and adds
 * the trigger badge / kind chip via the underlying list component.
 */

import { useParams } from 'react-router'
import { useProject } from '../api/projects.ts'
import WorkflowList from '../components/workflows/WorkflowList.tsx'
import PageHeader from '../components/layout/PageHeader.tsx'

export default function CeremonyList() {
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
      <PageHeader
        eyebrow={project.name}
        title="Ceremonies"
        description="Workflows, narratives, and review policies — anything triggered by an event, schedule, or hand."
      />

      <div style={{ flex: 1, overflow: 'auto' }}>
        <WorkflowList projectId={projectId} />
      </div>
    </div>
  )
}
