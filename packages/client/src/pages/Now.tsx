/**
 * pages/Now.tsx — Global "Uber Dashboard" live view.
 *
 * Shows every active live session, running issue run, and active workflow
 * run across ALL projects in real time. Click a row to jump into the
 * relevant project view. Live-updates via the global WS channel.
 *
 * Wave 10 C3:
 *   - Rebuilt with Fluent2 primitives (Card-style sections, Badge,
 *     tokens) — replaces the raw <table> + custom CSS palette that
 *     drifted from the rest of the app.
 *   - Adds a project-scope filter tab (default "All projects") so you can
 *     drill into a single project without leaving the Now view.
 */

import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import {
  Badge,
  Body1,
  Caption1,
  Subtitle1,
  Subtitle2,
  Spinner,
  Tab,
  TabList,
  Dropdown,
  Option,
  Tooltip,
  tokens,
  makeStyles,
  type SelectTabData,
  type SelectTabEvent,
} from '@fluentui/react-components'
import { Eye24Regular, Open16Regular } from '@fluentui/react-icons'
import PageHeader from '../components/layout/PageHeader.tsx'
import { useNowFeed, type NowLiveSession, type NowIssueRun, type NowWorkflowRun } from '../api/activity.ts'
import { useProjects } from '../api/projects.ts'
import { safeRelativeTime } from '../utils/dates.ts'

// ---------------------------------------------------------------------------
// Style tokens
// ---------------------------------------------------------------------------

const useStyles = makeStyles({
  body: {
    flex: 1,
    overflowY: 'auto',
    paddingTop: tokens.spacingVerticalL,
    paddingBottom: tokens.spacingVerticalXXL,
    paddingLeft: tokens.spacingHorizontalXXL,
    paddingRight: tokens.spacingHorizontalXXL,
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalL,
  },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: tokens.spacingHorizontalM,
    flexWrap: 'wrap',
  },
  card: {
    background: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusLarge,
    boxShadow: tokens.shadow2,
    overflow: 'hidden',
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalL}`,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    background: tokens.colorNeutralBackground2,
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
  },
  th: {
    textAlign: 'left',
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalL}`,
    fontSize: '11px',
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground3,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    background: tokens.colorNeutralBackground2,
    position: 'sticky',
    top: 0,
  },
  td: {
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalL}`,
    fontSize: '13px',
    color: tokens.colorNeutralForeground1,
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    verticalAlign: 'middle',
  },
  rowClickable: {
    cursor: 'pointer',
    ':hover': {
      background: tokens.colorNeutralBackground1Hover,
    },
  },
  emptyRow: {
    padding: `${tokens.spacingVerticalL} ${tokens.spacingHorizontalL}`,
    textAlign: 'center',
    color: tokens.colorNeutralForeground3,
    fontStyle: 'italic',
  },
  projectChip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalXXS,
    padding: `2px ${tokens.spacingHorizontalS}`,
    fontSize: '11px',
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground2,
    background: tokens.colorNeutralBackground3,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    cursor: 'pointer',
    maxWidth: '180px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    ':hover': {
      background: tokens.colorNeutralBackground3Hover,
    },
  },
  muted: {
    color: tokens.colorNeutralForeground3,
    fontSize: '12px',
    fontVariantNumeric: 'tabular-nums',
  },
  pulseDot: {
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    flexShrink: 0,
    animationName: {
      '0%, 100%': { opacity: 1, transform: 'scale(1)' },
      '50%':       { opacity: 0.4, transform: 'scale(0.7)' },
    },
    animationDuration: '1.4s',
    animationTimingFunction: 'ease-in-out',
    animationIterationCount: 'infinite',
  },
})

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

type StatusKind = 'running' | 'pending' | 'idle' | 'warning' | 'other'

function statusKind(status: string): StatusKind {
  if (status === 'running' || status === 'active') return 'running'
  if (status === 'pending' || status === 'splitting' || status === 'waiting_children') return 'pending'
  if (status === 'idle') return 'idle'
  if (status === 'awaiting_review' || status === 'awaiting_human_approve' || status === 'awaiting_input') return 'warning'
  return 'other'
}

function statusBadgeColor(kind: StatusKind): 'brand' | 'warning' | 'informative' {
  switch (kind) {
    case 'running': return 'brand'
    case 'warning': return 'warning'
    case 'pending':
    case 'idle':
    case 'other':
    default:        return 'informative'
  }
}

function StatusBadge({ status }: { status: string }) {
  const styles = useStyles()
  const kind = statusKind(status)
  const label = status.replace(/_/g, ' ')
  return (
    <Badge appearance="outline" color={statusBadgeColor(kind)} size="small">
      {kind === 'running' && (
        <span
          className={styles.pulseDot}
          style={{ background: tokens.colorBrandForeground1, marginRight: 4 }}
        />
      )}
      {label}
    </Badge>
  )
}

// ---------------------------------------------------------------------------
// Project chip — clickable, links to project dashboard
// ---------------------------------------------------------------------------

function ProjectChip({ projectId, projectName }: { projectId: string; projectName: string }) {
  const navigate = useNavigate()
  const styles = useStyles()
  return (
    <Tooltip content={projectName} relationship="label">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); void navigate(`/projects/${projectId}/dashboard`) }}
        className={styles.projectChip}
      >
        {projectName}
      </button>
    </Tooltip>
  )
}

// ---------------------------------------------------------------------------
// Section card — Fluent2 elevated panel with a sticky-headed table inside.
// ---------------------------------------------------------------------------

function SectionCard({
  title,
  count,
  children,
}: {
  title: string
  count: number
  children: React.ReactNode
}) {
  const styles = useStyles()
  return (
    <section className={styles.card}>
      <div className={styles.cardHeader}>
        <Subtitle2>{title}</Subtitle2>
        <Caption1 className={styles.muted}>
          {count} {count === 1 ? 'item' : 'items'}
        </Caption1>
      </div>
      {children}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Section: Live Sessions
// ---------------------------------------------------------------------------

function LiveSessionsSection({ sessions }: { sessions: NowLiveSession[] }) {
  const navigate = useNavigate()
  const styles = useStyles()

  return (
    <SectionCard title="Live sessions" count={sessions.length}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th className={styles.th}>Project</th>
            <th className={styles.th}>Agent</th>
            <th className={styles.th}>Status</th>
            <th className={styles.th}>Started</th>
            <th className={styles.th}>Last activity</th>
          </tr>
        </thead>
        <tbody>
          {sessions.length === 0 ? (
            <tr><td colSpan={5} className={styles.emptyRow}>Nothing running.</td></tr>
          ) : (
            sessions.map((s) => (
              <tr
                key={s.id}
                onClick={() => void navigate(`/projects/${s.projectId}/sessions/${s.id}`)}
                className={styles.rowClickable}
              >
                <td className={styles.td}>
                  <ProjectChip projectId={s.projectId} projectName={s.projectName} />
                </td>
                <td className={styles.td}>{s.agentName ?? '—'}</td>
                <td className={styles.td}><StatusBadge status={s.status} /></td>
                <td className={styles.td}><span className={styles.muted}>{safeRelativeTime(s.startedAt)}</span></td>
                <td className={styles.td}><span className={styles.muted}>{safeRelativeTime(s.lastEventAt)}</span></td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </SectionCard>
  )
}

// ---------------------------------------------------------------------------
// Section: Top open issue runs
// ---------------------------------------------------------------------------

function IssueRunsSection({ runs }: { runs: NowIssueRun[] }) {
  const navigate = useNavigate()
  const styles = useStyles()

  return (
    <SectionCard title="Top open issue runs" count={runs.length}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th className={styles.th}>Project</th>
            <th className={styles.th}>Issue</th>
            <th className={styles.th}>Agent</th>
            <th className={styles.th}>Status</th>
            <th className={styles.th}>Started</th>
            <th className={styles.th}>Lease expires</th>
          </tr>
        </thead>
        <tbody>
          {runs.length === 0 ? (
            <tr><td colSpan={6} className={styles.emptyRow}>Nothing running.</td></tr>
          ) : (
            runs.map((r) => (
              <tr
                key={r.id}
                onClick={() => void navigate(`/projects/${r.projectId}/board?focus=${r.issueId}`)}
                className={styles.rowClickable}
              >
                <td className={styles.td}>
                  <ProjectChip projectId={r.projectId} projectName={r.projectName} />
                </td>
                <td className={styles.td} style={{ maxWidth: '320px' }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
                    {r.issueTitle}
                  </span>
                </td>
                <td className={styles.td}>{r.agentName ?? '—'}</td>
                <td className={styles.td}><StatusBadge status={r.status} /></td>
                <td className={styles.td}><span className={styles.muted}>{safeRelativeTime(r.startedAt)}</span></td>
                <td className={styles.td}><span className={styles.muted}>{safeRelativeTime(r.leaseExpiresAt)}</span></td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </SectionCard>
  )
}

// ---------------------------------------------------------------------------
// Section: Active workflow runs
// ---------------------------------------------------------------------------

function TriggerBadge({ trigger }: { trigger: NowWorkflowRun['triggerSource'] }) {
  if (!trigger) return <span style={{ color: tokens.colorNeutralForeground3 }}>—</span>
  let label = ''
  let color = tokens.colorPaletteBlueBackground2
  let fg = tokens.colorPaletteBlueForeground2
  switch (trigger.kind) {
    case 'manual':
    case 'manual_force':
      label = trigger.kind === 'manual_force' ? 'Manual (force)' : 'Manual'
      color = tokens.colorNeutralBackground3
      fg = tokens.colorNeutralForeground2
      break
    case 'on_schedule':
      label = trigger.detail ? `Schedule · ${trigger.detail}` : 'Schedule'
      color = tokens.colorPaletteGreenBackground2
      fg = tokens.colorPaletteGreenForeground2
      break
    case 'on_event':
      label = `Event · ${trigger.eventType ?? 'unknown'}`
      color = tokens.colorPaletteBlueBackground2
      fg = tokens.colorPaletteBlueForeground2
      break
    default:
      label = trigger.detail ?? trigger.kind
      color = tokens.colorPaletteYellowBackground2
      fg = tokens.colorPaletteYellowForeground2
  }
  return (
    <span
      title={JSON.stringify(trigger)}
      style={{
        background: color,
        color: fg,
        padding: '2px 8px',
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 500,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  )
}

function WorkflowRunsSection({ runs }: { runs: NowWorkflowRun[] }) {
  const navigate = useNavigate()
  const styles = useStyles()

  return (
    <SectionCard title="Active workflow runs" count={runs.length}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th className={styles.th}>Project</th>
            <th className={styles.th}>Workflow</th>
            <th className={styles.th}>Trigger</th>
            <th className={styles.th}>Status</th>
            <th className={styles.th}>Current step</th>
            <th className={styles.th}>Started</th>
          </tr>
        </thead>
        <tbody>
          {runs.length === 0 ? (
            <tr><td colSpan={6} className={styles.emptyRow}>Nothing running.</td></tr>
          ) : (
            runs.map((r) => (
              <tr
                key={r.id}
                onClick={() => void navigate(`/projects/${r.projectId}/flow?run=${r.id}`)}
                className={styles.rowClickable}
              >
                <td className={styles.td}>
                  <ProjectChip projectId={r.projectId} projectName={r.projectName} />
                </td>
                <td className={styles.td}>{r.workflowName}</td>
                <td className={styles.td}><TriggerBadge trigger={r.triggerSource} /></td>
                <td className={styles.td}><StatusBadge status={r.status} /></td>
                <td className={styles.td}><span className={styles.muted}>{r.currentStepKind ?? '—'}</span></td>
                <td className={styles.td}><span className={styles.muted}>{safeRelativeTime(r.startedAt)}</span></td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </SectionCard>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const ALL_PROJECTS = '__all__'

export default function Now() {
  const styles = useStyles()
  const { data, isLoading, error } = useNowFeed()
  const projectsQuery = useProjects()

  // Wave 10 C3: project-scope filter — defaults to "All projects" so the
  // page stays the cross-project Uber Dashboard. Users can drill into a
  // single project without leaving Now.
  const [scopeProjectId, setScopeProjectId] = useState<string>(ALL_PROJECTS)

  const liveSessions  = data?.liveSessions  ?? []
  const issueRuns     = data?.issueRuns     ?? []
  const workflowRuns  = data?.workflowRuns  ?? []

  // Project list driven by *active* items so the dropdown only shows
  // projects that have something happening right now (avoids 100-entry
  // dropdowns of dormant projects).
  const activeProjects = useMemo(() => {
    const ids = new Map<string, string>() // id → name
    for (const s of liveSessions) ids.set(s.projectId, s.projectName)
    for (const r of issueRuns)    ids.set(r.projectId, r.projectName)
    for (const r of workflowRuns) ids.set(r.projectId, r.projectName)
    return [...ids.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [liveSessions, issueRuns, workflowRuns])

  // Apply scope filter to the three feeds.
  const filteredLive = useMemo(
    () => scopeProjectId === ALL_PROJECTS ? liveSessions : liveSessions.filter((s) => s.projectId === scopeProjectId),
    [liveSessions, scopeProjectId],
  )
  const filteredIssues = useMemo(
    () => scopeProjectId === ALL_PROJECTS ? issueRuns : issueRuns.filter((r) => r.projectId === scopeProjectId),
    [issueRuns, scopeProjectId],
  )
  const filteredWorkflows = useMemo(
    () => scopeProjectId === ALL_PROJECTS ? workflowRuns : workflowRuns.filter((r) => r.projectId === scopeProjectId),
    [workflowRuns, scopeProjectId],
  )

  const totalActive = filteredLive.length + filteredIssues.length + filteredWorkflows.length

  function handleScopeChange(_e: SelectTabEvent, d: SelectTabData) {
    setScopeProjectId(d.value as string)
  }

  const scopeName = scopeProjectId === ALL_PROJECTS
    ? null
    : (activeProjects.find((p) => p.id === scopeProjectId)?.name
       ?? projectsQuery.data?.find((p) => p.id === scopeProjectId)?.name
       ?? scopeProjectId)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <PageHeader
        eyebrow={scopeName ? `PROJECT: ${scopeName.toUpperCase()}` : 'GLOBAL · ACROSS ALL PROJECTS'}
        icon={<Eye24Regular />}
        title="Now"
        description="Live activity across every project."
        size="large"
        actions={
          isLoading ? (
            <Spinner size="extra-small" label="Loading…" />
          ) : error ? (
            <Caption1 style={{ color: tokens.colorPaletteRedForeground1 }}>Failed to load</Caption1>
          ) : (
            <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>
              {totalActive} active {totalActive === 1 ? 'item' : 'items'}
            </Caption1>
          )
        }
      />

      <div className={styles.body}>
        {/* Scope toolbar — primary tab for "All projects", secondary tabs
            for any project with at least one active item. When more than 4
            projects are active, fall back to a Dropdown to keep the toolbar
            from wrapping. */}
        <div className={styles.toolbar}>
          {activeProjects.length <= 4 ? (
            <TabList selectedValue={scopeProjectId} onTabSelect={handleScopeChange} size="small">
              <Tab value={ALL_PROJECTS}>All projects</Tab>
              {activeProjects.map((p) => (
                <Tab key={p.id} value={p.id}>{p.name}</Tab>
              ))}
            </TabList>
          ) : (
            <Dropdown
              size="small"
              value={scopeName ?? 'All projects'}
              selectedOptions={[scopeProjectId]}
              onOptionSelect={(_, d) => d.optionValue && setScopeProjectId(d.optionValue)}
            >
              <Option value={ALL_PROJECTS} text="All projects">All projects</Option>
              {activeProjects.map((p) => (
                <Option key={p.id} value={p.id} text={p.name}>{p.name}</Option>
              ))}
            </Dropdown>
          )}
          {scopeProjectId !== ALL_PROJECTS && scopeName && (
            <Tooltip content={`Open ${scopeName}`} relationship="label">
              <Caption1
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: tokens.spacingHorizontalXS,
                  color: tokens.colorBrandForeground1,
                  cursor: 'pointer',
                }}
                onClick={() => { window.location.href = `/projects/${scopeProjectId}/dashboard` }}
              >
                Open project <Open16Regular />
              </Caption1>
            </Tooltip>
          )}
        </div>

        {totalActive === 0 && !isLoading && !error && (
          <div
            style={{
              padding: tokens.spacingVerticalXXL,
              textAlign: 'center',
              border: `1px dashed ${tokens.colorNeutralStroke2}`,
              borderRadius: tokens.borderRadiusLarge,
            }}
          >
            <Subtitle1 style={{ color: tokens.colorNeutralForeground1, display: 'block', marginBottom: tokens.spacingVerticalS }}>
              Nothing live right now
            </Subtitle1>
            <Body1 style={{ color: tokens.colorNeutralForeground3 }}>
              When agents are running, sessions, issues, and workflows will surface here.
            </Body1>
          </div>
        )}

        <LiveSessionsSection sessions={filteredLive} />
        <IssueRunsSection runs={filteredIssues} />
        <WorkflowRunsSection runs={filteredWorkflows} />
      </div>
    </div>
  )
}
