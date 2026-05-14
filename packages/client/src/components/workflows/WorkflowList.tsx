import { useNavigate } from 'react-router'
import { useWorkflows } from '../../api/workflows.ts'

interface WorkflowListProps {
  projectId: string
}

export default function WorkflowList({ projectId }: WorkflowListProps) {
  const navigate = useNavigate()
  const { data: workflows, isLoading, isError } = useWorkflows(projectId)

  if (isLoading) {
    return <div style={{ padding: '24px', color: '#8b949e', fontSize: '13px' }}>Loading workflows…</div>
  }

  if (isError) {
    return <div style={{ padding: '24px', color: '#f85149', fontSize: '13px' }}>Failed to load workflows.</div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
      {/* Toolbar */}
      <div
        style={{
          padding: '12px 24px',
          borderBottom: '1px solid #30363d',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span style={{ fontSize: '13px', color: '#8b949e' }}>
          {workflows?.length ?? 0} workflow{workflows?.length !== 1 ? 's' : ''}
        </span>
        <button
          onClick={() => navigate(`/projects/${projectId}/workflows/new`)}
          style={{
            background: '#388bfd',
            color: '#fff',
            border: 'none',
            borderRadius: '5px',
            padding: '6px 14px',
            fontSize: '12px',
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          + New Workflow
        </button>
      </div>

      {/* Empty state */}
      {(!workflows || workflows.length === 0) && (
        <div
          style={{
            padding: '48px 24px',
            textAlign: 'center',
            color: '#484f58',
            fontSize: '13px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            alignItems: 'center',
          }}
        >
          <span style={{ fontSize: '28px' }}>⚙</span>
          <span>No workflows yet.</span>
          <button
            onClick={() => navigate(`/projects/${projectId}/workflows/new`)}
            style={{
              background: 'none',
              border: '1px solid #30363d',
              borderRadius: '5px',
              padding: '6px 16px',
              color: '#8b949e',
              fontSize: '12px',
              cursor: 'pointer',
            }}
          >
            Create your first workflow →
          </button>
        </div>
      )}

      {/* Workflow rows */}
      {workflows && workflows.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #30363d' }}>
              {['Name', 'Steps', 'Template', 'Created'].map((h) => (
                <th
                  key={h}
                  style={{
                    padding: '10px 24px',
                    textAlign: 'left',
                    color: '#8b949e',
                    fontWeight: 500,
                    fontSize: '12px',
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {workflows.map((wf) => {
              const stepCount = countSteps(wf.yamlContent)
              return (
                <tr
                  key={wf.id}
                  onClick={() => navigate(`/projects/${projectId}/workflows/${wf.id}`)}
                  style={{
                    borderBottom: '1px solid #21262d',
                    cursor: 'pointer',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#161b22')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <td style={{ padding: '12px 24px', color: '#e6edf3', fontWeight: 500 }}>
                    {wf.name}
                  </td>
                  <td style={{ padding: '12px 24px', color: '#8b949e' }}>
                    {stepCount} step{stepCount !== 1 ? 's' : ''}
                  </td>
                  <td style={{ padding: '12px 24px', color: '#8b949e', fontFamily: 'monospace', fontSize: '11px' }}>
                    {wf.templateSlug ?? '—'}
                  </td>
                  <td style={{ padding: '12px 24px', color: '#484f58', fontSize: '11px' }}>
                    {new Date(wf.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}

/** Count steps by looking for `- type:` lines in the YAML. */
function countSteps(yaml: string): number {
  return (yaml.match(/^\s*-\s+type:/gm) ?? []).length
}
