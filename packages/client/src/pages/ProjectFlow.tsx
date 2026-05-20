/**
 * pages/ProjectFlow.tsx — Phase 12 project-wide flow board.
 *
 * Tabbed view (Stream D — D8):
 *   - "Agents" (default): agent-centric lineage graph powered by
 *     useAgentFlow() / AgentFlowGraph. This is the new Phase-12-reframe
 *     pivot — flow is now about *who's doing what*, not just *what's in
 *     which column*.
 *   - "Issues": original kanban-with-active-run swim-lane view. Preserved
 *     unchanged so the existing workflow continues to work and so users
 *     who prefer the issue-centric perspective can still get to it.
 *
 * Clicking a card on the Issues tab still jumps to the board with the
 * card pre-opened on its Flow tab.
 */
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import {
  TabList,
  Tab,
  tokens,
  type SelectTabData,
  type SelectTabEvent,
} from '@fluentui/react-components'
import { useProject } from '../api/projects.ts'
import {
  useProjectFlow,
  useAgentFlow,
  type ProjectFlowColumn,
  type ProjectFlowIssue,
} from '../api/flow.ts'
import PageHeader from '../components/layout/PageHeader.tsx'
import AgentFlowGraph from '../components/flow/AgentFlowGraph.tsx'

type FlowView = 'agents' | 'issues'

export default function ProjectFlow() {
  const { id } = useParams<{ id: string }>()
  const projectId = id ?? ''
  const { data: project } = useProject(projectId)
  const { data: flow, isLoading, error } = useProjectFlow(projectId)
  const navigate = useNavigate()

  // Stream D — D8: agent view is the new default; issues view kept for
  // backwards-compatibility and quick access to the kanban-style lanes.
  const [activeView, setActiveView] = useState<FlowView>('agents')
  const {
    data: agentGraph,
    isLoading: agentLoading,
    error: agentError,
  } = useAgentFlow(projectId)

  const totalIssues = flow?.columns.reduce((sum, c) => sum + c.issues.length, 0) ?? 0
  const totalAgents = agentGraph?.agents.length ?? 0
  const totalInstances = agentGraph?.agents.reduce((sum, a) => sum + a.instances.length, 0) ?? 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <PageHeader
        eyebrow={project?.name}
        title="Flow"
        description={
          activeView === 'agents'
            ? 'Live agent activity across the project · click an instance for details.'
            : 'Live issue flow across columns · click a card to inspect its DAG.'
        }
        actions={
          activeView === 'agents' ? (
            <>
              <Chip label="Agents" value={totalAgents} color="#388bfd" />
              <Chip label="Active instances" value={totalInstances} color="#3fb950" />
            </>
          ) : (
            <>
              <Chip label="Active runs" value={flow?.activeRunsCount ?? 0} color="#388bfd" />
              <Chip label="Pending reviews" value={flow?.pendingReviewsCount ?? 0} color="#d29922" />
              <Chip label="Issues" value={totalIssues} color="#7d8590" />
            </>
          )
        }
      />

      {/* Stream D — D8: view switcher */}
      <div style={{
        padding: `${tokens.spacingVerticalS} 24px 0`,
        borderBottom: '1px solid var(--border)',
      }}>
        <TabList
          selectedValue={activeView}
          onTabSelect={(_e: SelectTabEvent, d: SelectTabData) => setActiveView(d.value as FlowView)}
        >
          <Tab value="agents">Agents</Tab>
          <Tab value="issues">Issues</Tab>
        </TabList>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflow: 'auto', padding: '20px 24px' }}>
        {activeView === 'agents' ? (
          <>
            {agentLoading && (
              <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading agent flow…</div>
            )}
            {agentError && (
              <div style={{ color: '#ff7b72', fontSize: 13 }}>
                Failed to load agent flow: {String(agentError)}
              </div>
            )}
            {agentGraph && <AgentFlowGraph graph={agentGraph} projectId={projectId} />}
          </>
        ) : (
          <>
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
                    onOpen={(issue) => {
                      if (issue.activeRunSummary?.runId) {
                        navigate(`/projects/${projectId}/issues/${issue.id}/runs/${issue.activeRunSummary.runId}/live`)
                        return
                      }
                      navigate(`/projects/${projectId}/board?openIssue=${issue.id}&tab=flow`)
                    }}
                  />
                ))}
              </div>
            )}
          </>
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
  onOpen: (issue: ProjectFlowIssue) => void
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
  onOpen: (issue: ProjectFlowIssue) => void
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
      ? { label: 'doc', color: '#7d8590' }
      : { label: 'idle', color: '#7d8590' }

  return (
    <button
      type="button"
      onClick={() => onOpen(issue)}
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
