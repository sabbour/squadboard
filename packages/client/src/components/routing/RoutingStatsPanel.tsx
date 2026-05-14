import { type RoutingStats } from '../../api/routing.ts'

interface RoutingStatsPanelProps {
  stats: RoutingStats
  isLoading?: boolean
}

function StatCard({
  label,
  count,
  sub,
  color,
  bg,
  border,
}: {
  label: string
  count: number
  sub?: string
  color: string
  bg: string
  border: string
}) {
  return (
    <div
      style={{
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: '8px',
        padding: '14px 16px',
        flex: 1,
        minWidth: '100px',
      }}
    >
      <div style={{ fontSize: '24px', fontWeight: 700, color, fontFamily: 'monospace', lineHeight: 1 }}>
        {count}
      </div>
      <div style={{ fontSize: '12px', fontWeight: 600, color, marginTop: '4px' }}>{label}</div>
      {sub && <div style={{ fontSize: '11px', color: '#8b949e', marginTop: '2px' }}>{sub}</div>}
    </div>
  )
}

function TierBar({ stats }: { stats: RoutingStats }) {
  const total = stats.total || 1
  const t1Pct = (stats.tier1Count / total) * 100
  const t2Pct = (stats.tier2Count / total) * 100
  const t3Pct = (stats.tier3Count / total) * 100
  const triagePct = (stats.triageCount / total) * 100

  const segments = [
    { pct: t1Pct, color: '#58a6ff', label: 'T1' },
    { pct: t2Pct, color: '#d29922', label: 'T2' },
    { pct: t3Pct, color: '#bc8cff', label: 'T3' },
    { pct: triagePct, color: '#f85149', label: 'Triage' },
  ].filter((s) => s.pct > 0)

  return (
    <div>
      <div style={{ fontSize: '11px', color: '#8b949e', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Tier Distribution
      </div>

      {/* Stacked bar */}
      <div
        style={{
          display: 'flex',
          height: '12px',
          borderRadius: '6px',
          overflow: 'hidden',
          background: '#21262d',
          border: '1px solid #30363d',
        }}
      >
        {segments.map((seg) => (
          <div
            key={seg.label}
            title={`${seg.label}: ${seg.pct.toFixed(1)}%`}
            style={{
              width: `${seg.pct}%`,
              background: seg.color,
              transition: 'width 0.3s ease',
            }}
          />
        ))}
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: '12px', marginTop: '8px', flexWrap: 'wrap' }}>
        {segments.map((seg) => (
          <div key={seg.label} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <div style={{ width: '8px', height: '8px', borderRadius: '2px', background: seg.color }} />
            <span style={{ fontSize: '11px', color: '#8b949e' }}>
              {seg.label} — {seg.pct.toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function RoutingStatsPanel({ stats, isLoading }: RoutingStatsPanelProps) {
  if (isLoading) {
    return (
      <div style={{ color: 'var(--text-muted)', fontSize: '13px', padding: '16px' }}>
        Loading stats…
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Stat cards */}
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
        <StatCard
          label="Tier 1 — Deterministic"
          count={stats.tier1Count}
          color="#58a6ff"
          bg="rgba(88,166,255,0.08)"
          border="rgba(88,166,255,0.25)"
        />
        <StatCard
          label="Tier 2 — Keyword"
          count={stats.tier2Count}
          sub={stats.tier2AvgScore != null ? `Avg score: ${stats.tier2AvgScore.toFixed(2)}` : undefined}
          color="#d29922"
          bg="rgba(210,153,34,0.08)"
          border="rgba(210,153,34,0.25)"
        />
        <StatCard
          label="Tier 3 — LLM"
          count={stats.tier3Count}
          color="#bc8cff"
          bg="rgba(188,140,255,0.08)"
          border="rgba(188,140,255,0.25)"
        />
        {stats.triageCount > 0 && (
          <StatCard
            label="Human Triage"
            count={stats.triageCount}
            color="#f85149"
            bg="rgba(248,81,73,0.08)"
            border="rgba(248,81,73,0.25)"
          />
        )}
      </div>

      {/* Bar chart */}
      {stats.total > 0 && <TierBar stats={stats} />}
    </div>
  )
}
