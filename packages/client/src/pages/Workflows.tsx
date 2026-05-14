import { useParams } from 'react-router'
import { useProject } from '../api/projects.ts'
import WorkflowList from '../components/workflows/WorkflowList.tsx'
import { Subtitle1, Caption1 } from '@fluentui/react-components'

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
          <Subtitle1 as="h1">{project.name} — Workflows</Subtitle1>
          <Caption1 style={{ color: 'var(--text-muted)', marginTop: '2px', display: 'block' }}>
            Define, edit, and attach YAML workflows to issues
          </Caption1>
        </div>
        <span
          style={{
            marginLeft: 'auto',
          }}
        />
      </div>

      {/* Workflow list */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        <WorkflowList projectId={projectId} />
      </div>
    </div>
  )
}
