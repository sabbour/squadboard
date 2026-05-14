import type { WorkflowStat } from '../../api/analytics.ts'

interface Props {
  workflows: WorkflowStat[]
  openReviews: number
}

function PassRateBar({ completed, total }: { completed: number; total: number }) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0
  const color = pct >= 80 ? '#1a7f37' : pct >= 50 ? '#9a6700' : '#a12424'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <div
        style={{
          flex: 1,
          height: '6px',
          background: 'var(--border)',
          borderRadius: '3px',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            background: color,
            borderRadius: '3px',
            transition: 'width 0.3s ease',
          }}
        />
      </div>
      <span style={{ fontSize: '11px', color: 'var(--text-muted)', minWidth: '32px', textAlign: 'right' }}>
        {pct}%
      </span>
    </div>
  )
}

function fmt(ms: number): string {
  if (ms === 0) return '—'
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60_000).toFixed(1)}m`
}

export default function WorkflowHealth({ workflows, openReviews }: Props) {
  return (
    <div>
      {/* Open reviews badge */}
      {openReviews > 0 && (
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            padding: '4px 12px',
            borderRadius: '12px',
            background: 'rgba(210, 120, 0, 0.15)',
            border: '1px solid rgba(210, 120, 0, 0.4)',
            color: '#d27800',
            fontSize: '12px',
            fontWeight: 600,
            marginBottom: '16px',
          }}
        >
          <span>⏳</span>
          {openReviews} open review{openReviews > 1 ? 's' : ''} awaiting decision
        </div>
      )}

      {workflows.length === 0 ? (
        <div style={{ color: 'var(--text-muted)', fontSize: '13px', padding: '8px 0' }}>
          No workflows found.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
          {workflows.map((wf) => (
            <div
              key={wf.id}
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                padding: '16px',
              }}
            >
              <div style={{ fontWeight: 600, fontSize: '14px', marginBottom: '12px', color: 'var(--text)' }}>
                {wf.name}
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Total runs</span>
                <span style={{ fontSize: '12px', fontWeight: 600 }}>{wf.runsTotal}</span>
              </div>

              <div style={{ marginBottom: '10px' }}>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>
                  Pass rate ({wf.completedRuns}/{wf.runsTotal})
                </div>
                <PassRateBar completed={wf.completedRuns} total={wf.runsTotal} />
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Avg duration</span>
                <span style={{ fontSize: '12px', fontFamily: 'monospace' }}>{fmt(wf.avgDurationMs)}</span>
              </div>

              {wf.failedRuns > 0 && (
                <div
                  style={{
                    marginTop: '10px',
                    fontSize: '11px',
                    color: '#a12424',
                    background: 'rgba(161, 36, 36, 0.1)',
                    borderRadius: '4px',
                    padding: '3px 8px',
                    display: 'inline-block',
                  }}
                >
                  {wf.failedRuns} failed
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
