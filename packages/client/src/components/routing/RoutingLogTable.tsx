import { type RoutingLogEntry } from '../../api/routing.ts'
import { RoutingTierBadge } from './RoutingTierBadge.tsx'
import { formatDistanceToNow } from 'date-fns'

const TIER_ROW_BG: Record<string, string> = {
  T1: 'rgba(88,166,255,0.04)',
  T2: 'rgba(210,153,34,0.04)',
  T3: 'rgba(188,140,255,0.04)',
}

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

  const thStyle: React.CSSProperties = {
    padding: '6px 12px',
    fontSize: '11px',
    fontWeight: 600,
    color: '#8b949e',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    background: '#161b22',
    borderBottom: '1px solid #30363d',
    textAlign: 'left',
    whiteSpace: 'nowrap',
  }

  return (
    <div style={{ overflowX: 'auto', borderRadius: '6px', border: '1px solid #30363d' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
        <thead>
          <tr>
            <th style={thStyle}>Time</th>
            <th style={thStyle}>Issue</th>
            <th style={thStyle}>Tier</th>
            <th style={thStyle}>Matched Rule</th>
            <th style={thStyle}>Agent</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Score</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry, i) => (
            <tr
              key={entry.id}
              style={{
                background: i % 2 === 0 ? TIER_ROW_BG[entry.tier] ?? 'transparent' : 'transparent',
                borderBottom: i < entries.length - 1 ? '1px solid #21262d' : 'none',
              }}
            >
              <td style={{ padding: '7px 12px', color: '#8b949e', whiteSpace: 'nowrap' }}>
                {formatDistanceToNow(new Date(entry.timestamp), { addSuffix: true })}
              </td>
              <td style={{ padding: '7px 12px', color: '#e6edf3', maxWidth: '200px' }}>
                <span
                  style={{
                    display: 'block',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={entry.issueTitle}
                >
                  {entry.issueTitle}
                </span>
              </td>
              <td style={{ padding: '7px 12px' }}>
                <RoutingTierBadge tier={entry.tier} showLabel />
              </td>
              <td style={{ padding: '7px 12px', color: '#8b949e', fontFamily: 'monospace', fontSize: '11px' }}>
                {entry.matchedRule ?? <span style={{ color: '#484f58' }}>—</span>}
              </td>
              <td style={{ padding: '7px 12px', color: '#e6edf3' }}>
                {entry.agentName ?? <span style={{ color: '#484f58' }}>Unassigned</span>}
              </td>
              <td style={{ padding: '7px 12px', color: '#8b949e', textAlign: 'right', fontFamily: 'monospace', fontSize: '11px' }}>
                {entry.score != null ? entry.score.toFixed(2) : <span style={{ color: '#484f58' }}>—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
