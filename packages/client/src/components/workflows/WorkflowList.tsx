import { useNavigate } from 'react-router'
import { useWorkflows } from '../../api/workflows.ts'
import { useDraftCeremonies } from '../../api/ceremonies.ts'
import {
  Button,
  Badge,
  Table,
  TableHeader,
  TableHeaderCell,
  TableBody,
  TableRow,
  TableCell,
  TableCellLayout,
} from '@fluentui/react-components'
import { Settings20Regular } from '@fluentui/react-icons'

interface WorkflowListProps {
  projectId: string
}

export default function WorkflowList({ projectId }: WorkflowListProps) {
  const navigate = useNavigate()
  const { data: workflows, isLoading, isError } = useWorkflows(projectId)
  const { data: drafts } = useDraftCeremonies(projectId)
  const draftCount = drafts?.length ?? 0

  if (isLoading) {
    return <div style={{ padding: '24px', color: 'var(--text-muted)', fontSize: '13px' }}>Loading ceremonies…</div>
  }

  if (isError) {
    return <div style={{ padding: '24px', color: '#f85149', fontSize: '13px' }}>Failed to load ceremonies.</div>
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
          gap: 12,
        }}
      >
        <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
          {workflows?.length ?? 0} ceremon{workflows?.length === 1 ? 'y' : 'ies'}
        </span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {draftCount > 0 && (
            <Button
              appearance="outline"
              size="small"
              onClick={() => navigate(`/projects/${projectId}/ceremonies/review`)}
            >
              Review drafts
              <Badge appearance="filled" color="brand" size="small" style={{ marginLeft: 6 }}>
                {draftCount}
              </Badge>
            </Button>
          )}
          <Button
            appearance="primary"
            size="small"
            onClick={() => navigate(`/projects/${projectId}/ceremonies/new`)}
          >
            + New Ceremony
          </Button>
        </div>
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
          <Settings20Regular style={{ width: 28, height: 28 }} />
          <span>No ceremonies yet.</span>
          <Button
            appearance="outline"
            size="small"
            onClick={() => navigate(`/projects/${projectId}/ceremonies/new`)}
          >
            Create your first ceremony →
          </Button>
        </div>
      )}

      {/* Workflow rows */}
      {workflows && workflows.length > 0 && (
        <Table size="medium">
          <TableHeader>
            <TableRow>
              {['Name', 'Trigger', 'Kind', 'Created'].map((h) => (
                <TableHeaderCell key={h}>{h}</TableHeaderCell>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {workflows.map((wf) => {
              return (
                <TableRow
                  key={wf.id}
                  onClick={() => navigate(`/projects/${projectId}/ceremonies/${wf.id}`)}
                  style={{ cursor: 'pointer' }}
                >
                  <TableCell>
                    <TableCellLayout style={{ fontWeight: 500 }}>{wf.name}</TableCellLayout>
                  </TableCell>
                  <TableCell style={{ color: 'var(--text-muted)' }}>
                    {wf.triggerKind ?? '—'}
                  </TableCell>
                  <TableCell style={{ color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: '11px' }}>
                    {wf.kind ?? '—'}
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
