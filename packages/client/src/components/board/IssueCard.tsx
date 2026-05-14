import { Draggable } from '@hello-pangea/dnd'
import { useState } from 'react'
import { type Issue } from '../../api/issues.ts'
import { useIssueRuns } from '../../api/runs.ts'
import LabelBadge from '../LabelBadge.tsx'
import Avatar from '../Avatar.tsx'
import RunButton from '../runs/RunButton.tsx'
import RunStatusBadge from '../runs/RunStatusBadge.tsx'
import CostDisplay from '../runs/CostDisplay.tsx'
import { RoutingBadge } from './RoutingBadge.tsx'
import { WorkflowBadge } from './WorkflowBadge.tsx'

interface IssueCardProps {
  issue: Issue
  index: number
  projectId: string
  isSelected: boolean
  onSelect: (id: string, shiftKey: boolean) => void
  onOpen: (issue: Issue) => void
}

export default function IssueCard({ issue, index, projectId, isSelected, onSelect, onOpen }: IssueCardProps) {
  const [hovered, setHovered] = useState(false)
  const { data: runs } = useIssueRuns(projectId, issue.id)
  const activeRun = runs?.find((r) => r.status === 'running' || r.status === 'pending')
  const lastRun = runs?.[0]

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
            background: '#21262d',
            border: `1px solid ${isSelected ? '#388bfd' : snapshot.isDragging ? '#388bfd' : hovered ? '#388bfd' : '#30363d'}`,
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

          {/* Title */}
          <div
            onClick={() => onOpen(issue)}
            style={{ cursor: 'pointer', paddingRight: '20px' }}
          >
            <p
              style={{
                fontSize: '13px',
                fontWeight: 500,
                color: '#e6edf3',
                lineHeight: '1.4',
                marginBottom: issue.labels.length > 0 ? '8px' : '0',
              }}
            >
              {issue.title}
            </p>

            {/* Labels */}
            {issue.labels.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '8px' }}>
                {issue.labels.map((label) => (
                  <LabelBadge key={label.id} name={label.name} color={label.color} />
                ))}
              </div>
            )}

            {/* Footer: assignee + comment count + run */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '6px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                {issue.assignee && (
                  <Avatar name={issue.assignee.name} avatarUrl={issue.assignee.avatarUrl} size={20} />
                )}
                {issue.routingRuleSummary && (
                  <RoutingBadge ruleSummary={issue.routingRuleSummary} />
                )}
                {issue.attachedWorkflowName && (
                  <WorkflowBadge workflowName={issue.attachedWorkflowName} />
                )}
                {activeRun && <RunStatusBadge status={activeRun.status} />}
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
                      color: '#8b949e',
                    }}
                  >
                    💬 {issue.commentCount}
                  </span>
                )}
                <RunButton
                  projectId={projectId}
                  issueId={issue.id}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </Draggable>
  )
}
