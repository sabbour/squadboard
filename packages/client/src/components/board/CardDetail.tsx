import { useEffect, useRef } from 'react'
import { type Issue } from '../../api/issues.ts'
import { useLabels } from '../../api/labels.ts'
import LabelBadge from '../LabelBadge.tsx'
import Avatar from '../Avatar.tsx'
import CommentList from './CommentList.tsx'
import AddComment from './AddComment.tsx'
import { formatDistanceToNow } from 'date-fns'

interface CardDetailProps {
  projectId: string
  issue: Issue
  onClose: () => void
}

export default function CardDetail({ projectId, issue, onClose }: CardDetailProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const { data: labels } = useLabels(projectId)

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
          background: '#161b22',
          borderLeft: '1px solid #30363d',
          display: 'flex',
          flexDirection: 'column',
          overflowY: 'auto',
        }}
      >
        {/* Panel header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 20px',
            borderBottom: '1px solid #30363d',
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontSize: '11px',
              color: '#8b949e',
              background: '#21262d',
              border: '1px solid #30363d',
              borderRadius: '4px',
              padding: '2px 8px',
            }}
          >
            {COLUMN_LABELS[issue.column] ?? issue.column}
          </span>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: '#8b949e',
              fontSize: '18px',
              cursor: 'pointer',
              padding: '2px 6px',
              borderRadius: '4px',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '#e6edf3' }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '#8b949e' }}
          >
            ✕
          </button>
        </div>

        {/* Panel body */}
        <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '20px', flex: 1 }}>
          {/* Title */}
          <h2 style={{ fontSize: '16px', fontWeight: 600, color: '#e6edf3', lineHeight: '1.4' }}>
            {issue.title}
          </h2>

          {/* Meta: assignee + created */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            {issue.assignee && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Avatar name={issue.assignee.name} avatarUrl={issue.assignee.avatarUrl} size={20} />
                <span style={{ fontSize: '12px', color: '#8b949e' }}>{issue.assignee.name}</span>
              </div>
            )}
            <span style={{ fontSize: '12px', color: '#8b949e' }}>
              {formatDistanceToNow(new Date(issue.createdAt), { addSuffix: true })}
            </span>
          </div>

          {/* Labels */}
          {issue.labels.length > 0 && (
            <div>
              <p style={{ fontSize: '11px', color: '#8b949e', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Labels
              </p>
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
              <p style={{ fontSize: '11px', color: '#8b949e', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                All Labels
              </p>
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
              <p style={{ fontSize: '11px', color: '#8b949e', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Description
              </p>
              <div
                style={{
                  background: '#0d1117',
                  border: '1px solid #30363d',
                  borderRadius: '6px',
                  padding: '12px',
                  fontSize: '13px',
                  color: '#e6edf3',
                  lineHeight: '1.6',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {issue.body}
              </div>
            </div>
          )}

          {/* Comments */}
          <div>
            <p style={{ fontSize: '11px', color: '#8b949e', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Comments
            </p>
            <CommentList projectId={projectId} issueId={issue.id} />
          </div>

          <AddComment projectId={projectId} issueId={issue.id} />
        </div>
      </div>
    </div>
  )
}
