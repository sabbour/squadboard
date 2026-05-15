import { useState } from 'react'
import { useCostSummary, useBudget, type CostSource } from '../../api/costs.ts'
import { Warning20Regular } from '@fluentui/react-icons'
import {
  Table,
  TableHeader,
  TableHeaderCell,
  TableBody,
  TableRow,
  TableCell,
  TableCellLayout,
  TabList,
  Tab,
  type SelectTabData,
  type SelectTabEvent,
} from '@fluentui/react-components'

interface CostDashboardProps {
  projectId: string
}

function fmt(usd: number | null | undefined): string {
  const v = Number.isFinite(usd) ? Number(usd) : 0
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 4 })
}

function fmtShort(usd: number | null | undefined): string {
  const v = Number.isFinite(usd) ? Number(usd) : 0
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })
}

function fmtK(n: number | null | undefined): string {
  const v = Number.isFinite(n) ? Number(n) : 0
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`
  return String(v)
}

function BudgetBar({ percent, budgetUsd, spend }: { percent: number; budgetUsd: number; spend: number }) {
  const capped = Math.min(percent, 100)
  const color = percent > 95 ? '#f85149' : percent > 80 ? '#d29922' : '#3fb950'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--text-muted)' }}>
        <span>MTD spend vs. budget</span>
        <span style={{ color: percent > 95 ? '#f85149' : 'var(--text)' }}>
          {fmtShort(spend)} / {fmtShort(budgetUsd)} ({percent.toFixed(0)}%)
        </span>
      </div>
      <div
        style={{
          height: '8px',
          borderRadius: '4px',
          background: 'var(--border)',
          overflow: 'hidden',
          border: '1px solid var(--border)',
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

type CostTab = 'runs' | 'consult' | 'all'

const TAB_TO_SOURCES: Record<CostTab, CostSource[]> = {
  runs: ['run', 'live_session'],
  consult: ['consult'],
  all: ['run', 'live_session', 'consult'],
}

export default function CostDashboard({ projectId }: CostDashboardProps) {
  const [tab, setTab] = useState<CostTab>('runs')
  const { data: summary, isLoading: summaryLoading, isError: summaryError } = useCostSummary(projectId, {
    sources: TAB_TO_SOURCES[tab],
  })
  const { data: budget, isLoading: budgetLoading } = useBudget(projectId)

  if (summaryLoading || budgetLoading) {
    return (
      <div style={{ padding: '32px', color: 'var(--text-muted)', fontSize: '13px' }}>Loading cost data…</div>
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

      {/* Source filter tabs */}
      <TabList
        selectedValue={tab}
        onTabSelect={(_e: SelectTabEvent, data: SelectTabData) => setTab(data.value as CostTab)}
      >
        <Tab value="runs">Runs &amp; Live</Tab>
        <Tab value="consult">Consult</Tab>
        <Tab value="all">All</Tab>
      </TabList>

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
          <span style={{ display: 'flex', color: '#f85149' }}><Warning20Regular /></span>
          <span>
            <strong>Budget exceeded.</strong> Runs are paused until the budget is raised or the month resets.
            Spending {fmtShort(budget!.mtdSpend)} of {fmtShort(budget!.monthlyBudgetUsd!)} monthly budget.
          </span>
        </div>
      )}

      {/* MTD spend card */}
      <div
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: '8px',
          padding: '20px 24px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}
      >
        <span style={{ fontSize: '12px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>
          Month-to-date spend
        </span>
        <span style={{ fontSize: '36px', fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
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
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px', overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
          <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)' }}>By Agent</span>
        </div>
        {summary.byAgent.length === 0 ? (
          <div style={{ padding: '20px 16px', fontSize: '13px', color: 'var(--text-muted)' }}>No agent cost data yet.</div>
        ) : (
          <Table size="small">
            <TableHeader>
              <TableRow>
                {['Agent', 'Runs', 'Total Cost', 'Avg / Run'].map((h) => (
                  <TableHeaderCell key={h} style={{ textAlign: h === 'Agent' ? 'left' : 'right' }}>
                    {h}
                  </TableHeaderCell>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {summary.byAgent.map((row) => (
                <TableRow key={row.agentId}>
                  <TableCell>
                    <TableCellLayout style={{ fontWeight: 500 }}>{row.agentName}</TableCellLayout>
                  </TableCell>
                  <TableCell style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{row.runs.toLocaleString()}</TableCell>
                  <TableCell style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {fmt(row.totalUsd)}
                  </TableCell>
                  <TableCell style={{ textAlign: 'right', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                    {fmt(row.avgUsdPerRun)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* By Model table */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px', overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
          <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)' }}>By Model</span>
        </div>
        {summary.byModel.length === 0 ? (
          <div style={{ padding: '20px 16px', fontSize: '13px', color: 'var(--text-muted)' }}>No model cost data yet.</div>
        ) : (
          <Table size="small">
            <TableHeader>
              <TableRow>
                {['Model', 'Runs', 'Tokens In', 'Tokens Out', 'Cost'].map((h) => (
                  <TableHeaderCell key={h} style={{ textAlign: h === 'Model' ? 'left' : 'right' }}>
                    {h}
                  </TableHeaderCell>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {summary.byModel.map((row) => (
                <TableRow key={row.model}>
                  <TableCell>
                    <TableCellLayout style={{ fontWeight: 500, fontFamily: 'monospace', fontSize: '11px' }}>
                      {row.model}
                    </TableCellLayout>
                  </TableCell>
                  <TableCell style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{row.runs.toLocaleString()}</TableCell>
                  <TableCell style={{ textAlign: 'right', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                    {fmtK(row.tokensIn)}
                  </TableCell>
                  <TableCell style={{ textAlign: 'right', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                    {fmtK(row.tokensOut)}
                  </TableCell>
                  <TableCell style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {fmt(row.totalUsd)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  )
}
