import { Draggable } from '@hello-pangea/dnd'
import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { Body1, Button, tokens } from '@fluentui/react-components'
import {
  CheckmarkCircle20Regular,
  Warning20Regular,
  Branch20Regular,
  Eye20Regular,
  Merge20Regular,
  Box20Regular,
  Comment20Regular,
} from '@fluentui/react-icons'
import { type Issue } from '../../api/issues.ts'
import { useIssueRuns } from '../../api/runs.ts'
import LabelBadge from '../LabelBadge.tsx'
import RunStatusBadge from '../runs/RunStatusBadge.tsx'
import CostDisplay from '../runs/CostDisplay.tsx'
import { RoutingBadge } from './RoutingBadge.tsx'
import { WorkflowBadge } from './WorkflowBadge.tsx'
import { RoutingTierBadge } from '../routing/RoutingTierBadge.tsx'

interface IssueCardProps {
  issue: Issue
  index: number
  projectId: string
  columnSemantic?: 'backlog' | 'ready' | 'in_progress' | 'review' | 'done' | 'custom'
  isSelected: boolean
  onSelect: (id: string, shiftKey: boolean) => void
  onOpen: (issue: Issue) => void
}

// ── GitHub badge helpers ─────────────────────────────────────────────────────

type PrState = 'open' | 'draft' | 'merged' | 'closed'
type CiState = 'passing' | 'failing' | 'running' | 'unknown'

function prStateColor(state: PrState): string {
  switch (state) {
    case 'open':   return '#3fb950'   // green
    case 'draft':  return '#8b949e'   // muted
    case 'merged': return '#a371f7'   // purple
    case 'closed': return '#f85149'   // red
    default:       return '#8b949e'
  }
}

function ciStateIcon(state: CiState): ReactNode {
  switch (state) {
    case 'passing': return <CheckmarkCircle20Regular style={{ verticalAlign: 'middle' }} />
    case 'failing': return <Warning20Regular style={{ verticalAlign: 'middle' }} />
    case 'running': return null
    default:        return null
  }
}

function truncateBranch(branch: string, max = 20): string {
  return branch.length > max ? branch.slice(0, max) + '…' : branch
}

interface GitHubBadgesProps {
  github: Issue['github']
}

function GitHubBadges({ github }: GitHubBadgesProps) {
  if (!github) return null
  const { branch, branchUrl, pr, ci } = github
  if (!branch && !pr) return null

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '6px' }}>
      {branch && (
        <a
          href={branchUrl ?? '#'}
          target="_blank"
          rel="noopener noreferrer"
          title={branch}
          onClick={(e) => e.stopPropagation()}
          style={badgeLinkStyle}
        >
          <Branch20Regular style={{ verticalAlign: 'middle', marginRight: '3px' }} />{truncateBranch(branch)}
        </a>
      )}
      {pr && (
        <a
          href={pr.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          style={{ ...badgeLinkStyle, color: prStateColor(pr.state) }}
        >
          <Merge20Regular style={{ verticalAlign: 'middle', marginRight: '3px' }} />PR #{pr.number} · {pr.state}
        </a>
      )}
      {ci && (
        <a
          href={ci.url ?? '#'}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          style={badgeLinkStyle}
        >
          {ciStateIcon(ci.state)} CI {ci.state}
        </a>
      )}
    </div>
  )
}

const badgeLinkStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '2px',
  fontSize: '10px',
  color: '#8b949e',
  background: 'rgba(139,148,158,0.1)',
  border: '1px solid rgba(139,148,158,0.25)',
  borderRadius: '10px',
  padding: '1px 7px',
  textDecoration: 'none',
  whiteSpace: 'nowrap' as const,
  maxWidth: '200px',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}

// ────────────────────────────────────────────────────────────────────────────

function automaticRunHint(columnSemantic?: IssueCardProps['columnSemantic']) {
  if (columnSemantic === 'ready') return 'Starts automatically'
  if (columnSemantic === 'in_progress') return 'Waiting for active run'
  return null
}

export default function IssueCard({ issue, index, projectId, columnSemantic, isSelected, onSelect, onOpen }: IssueCardProps) {
  const [hovered, setHovered] = useState(false)
  const navigate = useNavigate()
  const { data: runs } = useIssueRuns(projectId, issue.id)
  const activeRun = runs?.find((r) => r.status === 'running' || r.status === 'pending')
  const latestRun = runs && runs.length > 0 ? runs[runs.length - 1] : undefined
  const runHint = !activeRun && !latestRun ? automaticRunHint(columnSemantic) : null

  return (
    <Draggable draggableId={issue.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          data-testid="issue-card"
          data-issue-id={issue.id}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          style={{
            background: tokens.colorNeutralBackground1,
            border: `1px solid ${isSelected ? tokens.colorBrandBackground : snapshot.isDragging ? tokens.colorBrandBackground : hovered ? tokens.colorBrandBackground : tokens.colorNeutralStroke1}`,
            borderRadius: '6px',
            padding: '12px',
            boxShadow: snapshot.isDragging ? '0 4px 12px rgba(0,0,0,0.6)' : '0 1px 3px rgba(0,0,0,0.4)',
            cursor: 'grab',
            position: 'relative',
            transition: 'border-color 0.1s',
            ...provided.draggableProps.style,
          }}
        >
          {/* Selection checkbox */}
          <input
            type="checkbox"
            checked={isSelected}
            onChange={(e) => {
              e.stopPropagation()
              onSelect(issue.id, e.nativeEvent instanceof MouseEvent ? (e.nativeEvent as MouseEvent).shiftKey : false)
            }}
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'absolute',
              top: '10px',
              right: '10px',
              cursor: 'pointer',
              opacity: isSelected || hovered ? 1 : 0,
              transition: 'opacity 0.1s',
              accentColor: '#388bfd',
            }}
          />

          {/* Title + labels + badges — clickable area that opens the detail panel */}
          <div
            data-testid="issue-card-title"
            onClick={() => onOpen(issue)}
            style={{ cursor: 'pointer', paddingRight: '20px' }}
          >
            <Body1
              style={{
                display: 'block',
                fontWeight: tokens.fontWeightMedium,
                color: tokens.colorNeutralForeground1,
                lineHeight: '1.4',
                marginBottom: issue.labels.length > 0 ? '8px' : '0',
              }}
            >
              {issue.title}
            </Body1>

            {/* Labels */}
            {issue.labels.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '8px' }}>
                {issue.labels.map((label) => (
                  <LabelBadge key={label.id} name={label.name} color={label.color} />
                ))}
              </div>
            )}

            {/* GitHub badges (G2.6) */}
            <GitHubBadges github={issue.github} />

            {/* Deliverable badge (O4) */}
            {issue.deliverableType && issue.deliverableType !== 'none' && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '4px' }}>
                <span style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '3px',
                  fontSize: '10px',
                  color: issue.deliverableStatus === 'accepted' ? '#3fb950'
                    : issue.deliverableStatus === 'rejected' ? '#f85149'
                    : issue.deliverableStatus === 'ready-for-review' ? '#e3b341'
                    : '#8b949e',
                  background: 'rgba(139,148,158,0.1)',
                  border: '1px solid rgba(139,148,158,0.25)',
                  borderRadius: '10px',
                  padding: '1px 7px',
                  whiteSpace: 'nowrap' as const,
                }}>
                  <Box20Regular style={{ verticalAlign: 'middle', marginRight: '3px' }} />{issue.deliverableType} · {issue.deliverableStatus ?? 'not-started'}
                </span>
              </div>
            )}
          </div>

          {/* Footer: assignee + run — outside the onOpen wrapper, clicks stop here */}
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '6px' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              {issue.assignee && (
                <span
                  title={`Assigned to ${issue.assignee.name}${issue.assignee.role ? ` — ${issue.assignee.role}` : ''}`}
                  style={{
                    color: tokens.colorNeutralForeground2,
                    fontSize: '11px',
                    maxWidth: '150px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {issue.assignee.name}{issue.assignee.role ? ` — ${issue.assignee.role}` : ''}
                </span>
              )}

              {issue.routingRuleSummary && (
                <RoutingBadge ruleSummary={issue.routingRuleSummary} />
              )}
              {issue.attachedWorkflowName && (
                <WorkflowBadge workflowName={issue.attachedWorkflowName} />
              )}
              {activeRun && <RunStatusBadge status={activeRun.status} />}
              {!activeRun && latestRun?.routingTier && (
                <RoutingTierBadge tier={latestRun.routingTier} />
              )}
              {!activeRun && latestRun?.status === 'completed' && (
                <CostDisplay costUsd={latestRun.costUsd} costTokens={latestRun.costTokens} />
              )}
              {!activeRun && latestRun?.status === 'failed' && (
                <RunStatusBadge status="failed" />
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              {issue.commentCount > 0 && (
                <span
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '3px',
                    fontSize: '11px',
                    color: tokens.colorNeutralForeground2,
                  }}
                >
                  <Comment20Regular style={{ verticalAlign: 'middle', marginRight: '3px' }} />{issue.commentCount}
                </span>
              )}
              {activeRun?.status === 'running' && (
                <Button
                  size="small"
                  appearance="subtle"
                  icon={<Eye20Regular />}
                  title="Watch live run"
                  aria-label="Watch live run"
                  data-testid="watch-run-button"
                  onClick={(e) => {
                    e.stopPropagation()
                    navigate(`/projects/${projectId}/issues/${issue.id}/runs/${activeRun.id}/live`)
                  }}
                />
              )}
              {runHint && (
                <span style={{ color: tokens.colorNeutralForeground2, fontSize: '11px', whiteSpace: 'nowrap' }}>
                  {runHint}
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </Draggable>
  )
}
