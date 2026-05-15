import { useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useProject } from '../api/projects.ts'
import {
  useProjectOverview,
  useThroughput,
  useAgentStats,
  useWorkflowStats,
  type ThroughputDay,
} from '../api/analytics.ts'
import { useBudget } from '../api/costs.ts'
import { useProjectFlow } from '../api/flow.ts'
import AgentLeaderboard from '../components/dashboard/AgentLeaderboard.tsx'
import WorkflowHealth from '../components/dashboard/WorkflowHealth.tsx'
import PageHeader from '../components/layout/PageHeader.tsx'
import { Caption1, Body1, tokens } from '@fluentui/react-components'

// ---------------------------------------------------------------------------
// Stat card
// ---------------------------------------------------------------------------
interface StatCardProps {
  label: string
  value: string | number
  sub?: string
  subColor?: string
  accent?: boolean
}

function StatCard({ label, value, sub, subColor, accent }: StatCardProps) {
  return (
    <div
      style={{
        flex: '1 1 180px',
        minWidth: 0,
        background: 'var(--surface)',
        border: `1px solid ${accent ? 'var(--accent)' : 'var(--border)'}`,
        borderRadius: '10px',
        padding: '18px 20px',
      }}
    >
      <Caption1
        style={{
          display: 'block',
          fontSize: '11px',
          color: tokens.colorNeutralForeground3,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          marginBottom: tokens.spacingVerticalS,
          fontWeight: tokens.fontWeightMedium,
        }}
      >
        {label}
      </Caption1>
      <div style={{ fontSize: '26px', fontWeight: tokens.fontWeightBold, color: tokens.colorNeutralForeground1, lineHeight: 1 }}>
        {value}
      </div>
      {sub && (
        <Caption1 style={{ display: 'block', fontSize: '11px', marginTop: tokens.spacingVerticalSNudge, color: subColor ?? tokens.colorNeutralForeground3 }}>
          {sub}
        </Caption1>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Throughput SVG chart
// ---------------------------------------------------------------------------
const CHART_H = 160
const CHART_W = 600
const PAD = { top: 12, right: 16, bottom: 32, left: 36 }

function ThroughputChart({ days }: { days: ThroughputDay[] }) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; day: ThroughputDay } | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  if (days.length === 0) return null

  const maxVal = Math.max(1, ...days.map((d) => Math.max(d.done, d.created)))
  const innerW = CHART_W - PAD.left - PAD.right
  const innerH = CHART_H - PAD.top - PAD.bottom

  const xOf = (i: number) => PAD.left + (i / (days.length - 1)) * innerW
  const yOf = (v: number) => PAD.top + innerH - (v / maxVal) * innerH

  const makePath = (vals: number[]) =>
    vals
      .map((v, i) => `${i === 0 ? 'M' : 'L'}${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`)
      .join(' ')

  // Y-axis ticks (0, mid, max)
  const yTicks = [0, Math.ceil(maxVal / 2), maxVal]

  // X-axis labels every 7 days
  const xLabels = days.filter((_, i) => i % 7 === 0 || i === days.length - 1)

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    const relX = e.clientX - rect.left - PAD.left
    const idx = Math.min(days.length - 1, Math.max(0, Math.round((relX / innerW) * (days.length - 1))))
    setTooltip({ x: xOf(idx), y: e.clientY - rect.top, day: days[idx] })
  }

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        style={{ width: '100%', height: 'auto', display: 'block', cursor: 'crosshair' }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setTooltip(null)}
      >
        {/* Y grid lines + labels */}
        {yTicks.map((v) => {
          const y = yOf(v)
          return (
            <g key={v}>
              <line
                x1={PAD.left} y1={y} x2={CHART_W - PAD.right} y2={y}
                stroke="var(--border)" strokeWidth="1" strokeDasharray="3,3"
              />
              <text x={PAD.left - 4} y={y + 4} textAnchor="end" fill="var(--text-muted)" fontSize="9">
                {v}
              </text>
            </g>
          )
        })}

        {/* X axis labels */}
        {xLabels.map((d, i) => {
          const idx = days.indexOf(d)
          return (
            <text
              key={i}
              x={xOf(idx)}
              y={CHART_H - 4}
              textAnchor="middle"
              fill="var(--text-muted)"
              fontSize="9"
            >
              {d.date.slice(5)} {/* MM-DD */}
            </text>
          )
        })}

        {/* Created line (blue) */}
        <path
          d={makePath(days.map((d) => d.created))}
          fill="none"
          stroke="#388bfd"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Done line (green) */}
        <path
          d={makePath(days.map((d) => d.done))}
          fill="none"
          stroke="#3fb950"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Hover crosshair */}
        {tooltip && (
          <line
            x1={tooltip.x} y1={PAD.top}
            x2={tooltip.x} y2={CHART_H - PAD.bottom}
            stroke="var(--text-muted)"
            strokeWidth="1"
            strokeDasharray="3,2"
          />
        )}
      </svg>

      {/* Tooltip */}
      {tooltip && (
        <div
          style={{
            position: 'absolute',
            top: Math.max(0, tooltip.y - 60),
            left: `clamp(0px, calc(${((tooltip.x - PAD.left) / (CHART_W - PAD.left - PAD.right)) * 100}% - 60px), calc(100% - 130px))`,
            pointerEvents: 'none',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: '6px',
            padding: '6px 10px',
            fontSize: '11px',
            lineHeight: '1.6',
            zIndex: 10,
            minWidth: '120px',
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: '2px', color: 'var(--text)' }}>
            {tooltip.day.date}
          </div>
          <div style={{ color: '#3fb950' }}>✔ Done: {tooltip.day.done}</div>
          <div style={{ color: '#388bfd' }}>＋ Created: {tooltip.day.created}</div>
        </div>
      )}

      {/* Legend */}
      <div style={{ display: 'flex', gap: '16px', marginTop: '8px', fontSize: '11px', color: 'var(--text-muted)' }}>
        <span><span style={{ color: '#3fb950' }}>●</span> Done</span>
        <span><span style={{ color: '#388bfd' }}>●</span> Created</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Section wrapper
// ---------------------------------------------------------------------------
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: tokens.spacingVerticalXXXL }}>
      <Caption1
        as="h2"
        style={{
          display: 'block',
          color: tokens.colorNeutralForeground3,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          fontWeight: tokens.fontWeightSemibold,
          marginBottom: tokens.spacingVerticalM,
        }}
      >
        {title}
      </Caption1>
      {children}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Dashboard page
// ---------------------------------------------------------------------------
export default function Dashboard() {
  const { id } = useParams<{ id: string }>()
  const projectId = id ?? ''

  const { data: project } = useProject(projectId)
  const { data: overview, isLoading: overviewLoading } = useProjectOverview(projectId)
  const { data: throughput, isLoading: throughputLoading } = useThroughput(projectId)
  const { data: agentStats, isLoading: agentsLoading } = useAgentStats(projectId)
  const { data: workflowStats, isLoading: workflowsLoading } = useWorkflowStats(projectId)
  const { data: budget } = useBudget(projectId)
  const { data: flow } = useProjectFlow(projectId)
  const navigate = useNavigate()

  // WoW change formatting
  const wowPct = overview ? Math.abs(overview.weekOverWeekChange * 100).toFixed(1) : null
  const wowUp = overview ? overview.weekOverWeekChange >= 0 : true
  const wowStr = wowPct != null ? `${wowUp ? '▲' : '▼'} ${wowPct}% WoW` : undefined
  const wowColor = wowPct != null ? (wowUp ? '#3fb950' : '#f85149') : undefined

  // Cost MTD with budget %
  const costStr = overview ? `$${overview.totalCostMtd.toFixed(2)}` : '—'
  const budgetSub = budget?.monthlyBudgetUsd
    ? `${budget.percentUsed.toFixed(1)}% of $${budget.monthlyBudgetUsd} budget`
    : undefined

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <PageHeader
        eyebrow={project?.name}
        title="Dashboard"
        description="Live project health · auto-refreshes every 30 s"
      />

      {/* Scrollable body */}
      <div style={{ flex: 1, overflow: 'auto', padding: '24px' }}>

        {/* Phase 12 — Now view: live activity + jump to project flow board */}
        <Section title="Now">
          <button
            type="button"
            onClick={() => navigate(`/projects/${projectId}/flow`)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              width: '100%',
              textAlign: 'left',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 10,
              padding: '16px 20px',
              cursor: 'pointer',
              color: 'var(--text)',
              transition: 'border-color 100ms ease-out',
            }}
            onMouseEnter={(e) => {
              ;(e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--accent, #388bfd)'
            }}
            onMouseLeave={(e) => {
              ;(e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)'
            }}
          >
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 8,
                background: 'rgba(56, 139, 253, 0.15)',
                color: '#58a6ff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 20,
                flexShrink: 0,
              }}
              aria-hidden
            >
              ⌥
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>Project Flow board</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {flow
                  ? `${flow.activeRunsCount} active run${flow.activeRunsCount === 1 ? '' : 's'} · ${flow.pendingReviewsCount} pending review${flow.pendingReviewsCount === 1 ? '' : 's'}`
                  : 'See live issue activity across all columns'}
              </div>
            </div>
            <span style={{ color: 'var(--text-muted)', fontSize: 18 }}>→</span>
          </button>
        </Section>

        {/* Section 1 — Overview cards */}
        <Section title="Overview">
          {overviewLoading ? (
            <Body1 style={{ display: 'block', color: tokens.colorNeutralForeground3 }}>Loading…</Body1>
          ) : (
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <StatCard
                label="Issues done this week"
                value={overview?.issuesDoneThisWeek ?? 0}
                sub={wowStr}
                subColor={wowColor}
              />
              <StatCard
                label="Active agents"
                value={overview?.activeAgents ?? 0}
              />
              <StatCard
                label="Runs this week"
                value={overview?.runsThisWeek ?? 0}
                sub={`${overview?.totalRuns ?? 0} total`}
              />
              <StatCard
                label="Cost MTD"
                value={costStr}
                sub={budgetSub}
                accent={Boolean(budget?.monthlyBudgetUsd && (budget?.percentUsed ?? 0) > 80)}
              />
            </div>
          )}
        </Section>

        {/* Section 2 — Throughput chart */}
        <Section title="Throughput — last 30 days">
          {throughputLoading ? (
            <Body1 style={{ display: 'block', color: tokens.colorNeutralForeground3 }}>Loading…</Body1>
          ) : (
            <div
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: '10px',
                padding: '20px',
              }}
            >
              <ThroughputChart days={throughput?.days ?? []} />
            </div>
          )}
        </Section>

        {/* Section 3 — Agent leaderboard */}
        <Section title="Agent leaderboard">
          {agentsLoading ? (
            <Body1 style={{ display: 'block', color: tokens.colorNeutralForeground3 }}>Loading…</Body1>
          ) : (
            <div
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: '10px',
                overflow: 'hidden',
              }}
            >
              <AgentLeaderboard agents={agentStats?.agents ?? []} />
            </div>
          )}
        </Section>

        {/* Section 4 — Workflow health */}
        <Section title="Workflow health">
          {workflowsLoading ? (
            <Body1 style={{ display: 'block', color: tokens.colorNeutralForeground3 }}>Loading…</Body1>
          ) : (
            <WorkflowHealth
              workflows={workflowStats?.workflows ?? []}
              openReviews={overview?.openReviews ?? 0}
            />
          )}
        </Section>
      </div>
    </div>
  )
}
