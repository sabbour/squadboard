import { Draggable } from '@hello-pangea/dnd'
import { useState } from 'react'
import { type Issue } from '../../api/issues.ts'
import LabelBadge from '../LabelBadge.tsx'
import Avatar from '../Avatar.tsx'

interface IssueCardProps {
  issue: Issue
  index: number
  isSelected: boolean
  onSelect: (id: string, shiftKey: boolean) => void
  onOpen: (issue: Issue) => void
}

export default function IssueCard({ issue, index, isSelected, onSelect, onOpen }: IssueCardProps) {
  const [hovered, setHovered] = useState(false)

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

            {/* Footer: assignee + comment count */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '6px' }}>
              <div>
                {issue.assignee && (
                  <Avatar name={issue.assignee.name} avatarUrl={issue.assignee.avatarUrl} size={20} />
                )}
              </div>
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
            </div>
          </div>
        </div>
      )}
    </Draggable>
  )
}
