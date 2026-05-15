/**
 * pages/ProjectFlow.tsx — Phase 12 project-wide flow board.
 *
 * Renders the project's columns as horizontal swim-lanes, each containing
 * stacked issue cards. Each card surfaces the most recent active run
 * summary or the most recent deliverable. Clicking a card jumps to the
 * board with the card pre-opened on the Flow tab.
 */
import { useNavigate, useParams } from 'react-router'
import { tokens } from '@fluentui/react-components'
import { useProject } from '../api/projects.ts'
import {
  useProjectFlow,
  type ProjectFlowColumn,
  type ProjectFlowIssue,
} from '../api/flow.ts'

export default function ProjectFlow() {
  const { id } = useParams<{ id: string }>()
  const projectId = id ?? ''
  const { data: project } = useProject(projectId)
  const { data: flow, isLoading, error } = useProjectFlow(projectId)
  const navigate = useNavigate()

  const totalIssues = flow?.columns.reduce((sum, c) => sum + c.issues.length, 0) ?? 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: '16px 24px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}
      >
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 600, color: 'var(--text)' }}>
            {project?.name ?? 'Project'} — Flow
          </h1>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            Live issue flow across columns · click a card to inspect its DAG
          </p>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <Chip label="Active runs" value={flow?.activeRunsCount ?? 0} color="#388bfd" />
          <Chip label="Pending reviews" value={flow?.pendingReviewsCount ?? 0} color="#d29922" />
          <Chip label="Issues" value={totalIssues} color="#7d8590" />
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflow: 'auto', padding: '20px 24px' }}>
        {isLoading && (
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading flow…</div>
        )}
        {error && (
          <div style={{ color: '#ff7b72', fontSize: 13 }}>
            Failed to load flow: {String(error)}
          </div>
        )}
        {flow && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {flow.columns.map((col) => (
              <SwimLane
                key={col.slug}
                column={col}
                onOpen={(issueId) =>
                  navigate(`/projects/${projectId}/board?openIssue=${issueId}&tab=flow`)
                }
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function Chip({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 999,
        padding: '4px 12px',
        fontSize: 12,
        color: 'var(--text)',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
      }}
    >
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block' }} />
      <span style={{ color: 'var(--text-muted)' }}>{label}:</span>
      <strong>{value}</strong>
    </div>
  )
}

interface SwimLaneProps {
  column: ProjectFlowColumn
  onOpen: (issueId: string) => void
}

function SwimLane({ column, onOpen }: SwimLaneProps) {
  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 16px',
          borderBottom: '1px solid var(--border)',
          background: 'rgba(255, 255, 255, 0.02)',
        }}
      >
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: '50%',
            background: column.color,
            display: 'inline-block',
            boxShadow: `0 0 0 3px ${column.color}33`,
          }}
        />
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{column.name}</span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {column.issues.length} issue{column.issues.length === 1 ? '' : 's'}
        </span>
      </div>
      <div
        style={{
          display: 'flex',
          gap: 12,
          padding: 16,
          overflowX: 'auto',
          minHeight: 96,
        }}
      >
        {column.issues.length === 0 ? (
          <div
            style={{
              fontSize: 12,
              color: 'var(--text-muted)',
              fontStyle: 'italic',
              padding: '12px 0',
            }}
          >
            No issues in this column.
          </div>
        ) : (
          column.issues.map((issue) => (
            <IssueCard key={issue.id} issue={issue} columnColor={column.color} onOpen={onOpen} />
          ))
        )}
      </div>
    </div>
  )
}

const RUN_STATUS_COLOR: Record<string, string> = {
  pending: '#9da7b3',
  running: '#58a6ff',
  splitting: '#bc8cff',
  waiting_children: '#bc8cff',
  completed: '#3fb950',
  failed: '#ff7b72',
  cancelled: '#9da7b3',
}

function IssueCard({
  issue,
  columnColor,
  onOpen,
}: {
  issue: ProjectFlowIssue
  columnColor: string
  onOpen: (id: string) => void
}) {
  const subtitle = issue.activeRunSummary
    ? `${formatRunKind(issue.activeRunSummary.kind)} · ${issue.activeRunSummary.status}`
    : issue.lastDeliverable
      ? `${issue.lastDeliverable.title} · ${issue.lastDeliverable.status}`
      : 'idle'

  const subtitleColor = issue.activeRunSummary
    ? (RUN_STATUS_COLOR[issue.activeRunSummary.status] ?? 'var(--text-muted)')
    : 'var(--text-muted)'

  const badge = issue.activeRunSummary
    ? { label: issue.activeRunSummary.status, color: RUN_STATUS_COLOR[issue.activeRunSummary.status] ?? '#7d8590' }
    : issue.lastDeliverable
      ? { label: '📎', color: '#7d8590' }
      : { label: 'idle', color: '#7d8590' }

  return (
    <button
      type="button"
      onClick={() => onOpen(issue.id)}
      style={{
        flex: '0 0 240px',
        textAlign: 'left',
        background: tokens.colorNeutralBackground2,
        border: `1px solid ${columnColor}55`,
        borderLeft: `3px solid ${columnColor}`,
        borderRadius: 8,
        padding: '10px 12px',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        color: 'var(--text)',
        transition: 'transform 100ms ease-out, border-color 100ms ease-out',
      }}
      onMouseEnter={(e) => {
        ;(e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-1px)'
        ;(e.currentTarget as HTMLButtonElement).style.borderColor = columnColor
      }}
      onMouseLeave={(e) => {
        ;(e.currentTarget as HTMLButtonElement).style.transform = ''
        ;(e.currentTarget as HTMLButtonElement).style.borderColor = `${columnColor}55`
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 500,
            lineHeight: 1.3,
            color: 'var(--text)',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {issue.title}
        </div>
        <span
          style={{
            fontSize: 10,
            padding: '2px 6px',
            borderRadius: 999,
            background: `${badge.color}33`,
            color: badge.color,
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          {badge.label}
        </span>
      </div>
      <div
        style={{
          fontSize: 11,
          color: subtitleColor,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={subtitle}
      >
        {issue.activeRunSummary?.agentName ? `${issue.activeRunSummary.agentName} · ` : ''}
        {subtitle}
      </div>
    </button>
  )
}

function formatRunKind(kind: string): string {
  switch (kind) {
    case 'agent_run': return 'Agent'
    case 'route': return 'Route'
    case 'approve': return 'Approve'
    case 'fan_out': return 'Fan-out'
    case 'handoff': return 'Handoff'
    default: return kind
  }
}
