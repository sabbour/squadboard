import type { AgentStat } from '../../api/analytics.ts'

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
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: '13px',
          color: 'var(--text)',
        }}
      >
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-muted)' }}>
            {['#', 'Agent', 'Runs this week', 'Success rate', 'Avg cost', 'Avg duration'].map((h) => (
              <th
                key={h}
                style={{
                  padding: '8px 12px',
                  textAlign: h === '#' || h === 'Agent' ? 'left' : 'right',
                  fontWeight: 500,
                  fontSize: '11px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  whiteSpace: 'nowrap',
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((agent, idx) => (
            <tr
              key={agent.id}
              style={{
                borderBottom: '1px solid var(--border)',
                background: idx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)',
              }}
            >
              <td style={{ padding: '10px 12px', color: 'var(--text-muted)', width: '32px' }}>
                {idx + 1}
              </td>
              <td style={{ padding: '10px 12px', fontWeight: 500 }}>{agent.name}</td>
              <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                <strong>{agent.runsThisWeek}</strong>
                <span style={{ color: 'var(--text-muted)', marginLeft: '4px' }}>
                  / {agent.runsTotal} total
                </span>
              </td>
              <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                <SuccessBadge rate={agent.successRate} />
              </td>
              <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'monospace' }}>
                {fmtCost(agent.avgCostUsd)}
              </td>
              <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'monospace' }}>
                {fmt(agent.avgDurationMs)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
