import type { AgentStat } from '../../api/analytics.ts'
import {
  Table,
  TableHeader,
  TableHeaderCell,
  TableBody,
  TableRow,
  TableCell,
  TableCellLayout,
} from '@fluentui/react-components'

interface Props {
  agents: AgentStat[]
}

function SuccessBadge({ rate }: { rate: number }) {
  const bg = rate >= 90 ? '#1a7f37' : rate >= 70 ? '#9a6700' : '#a12424'
  const color = '#fff'
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: '10px',
        fontSize: '11px',
        fontWeight: 600,
        background: bg,
        color,
        minWidth: '44px',
        textAlign: 'center',
      }}
    >
      {rate.toFixed(1)}%
    </span>
  )
}

function fmt(ms: number): string {
  if (ms === 0) return '—'
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60_000).toFixed(1)}m`
}

function fmtCost(usd: number): string {
  if (usd === 0) return '$0.00'
  if (usd < 0.001) return `$${(usd * 1000).toFixed(3)}m`
  return `$${usd.toFixed(4)}`
}

export default function AgentLeaderboard({ agents }: Props) {
  if (agents.length === 0) {
    return (
      <div style={{ padding: '24px', color: 'var(--text-muted)', fontSize: '13px' }}>
        No agents found for this project.
      </div>
    )
  }

  const sorted = [...agents].sort((a, b) => b.runsThisWeek - a.runsThisWeek || b.runsTotal - a.runsTotal)

  return (
    <div style={{ overflowX: 'auto' }}>
      <Table size="medium">
        <TableHeader>
          <TableRow>
            {['#', 'Agent', 'Runs this week', 'Success rate', 'Avg cost', 'Avg duration'].map((h) => (
              <TableHeaderCell
                key={h}
                style={{ textAlign: h === '#' || h === 'Agent' ? 'left' : 'right' }}
              >
                {h}
              </TableHeaderCell>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((agent, idx) => (
            <TableRow key={agent.id}>
              <TableCell style={{ width: '32px', color: 'var(--text-muted)' }}>{idx + 1}</TableCell>
              <TableCell>
                <TableCellLayout style={{ fontWeight: 500 }}>{agent.name}</TableCellLayout>
              </TableCell>
              <TableCell style={{ textAlign: 'right' }}>
                <strong>{agent.runsThisWeek}</strong>
                <span style={{ color: 'var(--text-muted)', marginLeft: '4px' }}>
                  / {agent.runsTotal} total
                </span>
              </TableCell>
              <TableCell style={{ textAlign: 'right' }}>
                <SuccessBadge rate={agent.successRate} />
              </TableCell>
              <TableCell style={{ textAlign: 'right', fontFamily: 'monospace' }}>
                {fmtCost(agent.avgCostUsd)}
              </TableCell>
              <TableCell style={{ textAlign: 'right', fontFamily: 'monospace' }}>
                {fmt(agent.avgDurationMs)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
