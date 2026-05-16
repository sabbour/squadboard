import { type RoutingLogEntry } from '../../api/routing.ts'
import { RoutingTierBadge } from './RoutingTierBadge.tsx'
import { safeRelativeTime } from '../../utils/dates.ts'
import {
  Body1,
  Table,
  TableHeader,
  TableHeaderCell,
  TableBody,
  TableRow,
  TableCell,
  TableCellLayout,
  tokens,
} from '@fluentui/react-components'

interface RoutingLogTableProps {
  entries: RoutingLogEntry[]
  isLoading?: boolean
}

export function RoutingLogTable({ entries, isLoading }: RoutingLogTableProps) {
  if (isLoading) {
    return (
      <Body1 style={{ display: 'block', color: tokens.colorNeutralForeground3, padding: '24px', textAlign: 'center' }}>
        Loading routing log…
      </Body1>
    )
  }

  if (!Array.isArray(entries) || entries.length === 0) {
    return (
      <Body1 style={{ display: 'block', color: tokens.colorNeutralForeground3, padding: '24px', textAlign: 'center' }}>
        No routing events yet — routes will appear here as issues are processed.
      </Body1>
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
                <TableCellLayout style={{ color: tokens.colorNeutralForeground3, whiteSpace: 'nowrap' }}>
                  {safeRelativeTime(entry.timestamp)}
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
                <TableCellLayout style={{ color: tokens.colorNeutralForeground3, fontFamily: tokens.fontFamilyMonospace, fontSize: '11px' }}>
                  {entry.matchedRule ?? <span style={{ color: tokens.colorNeutralForeground3, opacity: 0.6 }}>—</span>}
                </TableCellLayout>
              </TableCell>
              <TableCell>
                {entry.agentName ?? <span style={{ color: tokens.colorNeutralForeground3 }}>Unassigned</span>}
              </TableCell>
              <TableCell style={{ textAlign: 'right' }}>
                <TableCellLayout style={{ color: tokens.colorNeutralForeground3, fontFamily: tokens.fontFamilyMonospace, fontSize: '11px' }}>
                  {typeof entry.score === 'number' ? entry.score.toFixed(2) : entry.score != null ? Number(entry.score).toFixed(2) : <span style={{ color: tokens.colorNeutralForeground3, opacity: 0.6 }}>—</span>}
                </TableCellLayout>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
