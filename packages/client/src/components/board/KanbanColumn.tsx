import { Droppable } from '@hello-pangea/dnd'
import { type Issue, type ColumnId } from '../../api/issues.ts'
import IssueCard from './IssueCard.tsx'

interface KanbanColumnProps {
  columnId: ColumnId
  label: string
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
  issues,
  projectId,
  selectedIds,
  onSelect,
  onOpenCard,
  onCreateIssue,
}: KanbanColumnProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '280px',
        flexShrink: 0,
        background: '#161b22',
        borderRadius: '8px',
        overflow: 'hidden',
      }}
    >
      {/* Column header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 12px',
          background: '#0d1117',
          borderBottom: '1px solid #30363d',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '13px', fontWeight: 600, color: '#e6edf3' }}>{label}</span>
          <span
            style={{
              fontSize: '11px',
              color: '#8b949e',
              background: '#21262d',
              border: '1px solid #30363d',
              borderRadius: '10px',
              padding: '0 6px',
              lineHeight: '18px',
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
            color: '#8b949e',
            fontSize: '18px',
            lineHeight: 1,
            padding: '0 2px',
            borderRadius: '4px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '#388bfd' }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '#8b949e' }}
        >
          +
        </button>
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
                  border: '1px dashed #30363d',
                  borderRadius: '6px',
                  padding: '16px',
                  textAlign: 'center',
                  color: '#8b949e',
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
