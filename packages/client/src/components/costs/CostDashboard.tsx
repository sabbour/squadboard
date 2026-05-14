import { useCostSummary, useBudget } from '../../api/costs.ts'

interface CostDashboardProps {
  projectId: string
}

function fmt(usd: number): string {
  return usd.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 4 })
}

function fmtShort(usd: number): string {
  return usd.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })
}

function fmtK(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

function BudgetBar({ percent, budgetUsd, spend }: { percent: number; budgetUsd: number; spend: number }) {
  const capped = Math.min(percent, 100)
  const color = percent > 95 ? '#f85149' : percent > 80 ? '#d29922' : '#3fb950'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#8b949e' }}>
        <span>MTD spend vs. budget</span>
        <span style={{ color: percent > 95 ? '#f85149' : '#e6edf3' }}>
          {fmtShort(spend)} / {fmtShort(budgetUsd)} ({percent.toFixed(0)}%)
        </span>
      </div>
      <div
        style={{
          height: '8px',
          borderRadius: '4px',
          background: '#21262d',
          overflow: 'hidden',
          border: '1px solid #30363d',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${capped}%`,
            background: color,
            borderRadius: '4px',
            transition: 'width 0.3s ease',
          }}
        />
      </div>
    </div>
  )
}

export default function CostDashboard({ projectId }: CostDashboardProps) {
  const { data: summary, isLoading: summaryLoading, isError: summaryError } = useCostSummary(projectId)
  const { data: budget, isLoading: budgetLoading } = useBudget(projectId)

  if (summaryLoading || budgetLoading) {
    return (
      <div style={{ padding: '32px', color: '#8b949e', fontSize: '13px' }}>Loading cost data…</div>
    )
  }

  if (summaryError || !summary) {
    return (
      <div style={{ padding: '32px', color: '#f85149', fontSize: '13px' }}>
        Failed to load cost data.
      </div>
    )
  }

  const overBudget = budget && budget.monthlyBudgetUsd !== null && budget.percentUsed > 100

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '24px', maxWidth: '900px' }}>

      {/* Budget exceeded alert */}
      {overBudget && (
        <div
          style={{
            background: 'rgba(248, 81, 73, 0.15)',
            border: '1px solid #f85149',
            borderRadius: '6px',
            padding: '12px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            fontSize: '13px',
            color: '#f85149',
          }}
        >
          <span style={{ fontSize: '16px' }}>⚠️</span>
          <span>
            <strong>Budget exceeded.</strong> Runs are paused until the budget is raised or the month resets.
            Spending {fmtShort(budget!.mtdSpend)} of {fmtShort(budget!.monthlyBudgetUsd!)} monthly budget.
          </span>
        </div>
      )}

      {/* MTD spend card */}
      <div
        style={{
          background: '#161b22',
          border: '1px solid #30363d',
          borderRadius: '8px',
          padding: '20px 24px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}
      >
        <span style={{ fontSize: '12px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#8b949e' }}>
          Month-to-date spend
        </span>
        <span style={{ fontSize: '36px', fontWeight: 700, letterSpacing: '-0.02em', color: '#e6edf3', fontVariantNumeric: 'tabular-nums' }}>
          {fmtShort(summary.totalMtd)}
        </span>

        {/* Budget progress bar — only when budget is set */}
        {budget && budget.monthlyBudgetUsd !== null && (
          <BudgetBar
            percent={budget.percentUsed}
            budgetUsd={budget.monthlyBudgetUsd}
            spend={budget.mtdSpend}
          />
        )}
      </div>

      {/* By Agent table */}
      <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: '8px', overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #30363d' }}>
          <span style={{ fontSize: '13px', fontWeight: 600, color: '#e6edf3' }}>By Agent</span>
        </div>
        {summary.byAgent.length === 0 ? (
          <div style={{ padding: '20px 16px', fontSize: '13px', color: '#8b949e' }}>No agent cost data yet.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #30363d' }}>
                {['Agent', 'Runs', 'Total Cost', 'Avg / Run'].map((h) => (
                  <th
                    key={h}
                    style={{
                      padding: '8px 16px',
                      textAlign: h === 'Agent' ? 'left' : 'right',
                      color: '#8b949e',
                      fontWeight: 500,
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {summary.byAgent.map((row) => (
                <tr
                  key={row.agentId}
                  style={{ borderBottom: '1px solid #21262d' }}
                >
                  <td style={{ padding: '10px 16px', color: '#e6edf3', fontWeight: 500 }}>{row.agentName}</td>
                  <td style={{ padding: '10px 16px', textAlign: 'right', color: '#8b949e' }}>{row.runs.toLocaleString()}</td>
                  <td style={{ padding: '10px 16px', textAlign: 'right', color: '#e6edf3', fontVariantNumeric: 'tabular-nums' }}>
                    {fmt(row.totalUsd)}
                  </td>
                  <td style={{ padding: '10px 16px', textAlign: 'right', color: '#8b949e', fontVariantNumeric: 'tabular-nums' }}>
                    {fmt(row.avgUsdPerRun)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* By Model table */}
      <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: '8px', overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #30363d' }}>
          <span style={{ fontSize: '13px', fontWeight: 600, color: '#e6edf3' }}>By Model</span>
        </div>
        {summary.byModel.length === 0 ? (
          <div style={{ padding: '20px 16px', fontSize: '13px', color: '#8b949e' }}>No model cost data yet.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #30363d' }}>
                {['Model', 'Runs', 'Tokens In', 'Tokens Out', 'Cost'].map((h) => (
                  <th
                    key={h}
                    style={{
                      padding: '8px 16px',
                      textAlign: h === 'Model' ? 'left' : 'right',
                      color: '#8b949e',
                      fontWeight: 500,
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {summary.byModel.map((row) => (
                <tr
                  key={row.model}
                  style={{ borderBottom: '1px solid #21262d' }}
                >
                  <td style={{ padding: '10px 16px', color: '#e6edf3', fontWeight: 500, fontFamily: 'monospace', fontSize: '11px' }}>
                    {row.model}
                  </td>
                  <td style={{ padding: '10px 16px', textAlign: 'right', color: '#8b949e' }}>{row.runs.toLocaleString()}</td>
                  <td style={{ padding: '10px 16px', textAlign: 'right', color: '#8b949e', fontVariantNumeric: 'tabular-nums' }}>
                    {fmtK(row.tokensIn)}
                  </td>
                  <td style={{ padding: '10px 16px', textAlign: 'right', color: '#8b949e', fontVariantNumeric: 'tabular-nums' }}>
                    {fmtK(row.tokensOut)}
                  </td>
                  <td style={{ padding: '10px 16px', textAlign: 'right', color: '#e6edf3', fontVariantNumeric: 'tabular-nums' }}>
                    {fmt(row.totalUsd)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
