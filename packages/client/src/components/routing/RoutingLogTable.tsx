import { type RoutingLogEntry } from '../../api/routing.ts'
import { RoutingTierBadge } from './RoutingTierBadge.tsx'
import { formatDistanceToNow } from 'date-fns'
import {
  Table,
  TableHeader,
  TableHeaderCell,
  TableBody,
  TableRow,
  TableCell,
  TableCellLayout,
} from '@fluentui/react-components'

interface RoutingLogTableProps {
  entries: RoutingLogEntry[]
  isLoading?: boolean
}

export function RoutingLogTable({ entries, isLoading }: RoutingLogTableProps) {
  if (isLoading) {
    return (
      <div style={{ color: 'var(--text-muted)', fontSize: '13px', padding: '24px', textAlign: 'center' }}>
        Loading routing log…
      </div>
    )
  }

  if (entries.length === 0) {
    return (
      <div style={{ color: 'var(--text-muted)', fontSize: '13px', padding: '24px', textAlign: 'center' }}>
        No routing events yet — routes will appear here as issues are processed.
      </div>
    )
  }

  return (
    <div style={{ overflowX: 'auto', borderRadius: '6px', border: '1px solid var(--border)' }}>
      <Table size="small">
        <TableHeader>
          <TableRow>
            <TableHeaderCell>Time</TableHeaderCell>
            <TableHeaderCell>Issue</TableHeaderCell>
            <TableHeaderCell>Tier</TableHeaderCell>
            <TableHeaderCell>Matched Rule</TableHeaderCell>
            <TableHeaderCell>Agent</TableHeaderCell>
            <TableHeaderCell style={{ textAlign: 'right' }}>Score</TableHeaderCell>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((entry) => (
            <TableRow key={entry.id}>
              <TableCell>
                <TableCellLayout style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  {formatDistanceToNow(new Date(entry.timestamp), { addSuffix: true })}
                </TableCellLayout>
              </TableCell>
              <TableCell>
                <TableCellLayout
                  style={{
                    maxWidth: '200px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={entry.issueTitle}
                >
                  {entry.issueTitle}
                </TableCellLayout>
              </TableCell>
              <TableCell>
                <RoutingTierBadge tier={entry.tier} showLabel />
              </TableCell>
              <TableCell>
                <TableCellLayout style={{ color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: '11px' }}>
                  {entry.matchedRule ?? <span style={{ color: 'var(--text-muted)', opacity: 0.6 }}>—</span>}
                </TableCellLayout>
              </TableCell>
              <TableCell>
                {entry.agentName ?? <span style={{ color: 'var(--text-muted)' }}>Unassigned</span>}
              </TableCell>
              <TableCell style={{ textAlign: 'right' }}>
                <TableCellLayout style={{ color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: '11px' }}>
                  {entry.score != null ? entry.score.toFixed(2) : <span style={{ color: 'var(--text-muted)', opacity: 0.6 }}>—</span>}
                </TableCellLayout>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
