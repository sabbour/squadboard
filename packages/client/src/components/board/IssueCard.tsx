import { Draggable } from '@hello-pangea/dnd'
import { useState, useRef, useEffect, type ReactNode } from 'react'
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
  PersonSwap20Regular,
} from '@fluentui/react-icons'
import { type Issue, useAssignIssue } from '../../api/issues.ts'
import { useIssueRuns } from '../../api/runs.ts'
import { useActiveAgents } from '../../api/agents.ts'
import LabelBadge from '../LabelBadge.tsx'
import Avatar from '../Avatar.tsx'
import RunButton from '../runs/RunButton.tsx'
import RunStatusBadge from '../runs/RunStatusBadge.tsx'
import CostDisplay from '../runs/CostDisplay.tsx'
import { RoutingBadge } from './RoutingBadge.tsx'
import { WorkflowBadge } from './WorkflowBadge.tsx'
import { RoutingTierBadge } from '../routing/RoutingTierBadge.tsx'

interface IssueCardProps {
  issue: Issue
  index: number
  projectId: string
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

export default function IssueCard({ issue, index, projectId, isSelected, onSelect, onOpen }: IssueCardProps) {
  const [hovered, setHovered] = useState(false)
  const [reassignOpen, setReassignOpen] = useState(false)
  const reassignRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const { data: runs } = useIssueRuns(projectId, issue.id)
  const { data: agents } = useActiveAgents(projectId)
  const assignIssue = useAssignIssue(projectId)
  const activeRun = runs?.find((r) => r.status === 'running' || r.status === 'pending')
  const lastRun = runs?.[0]

  // Close reassign dropdown on outside click
  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (reassignRef.current && !reassignRef.current.contains(e.target as Node)) {
        setReassignOpen(false)
      }
    }
    if (reassignOpen) document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [reassignOpen])

  return (
    <Draggable draggableId={issue.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
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
              {/* Reassign affordance: avatar (or placeholder) opens agent picker */}
              <div ref={reassignRef} style={{ position: 'relative' }}>
                <button
                  title={issue.assignee ? `Reassign (currently ${issue.assignee.name})` : 'Assign agent'}
                  onClick={(e) => { e.stopPropagation(); setReassignOpen((v) => !v) }}
                  style={{
                    background: 'none',
                    border: reassignOpen ? `1px solid ${tokens.colorBrandBackground}` : '1px solid transparent',
                    borderRadius: '50%',
                    padding: '0',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '24px',
                    height: '24px',
                    position: 'relative',
                  }}
                >
                  {issue.assignee ? (
                    <Avatar name={issue.assignee.name} avatarUrl={issue.assignee.avatarUrl} size={20} />
                  ) : (
                    <PersonSwap20Regular style={{ color: tokens.colorNeutralForeground3, width: '16px', height: '16px' }} />
                  )}
                </button>

                {reassignOpen && (
                  <div
                    style={{
                      position: 'absolute',
                      bottom: '100%',
                      left: 0,
                      marginBottom: '4px',
                      background: tokens.colorNeutralBackground1,
                      border: `1px solid ${tokens.colorNeutralStroke1}`,
                      borderRadius: '6px',
                      minWidth: '160px',
                      zIndex: 200,
                      overflow: 'hidden',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                    }}
                  >
                    {(agents ?? []).length === 0 && (
                      <div style={{ padding: '8px 12px', fontSize: '12px', color: tokens.colorNeutralForeground3 }}>No active agents</div>
                    )}
                    {(agents ?? []).map((agent) => (
                      <button
                        key={agent.id}
                        onClick={(e) => {
                          e.stopPropagation()
                          assignIssue.mutate({ issueId: issue.id, assigneeId: agent.id })
                          setReassignOpen(false)
                        }}
                        style={{
                          display: 'block',
                          width: '100%',
                          textAlign: 'left',
                          background: issue.assignee?.id === agent.id ? 'rgba(56,139,253,0.13)' : 'none',
                          border: 'none',
                          color: tokens.colorNeutralForeground1,
                          padding: '7px 12px',
                          fontSize: '12px',
                          cursor: 'pointer',
                        }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(56,139,253,0.13)' }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = issue.assignee?.id === agent.id ? 'rgba(56,139,253,0.13)' : 'none' }}
                      >
                        {agent.name}
                      </button>
                    ))}
                    {issue.assignee && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          assignIssue.mutate({ issueId: issue.id, assigneeId: null })
                          setReassignOpen(false)
                        }}
                        style={{
                          display: 'block',
                          width: '100%',
                          textAlign: 'left',
                          background: 'none',
                          border: 'none',
                          borderTop: `1px solid ${tokens.colorNeutralStroke1}`,
                          color: tokens.colorNeutralForeground3,
                          padding: '7px 12px',
                          fontSize: '12px',
                          cursor: 'pointer',
                        }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = tokens.colorNeutralForeground1 }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = tokens.colorNeutralForeground3 }}
                      >
                        Unassign
                      </button>
                    )}
                  </div>
                )}
              </div>

              {issue.routingRuleSummary && (
                <RoutingBadge ruleSummary={issue.routingRuleSummary} />
              )}
              {issue.attachedWorkflowName && (
                <WorkflowBadge workflowName={issue.attachedWorkflowName} />
              )}
              {activeRun && <RunStatusBadge status={activeRun.status} />}
              {!activeRun && lastRun?.routingTier && (
                <RoutingTierBadge tier={lastRun.routingTier} />
              )}
              {!activeRun && lastRun?.status === 'completed' && (
                <CostDisplay costUsd={lastRun.costUsd} costTokens={lastRun.costTokens} />
              )}
              {!activeRun && lastRun?.status === 'failed' && (
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
              <RunButton
                projectId={projectId}
                issueId={issue.id}
              />
            </div>
          </div>
        </div>
      )}
    </Draggable>
  )
}
