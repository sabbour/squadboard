/**
 * pages/Now.tsx — Global "Uber Dashboard" live view.
 *
 * Shows every active live session, running issue run, and active workflow
 * run across ALL projects in real time. Click a row to jump into the
 * relevant project view. Live-updates via the global WS channel.
 *
 * Phase 19: satisfies the original "live view of every agent" ask.
 */

import { useNavigate } from 'react-router'
import { formatDistanceToNow } from 'date-fns'
import { Eye24Regular } from '@fluentui/react-icons'
import PageHeader from '../components/layout/PageHeader.tsx'
import { useNowFeed, type NowLiveSession, type NowIssueRun, type NowWorkflowRun } from '../api/activity.ts'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeRelativeTime(value: unknown): string {
  if (value == null) return '—'
  const d = new Date(value as string | number | Date)
  if (Number.isNaN(d.getTime())) return '—'
  try {
    return formatDistanceToNow(d, { addSuffix: true })
  } catch {
    return '—'
  }
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

type StatusKind = 'running' | 'active' | 'pending' | 'warning' | 'idle' | 'other'

function statusKind(status: string): StatusKind {
  if (status === 'running' || status === 'active') return 'running'
  if (status === 'pending' || status === 'splitting' || status === 'waiting_children') return 'pending'
  if (status === 'idle') return 'idle'
  if (status === 'awaiting_review' || status === 'awaiting_human_approve' || status === 'awaiting_input') return 'warning'
  return 'other'
}

const STATUS_STYLES: Record<StatusKind, { label: string; color: string; bg: string; pulse: boolean }> = {
  running: { label: 'Running',  color: '#58a6ff', bg: 'rgba(88,166,255,0.12)',  pulse: true  },
  active:  { label: 'Active',   color: '#58a6ff', bg: 'rgba(88,166,255,0.12)',  pulse: true  },
  pending: { label: 'Pending',  color: '#8b949e', bg: 'rgba(139,148,158,0.12)', pulse: false },
  idle:    { label: 'Idle',     color: '#e3b341', bg: 'rgba(227,179,65,0.12)',  pulse: false },
  warning: { label: 'Awaiting', color: '#e3b341', bg: 'rgba(227,179,65,0.12)',  pulse: false },
  other:   { label: 'Unknown',  color: '#8b949e', bg: 'rgba(139,148,158,0.12)', pulse: false },
}

function StatusBadge({ status }: { status: string }) {
  const kind = statusKind(status)
  const cfg = STATUS_STYLES[kind]
  const label = status.replace(/_/g, ' ')
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '5px',
        background: cfg.bg,
        color: cfg.color,
        border: `1px solid ${cfg.color}33`,
        borderRadius: '10px',
        padding: '2px 8px',
        fontSize: '11px',
        fontWeight: 500,
        whiteSpace: 'nowrap',
      }}
    >
      <span
        style={{
          width: '6px',
          height: '6px',
          borderRadius: '50%',
          background: cfg.color,
          flexShrink: 0,
          animation: cfg.pulse ? 'nowPulse 1.4s ease-in-out infinite' : undefined,
        }}
      />
      {label}
      <style>{`
        @keyframes nowPulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%       { opacity: 0.4; transform: scale(0.7); }
        }
      `}</style>
    </span>
  )
}

// ---------------------------------------------------------------------------
// Project chip — clickable, links to project dashboard
// ---------------------------------------------------------------------------

function ProjectChip({ projectId, projectName }: { projectId: string; projectName: string }) {
  const navigate = useNavigate()
  return (
    <button
      onClick={(e) => { e.stopPropagation(); void navigate(`/projects/${projectId}/dashboard`) }}
      style={{
        display: 'inline-block',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: '6px',
        padding: '1px 7px',
        fontSize: '11px',
        fontWeight: 500,
        color: 'var(--text-muted)',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        maxWidth: '140px',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
      title={projectName}
    >
      {projectName}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Table primitives
// ---------------------------------------------------------------------------

const COL_HEADER: React.CSSProperties = {
  padding: '6px 12px',
  fontSize: '11px',
  fontWeight: 600,
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  textAlign: 'left',
  borderBottom: '1px solid var(--border)',
  background: 'var(--surface)',
}

const COL_CELL: React.CSSProperties = {
  padding: '8px 12px',
  fontSize: '13px',
  color: 'var(--text)',
  borderBottom: '1px solid var(--border)',
  verticalAlign: 'middle',
}

function EmptyRow({ cols }: { cols: number }) {
  return (
    <tr>
      <td colSpan={cols} style={{ ...COL_CELL, color: 'var(--text-muted)', fontStyle: 'italic', textAlign: 'center', padding: '20px' }}>
        Nothing running.
      </td>
    </tr>
  )
}

// ---------------------------------------------------------------------------
// Section: Live Sessions
// ---------------------------------------------------------------------------

function LiveSessionsSection({ sessions }: { sessions: NowLiveSession[] }) {
  const navigate = useNavigate()

  return (
    <section style={{ marginBottom: '32px' }}>
      <div style={{ padding: '12px 24px 8px', fontWeight: 600, fontSize: '13px', color: 'var(--text)' }}>
        Live Sessions
        <span style={{ marginLeft: '8px', fontSize: '11px', fontWeight: 400, color: 'var(--text-muted)' }}>
          ({sessions.length})
        </span>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={COL_HEADER}>Project</th>
            <th style={COL_HEADER}>Agent</th>
            <th style={COL_HEADER}>Status</th>
            <th style={COL_HEADER}>Started</th>
            <th style={COL_HEADER}>Last activity</th>
          </tr>
        </thead>
        <tbody>
          {sessions.length === 0 ? (
            <EmptyRow cols={5} />
          ) : (
            sessions.map((s) => (
              <tr
                key={s.id}
                onClick={() => void navigate(`/projects/${s.projectId}/sessions/${s.id}`)}
                style={{ cursor: 'pointer' }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = 'var(--surface)' }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = '' }}
              >
                <td style={COL_CELL}>
                  <ProjectChip projectId={s.projectId} projectName={s.projectName} />
                </td>
                <td style={COL_CELL}>{s.agentName ?? '—'}</td>
                <td style={COL_CELL}><StatusBadge status={s.status} /></td>
                <td style={{ ...COL_CELL, color: 'var(--text-muted)', fontSize: '12px' }}>{safeRelativeTime(s.startedAt)}</td>
                <td style={{ ...COL_CELL, color: 'var(--text-muted)', fontSize: '12px' }}>{safeRelativeTime(s.lastEventAt)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Section: Running Issues
// ---------------------------------------------------------------------------

function IssueRunsSection({ runs }: { runs: NowIssueRun[] }) {
  const navigate = useNavigate()

  return (
    <section style={{ marginBottom: '32px' }}>
      <div style={{ padding: '12px 24px 8px', fontWeight: 600, fontSize: '13px', color: 'var(--text)' }}>
        Running Issues
        <span style={{ marginLeft: '8px', fontSize: '11px', fontWeight: 400, color: 'var(--text-muted)' }}>
          ({runs.length})
        </span>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={COL_HEADER}>Project</th>
            <th style={COL_HEADER}>Issue</th>
            <th style={COL_HEADER}>Agent</th>
            <th style={COL_HEADER}>Status</th>
            <th style={COL_HEADER}>Started</th>
            <th style={COL_HEADER}>Lease expires</th>
          </tr>
        </thead>
        <tbody>
          {runs.length === 0 ? (
            <EmptyRow cols={6} />
          ) : (
            runs.map((r) => (
              <tr
                key={r.id}
                onClick={() => void navigate(`/projects/${r.projectId}/board?focus=${r.issueId}`)}
                style={{ cursor: 'pointer' }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = 'var(--surface)' }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = '' }}
              >
                <td style={COL_CELL}>
                  <ProjectChip projectId={r.projectId} projectName={r.projectName} />
                </td>
                <td style={{ ...COL_CELL, maxWidth: '280px' }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
                    {r.issueTitle}
                  </span>
                </td>
                <td style={COL_CELL}>{r.agentName ?? '—'}</td>
                <td style={COL_CELL}><StatusBadge status={r.status} /></td>
                <td style={{ ...COL_CELL, color: 'var(--text-muted)', fontSize: '12px' }}>{safeRelativeTime(r.startedAt)}</td>
                <td style={{ ...COL_CELL, color: 'var(--text-muted)', fontSize: '12px' }}>{safeRelativeTime(r.leaseExpiresAt)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Section: Active Workflows
// ---------------------------------------------------------------------------

function WorkflowRunsSection({ runs }: { runs: NowWorkflowRun[] }) {
  const navigate = useNavigate()

  return (
    <section style={{ marginBottom: '32px' }}>
      <div style={{ padding: '12px 24px 8px', fontWeight: 600, fontSize: '13px', color: 'var(--text)' }}>
        Active Workflows
        <span style={{ marginLeft: '8px', fontSize: '11px', fontWeight: 400, color: 'var(--text-muted)' }}>
          ({runs.length})
        </span>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={COL_HEADER}>Project</th>
            <th style={COL_HEADER}>Workflow</th>
            <th style={COL_HEADER}>Status</th>
            <th style={COL_HEADER}>Current step</th>
            <th style={COL_HEADER}>Started</th>
          </tr>
        </thead>
        <tbody>
          {runs.length === 0 ? (
            <EmptyRow cols={5} />
          ) : (
            runs.map((r) => (
              <tr
                key={r.id}
                onClick={() => void navigate(`/projects/${r.projectId}/flow?run=${r.id}`)}
                style={{ cursor: 'pointer' }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = 'var(--surface)' }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = '' }}
              >
                <td style={COL_CELL}>
                  <ProjectChip projectId={r.projectId} projectName={r.projectName} />
                </td>
                <td style={COL_CELL}>{r.workflowName}</td>
                <td style={COL_CELL}><StatusBadge status={r.status} /></td>
                <td style={{ ...COL_CELL, color: 'var(--text-muted)', fontSize: '12px' }}>
                  {r.currentStepKind ?? '—'}
                </td>
                <td style={{ ...COL_CELL, color: 'var(--text-muted)', fontSize: '12px' }}>{safeRelativeTime(r.startedAt)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function Now() {
  const { data, isLoading, error } = useNowFeed()

  const liveSessions  = data?.liveSessions  ?? []
  const issueRuns     = data?.issueRuns     ?? []
  const workflowRuns  = data?.workflowRuns  ?? []

  const totalActive = liveSessions.length + issueRuns.length + workflowRuns.length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <PageHeader
        icon={<Eye24Regular />}
        title="Now"
        description="Live activity across every project."
        size="large"
        actions={
          isLoading ? (
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Loading…</span>
          ) : error ? (
            <span style={{ fontSize: '12px', color: '#f85149' }}>Failed to load</span>
          ) : (
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              {totalActive} active {totalActive === 1 ? 'item' : 'items'}
            </span>
          )
        }
      />

      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 0' }}>
        <LiveSessionsSection  sessions={liveSessions} />
        <IssueRunsSection     runs={issueRuns} />
        <WorkflowRunsSection  runs={workflowRuns} />
      </div>
    </div>
  )
}
