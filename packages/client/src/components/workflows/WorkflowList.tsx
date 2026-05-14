import { useNavigate } from 'react-router'
import { useWorkflows } from '../../api/workflows.ts'
import {
  Button,
  Table,
  TableHeader,
  TableHeaderCell,
  TableBody,
  TableRow,
  TableCell,
  TableCellLayout,
} from '@fluentui/react-components'

interface WorkflowListProps {
  projectId: string
}

export default function WorkflowList({ projectId }: WorkflowListProps) {
  const navigate = useNavigate()
  const { data: workflows, isLoading, isError } = useWorkflows(projectId)

  if (isLoading) {
    return <div style={{ padding: '24px', color: 'var(--text-muted)', fontSize: '13px' }}>Loading workflows…</div>
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
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
          {workflows?.length ?? 0} workflow{workflows?.length !== 1 ? 's' : ''}
        </span>
        <Button
          appearance="primary"
          size="small"
          onClick={() => navigate(`/projects/${projectId}/workflows/new`)}
        >
          + New Workflow
        </Button>
      </div>

      {/* Empty state */}
      {(!workflows || workflows.length === 0) && (
        <div
          style={{
            padding: '48px 24px',
            textAlign: 'center',
            color: 'var(--text-muted)',
            fontSize: '13px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            alignItems: 'center',
          }}
        >
          <span style={{ fontSize: '28px' }}>⚙</span>
          <span>No workflows yet.</span>
          <Button
            appearance="outline"
            size="small"
            onClick={() => navigate(`/projects/${projectId}/workflows/new`)}
          >
            Create your first workflow →
          </Button>
        </div>
      )}

      {/* Workflow rows */}
      {workflows && workflows.length > 0 && (
        <Table size="medium">
          <TableHeader>
            <TableRow>
              {['Name', 'Steps', 'Template', 'Created'].map((h) => (
                <TableHeaderCell key={h}>{h}</TableHeaderCell>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {workflows.map((wf) => {
              const stepCount = countSteps(wf.yamlContent)
              return (
                <TableRow
                  key={wf.id}
                  onClick={() => navigate(`/projects/${projectId}/workflows/${wf.id}`)}
                  style={{ cursor: 'pointer' }}
                >
                  <TableCell>
                    <TableCellLayout style={{ fontWeight: 500 }}>{wf.name}</TableCellLayout>
                  </TableCell>
                  <TableCell style={{ color: 'var(--text-muted)' }}>                    {stepCount} step{stepCount !== 1 ? 's' : ''}
                  </TableCell>
                  <TableCell style={{ color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: '11px' }}>
                    {wf.templateSlug ?? '—'}
                  </TableCell>
                  <TableCell style={{ color: 'var(--text-muted)', fontSize: '11px' }}>
                    {new Date(wf.createdAt).toLocaleDateString()}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}
    </div>
  )
}

/** Count steps by looking for `- type:` lines in the YAML. */
function countSteps(yaml: string): number {
  return (yaml.match(/^\s*-\s+type:/gm) ?? []).length
}
