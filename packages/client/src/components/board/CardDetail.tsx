import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { tokens, Button, Body1Strong, Caption1, Tooltip } from '@fluentui/react-components'
import { Lightbulb20Regular } from '@fluentui/react-icons'
import { type Issue } from '../../api/issues.ts'
import { useLabels } from '../../api/labels.ts'
import { useIssueRuns } from '../../api/runs.ts'
import { useAgents } from '../../api/agents.ts'
import { useWorkflowRun, useStartWorkflow } from '../../api/workflows.ts'
import { useWorkflowRunReviews } from '../../api/reviews.ts'
import LabelBadge from '../LabelBadge.tsx'
import Avatar from '../Avatar.tsx'
import CommentList from './CommentList.tsx'
import AddComment from './AddComment.tsx'
import RunOutputPanel from '../runs/RunOutputPanel.tsx'
import RunHistory from '../runs/RunHistory.tsx'
import { AttachWorkflowModal } from '../workflows/AttachWorkflowModal.tsx'
import { ReviewPanel } from '../reviews/ReviewPanel.tsx'
import DeliverableList from '../deliverables/DeliverableList.tsx'
import { useDeliverables } from '../../api/deliverables.ts'
import IssueFlowDag from '../flow/IssueFlowDag.tsx'
import { safeRelativeTime } from '../../utils/dates.ts'
import IssueBodyMarkdown from '../issues/IssueBodyMarkdown.tsx'
import { useIssueAttachments } from '../../api/issue-attachments.ts'

interface CardDetailProps {
  projectId: string
  issue: Issue
  onClose: () => void
  initialTab?: Tab
}

type Tab = 'overview' | 'runs' | 'deliverables' | 'flow'

export default function CardDetail({ projectId, issue, onClose, initialTab }: CardDetailProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<Tab>(initialTab ?? 'overview')
  const [showAttachModal, setShowAttachModal] = useState(false)
  const { data: labels } = useLabels(projectId)
  const { data: runs } = useIssueRuns(projectId, issue.id)
  const { data: agents } = useAgents(projectId)
  const { data: workflowRun } = useWorkflowRun(projectId, issue.id)
  const { data: reviewGroups = [] } = useWorkflowRunReviews(workflowRun?.id ?? '')
  const { data: deliverables } = useDeliverables(projectId, issue.id)
  const { data: attachments } = useIssueAttachments(projectId, issue.id)
  const startWorkflow = useStartWorkflow(projectId, issue.id)

  const activeRun = runs?.find((r) => r.status === 'running' || r.status === 'pending')

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  // Close on backdrop click
  function handleBackdropClick(e: React.MouseEvent) {
    if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
      onClose()
    }
  }

  const COLUMN_LABELS: Record<string, string> = {
    backlog: 'Backlog',
    todo: 'Todo',
    in_progress: 'In Progress',
    in_review: 'In Review',
    done: 'Done',
  }

  return (
    <div
      onClick={handleBackdropClick}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        justifyContent: 'flex-end',
      }}
    >
      <div
        ref={panelRef}
        style={{
          width: '480px',
          maxWidth: '100vw',
          height: '100%',
          background: tokens.colorNeutralBackground1,
          borderLeft: `1px solid ${tokens.colorNeutralStroke1}`,
          display: 'flex',
          flexDirection: 'column',
          overflowY: 'auto',
        }}
      >
        {/* Panel header */}
        <div style={{ borderBottom: `1px solid ${tokens.colorNeutralStroke1}`, flexShrink: 0 }}>
          {/* Top bar: column badge + close */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '16px 20px 12px',
            }}
          >
            <Caption1
              style={{
                color: tokens.colorNeutralForeground2,
                background: tokens.colorNeutralBackground3,
                border: `1px solid ${tokens.colorNeutralStroke1}`,
                borderRadius: '4px',
                padding: '2px 8px',
              }}
            >
              {COLUMN_LABELS[issue.column] ?? issue.column}
            </Caption1>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Tooltip content="Consult about this issue (open Ask)" relationship="label">
                <Button
                  appearance="subtle"
                  size="small"
                  icon={<Lightbulb20Regular />}
                  onClick={() => {
                    navigate(
                      `/projects/${projectId}/consult/new?prefill=issue:${issue.id}`,
                    )
                  }}
                >
                  Consult
                </Button>
              </Tooltip>
              <button
                onClick={onClose}
                style={{
                  background: 'none',
                  border: 'none',
                  color: tokens.colorNeutralForeground2,
                  fontSize: '18px',
                  cursor: 'pointer',
                  padding: '2px 6px',
                  borderRadius: '4px',
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = tokens.colorNeutralForeground1 }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = tokens.colorNeutralForeground2 }}
              >
                ✕
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', padding: '0 20px', gap: '2px' }}>
            {(['overview', 'runs', 'deliverables', 'flow'] as Tab[]).map((tab) => {
              let label: string
              if (tab === 'overview') label = 'Overview'
              else if (tab === 'runs')
                label = runs && runs.length > 0 ? `Runs (${runs.length})` : 'Runs'
              else if (tab === 'flow') label = 'Flow'
              else
                label =
                  deliverables && deliverables.length > 0
                    ? `Deliverables (${deliverables.length})`
                    : 'Deliverables'
              return (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  style={{
                    background: 'none',
                    border: 'none',
                    borderBottom: `2px solid ${activeTab === tab ? tokens.colorBrandBackground : 'transparent'}`,
                    color: activeTab === tab ? tokens.colorNeutralForeground1 : tokens.colorNeutralForeground2,
                    padding: '6px 12px',
                    fontSize: '12px',
                    fontWeight: activeTab === tab ? tokens.fontWeightSemibold : tokens.fontWeightRegular,
                    cursor: 'pointer',
                    marginBottom: '-1px',
                  }}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Panel body */}
        <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '20px', flex: 1 }}>

          {activeTab === 'overview' && (
            <>
              {/* Title */}
              <h2 style={{ fontSize: '16px', fontWeight: tokens.fontWeightSemibold, color: tokens.colorNeutralForeground1, lineHeight: '1.4' }}>
                {issue.title}
              </h2>

              {/* Meta: assignee + created */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                {issue.assignee && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Avatar name={issue.assignee.name} avatarUrl={issue.assignee.avatarUrl} size={20} />
                    <Caption1 style={{ color: tokens.colorNeutralForeground2 }}>{issue.assignee.name}</Caption1>
                  </div>
                )}
                <Caption1 style={{ color: tokens.colorNeutralForeground2 }}>
                  {safeRelativeTime(issue.createdAt)}
                </Caption1>
              </div>

              {/* Labels */}
              {issue.labels.length > 0 && (
                <div>
                  <Caption1 as="p" style={{ display: 'block', color: tokens.colorNeutralForeground2, marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Labels
                  </Caption1>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {issue.labels.map((label) => (
                      <LabelBadge key={label.id} name={label.name} color={label.color} />
                    ))}
                  </div>
                </div>
              )}

              {/* Available labels picker */}
              {labels && labels.length > 0 && (
                <div>
                  <Caption1 as="p" style={{ display: 'block', color: tokens.colorNeutralForeground2, marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    All Labels
                  </Caption1>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {labels.map((label) => (
                      <LabelBadge key={label.id} name={label.name} color={label.color} />
                    ))}
                  </div>
                </div>
              )}

              {/* Body / description */}
              {issue.body && (
                <div>
                  <Caption1 as="p" style={{ display: 'block', color: tokens.colorNeutralForeground2, marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Description
                  </Caption1>
                  <div
                    style={{
                      background: tokens.colorNeutralBackground2,
                      border: `1px solid ${tokens.colorNeutralStroke1}`,
                      borderRadius: '6px',
                      padding: '12px',
                    }}
                  >
                    <IssueBodyMarkdown value={issue.body} />
                  </div>
                </div>
              )}

              {/* Attachments */}
              {attachments && attachments.length > 0 && (
                <div>
                  <Caption1 as="p" style={{ display: 'block', color: tokens.colorNeutralForeground2, marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Attachments
                  </Caption1>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                    {attachments.map((att) => (
                      <a
                        key={att.id}
                        href={att.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={att.filename}
                        style={{ display: 'block' }}
                      >
                        <img
                          src={att.url}
                          alt={att.filename}
                          style={{
                            width: '80px',
                            height: '60px',
                            objectFit: 'cover',
                            borderRadius: '4px',
                            border: `1px solid ${tokens.colorNeutralStroke1}`,
                          }}
                        />
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {/* Active run output panel */}
              {activeRun && (
                <div>
                  <Caption1 as="p" style={{ display: 'block', color: tokens.colorNeutralForeground2, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Active Run
                  </Caption1>
                  <RunOutputPanel
                    projectId={projectId}
                    run={activeRun}
                    agent={agents?.find((a) => a.id === activeRun.agentId)}
                  />
                </div>
              )}

              {/* Workflow section */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <Caption1 as="p" style={{ display: 'block', color: tokens.colorNeutralForeground2, textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>
                    Workflow
                  </Caption1>
                  <button
                    onClick={() => setShowAttachModal(true)}
                    style={{
                      fontSize: '11px',
                      color: tokens.colorBrandBackground,
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      padding: 0,
                    }}
                  >
                    {issue.attachedWorkflowId ? 'Change' : '+ Attach'}
                  </button>
                </div>

                {issue.attachedWorkflowId ? (
                  <div
                    style={{
                      background: tokens.colorNeutralBackground2,
                      border: `1px solid ${tokens.colorNeutralStroke1}`,
                      borderRadius: '6px',
                      padding: '10px 12px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <div>
                      <Body1Strong style={{ display: 'block', color: tokens.colorNeutralForeground1, margin: 0 }}>
                        ⚙ {issue.attachedWorkflowName ?? 'Workflow'}
                      </Body1Strong>
                      {workflowRun && (
                        <Caption1 style={{ display: 'block', color: tokens.colorNeutralForeground2, margin: '2px 0 0' }}>
                          Status: {workflowRun.status} · Step {(workflowRun.currentStepIndex ?? 0) + 1}
                        </Caption1>
                      )}
                    </div>
                    {/* Start button — only if attached but no run yet */}
                    {!workflowRun && (
                      <button
                        onClick={() => { void startWorkflow.mutateAsync() }}
                        disabled={startWorkflow.isPending}
                        style={{
                          padding: '4px 10px',
                          background: startWorkflow.isPending ? tokens.colorNeutralBackground3 : '#238636',
                          color: tokens.colorNeutralForeground1,
                          border: 'none',
                          borderRadius: '6px',
                          fontSize: '12px',
                          cursor: startWorkflow.isPending ? 'default' : 'pointer',
                          opacity: startWorkflow.isPending ? 0.5 : 1,
                        }}
                      >
                        Start Workflow
                      </button>
                    )}
                  </div>
                ) : (
                  <Caption1 style={{ color: tokens.colorNeutralForeground2 }}>No workflow attached.</Caption1>
                )}

                {/* Review panels for approve steps */}
                {reviewGroups.length > 0 && (
                  <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {reviewGroups.map((group) => (
                      <div
                        key={group.stepRunId}
                        style={{
                          background: tokens.colorNeutralBackground2,
                          border: `1px solid ${tokens.colorNeutralStroke1}`,
                          borderRadius: '6px',
                          padding: '12px',
                        }}
                      >
                        <ReviewPanel reviewGroup={group} allowHumanOverride />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {showAttachModal && (
                <AttachWorkflowModal
                  projectId={projectId}
                  issueId={issue.id}
                  onClose={() => setShowAttachModal(false)}
                />
              )}

              {/* Comments */}
              <div>
                <Caption1 as="p" style={{ display: 'block', color: tokens.colorNeutralForeground2, marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Comments
                </Caption1>
                <CommentList projectId={projectId} issueId={issue.id} />
              </div>

              <AddComment projectId={projectId} issueId={issue.id} />
            </>
          )}

          {activeTab === 'runs' && (
            <RunHistory projectId={projectId} issueId={issue.id} />
          )}

          {activeTab === 'deliverables' && (
            <DeliverableList projectId={projectId} issueId={issue.id} />
          )}

          {activeTab === 'flow' && (
            <div style={{ height: 600, marginTop: -20, marginLeft: -20, marginRight: -20, borderTop: `1px solid ${tokens.colorNeutralStroke2}` }}>
              <IssueFlowDag projectId={projectId} issueId={issue.id} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
