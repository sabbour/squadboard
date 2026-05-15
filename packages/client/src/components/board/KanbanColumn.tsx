import { Droppable } from '@hello-pangea/dnd'
import { tokens, Tooltip } from '@fluentui/react-components'
import { type Issue, type ColumnId } from '../../api/issues.ts'
import IssueCard from './IssueCard.tsx'

interface KanbanColumnProps {
  columnId: ColumnId
  label: string
  description?: string | null
  color?: string
  issues: Issue[]
  projectId: string
  selectedIds: Set<string>
  onSelect: (id: string, shiftKey: boolean) => void
  onOpenCard: (issue: Issue) => void
  onCreateIssue: (column: ColumnId) => void
}

export default function KanbanColumn({
  columnId,
  label,
  description,
  color,
  issues,
  projectId,
  selectedIds,
  onSelect,
  onOpenCard,
  onCreateIssue,
}: KanbanColumnProps) {
  const accentColor = color ?? tokens.colorNeutralStroke1

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '280px',
        flexShrink: 0,
        background: tokens.colorNeutralBackground2,
        borderRadius: '8px',
        overflow: 'hidden',
        borderLeft: `4px solid ${accentColor}`,
      }}
    >
      {/* Column header */}
      <div
        style={{
          padding: '10px 12px',
          background: tokens.colorNeutralBackground3,
          borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
          display: 'flex',
          flexDirection: 'column',
          gap: '4px',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
            <span
              style={{
                fontSize: '13px',
                fontWeight: 600,
                color: tokens.colorNeutralForeground1,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
              title={label}
            >
              {label}
            </span>
            <span
              style={{
                fontSize: '11px',
                color: tokens.colorNeutralForeground2,
                background: tokens.colorNeutralBackground4,
                border: `1px solid ${tokens.colorNeutralStroke1}`,
                borderRadius: '10px',
                padding: '0 6px',
                lineHeight: '18px',
                flexShrink: 0,
              }}
            >
              {issues.length}
            </span>
          </div>
          {/* FAB: create issue in this column */}
          <button
            onClick={() => onCreateIssue(columnId)}
            title="Create issue"
            style={{
              background: 'none',
              border: 'none',
              color: tokens.colorNeutralForeground2,
              fontSize: '18px',
              lineHeight: 1,
              padding: '0 2px',
              borderRadius: '4px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              flexShrink: 0,
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = tokens.colorBrandBackground }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = tokens.colorNeutralForeground2 }}
          >
            +
          </button>
        </div>

        {description && (
          <Tooltip content={description} relationship="description" positioning="below">
            <span
              style={{
                fontSize: '11px',
                color: tokens.colorNeutralForeground2,
                lineHeight: 1.35,
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                cursor: 'help',
              }}
            >
              {description}
            </span>
          </Tooltip>
        )}
      </div>

      {/* Droppable card list */}
      <Droppable droppableId={columnId}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            style={{
              flex: 1,
              padding: '8px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              minHeight: '80px',
              background: snapshot.isDraggingOver ? 'rgba(56,139,253,0.05)' : 'transparent',
              transition: 'background 0.15s',
            }}
          >
            {issues.length === 0 && !snapshot.isDraggingOver && (
              <div
                style={{
                  border: `1px dashed ${tokens.colorNeutralStroke1}`,
                  borderRadius: '6px',
                  padding: '16px',
                  textAlign: 'center',
                  color: tokens.colorNeutralForeground2,
                  fontSize: '12px',
                  flex: 1,
                }}
              >
                Drop cards here
              </div>
            )}
            {issues.map((issue, index) => (
              <IssueCard
                key={issue.id}
                issue={issue}
                index={index}
                projectId={projectId}
                isSelected={selectedIds.has(issue.id)}
                onSelect={onSelect}
                onOpen={onOpenCard}
              />
            ))}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </div>
  )
}
