import { DragDropContext, type DropResult } from '@hello-pangea/dnd'
import { useState, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { type Issue, type ColumnId, useMoveIssue } from '../../api/issues.ts'
import KanbanColumn from './KanbanColumn.tsx'

const COLUMNS: { id: ColumnId; label: string }[] = [
  { id: 'backlog', label: 'Backlog' },
  { id: 'todo', label: 'Todo' },
  { id: 'in_progress', label: 'In Progress' },
  { id: 'in_review', label: 'In Review' },
  { id: 'done', label: 'Done' },
]

interface KanbanBoardProps {
  projectId: string
  issues: Issue[]
  selectedIds: Set<string>
  onSelect: (id: string, shiftKey: boolean) => void
  onOpenCard: (issue: Issue) => void
  onCreateIssue: (column: ColumnId) => void
}

export default function KanbanBoard({
  projectId,
  issues,
  selectedIds,
  onSelect,
  onOpenCard,
  onCreateIssue,
}: KanbanBoardProps) {
  const queryClient = useQueryClient()
  const moveIssue = useMoveIssue(projectId)
  const [optimisticIssues, setOptimisticIssues] = useState<Issue[] | null>(null)

  const displayIssues = optimisticIssues ?? issues

  const issuesByColumn = useCallback(
    (columnId: ColumnId) => displayIssues.filter((i) => i.column === columnId),
    [displayIssues]
  )

  function onDragEnd(result: DropResult) {
    const { draggableId, destination, source } = result
    if (!destination) return
    if (destination.droppableId === source.droppableId && destination.index === source.index) return

    const targetColumn = destination.droppableId as ColumnId

    // Optimistic update: move card in local state immediately
    const updated = displayIssues.map((issue) =>
      issue.id === draggableId ? { ...issue, column: targetColumn } : issue
    )
    setOptimisticIssues(updated)

    moveIssue.mutate(
      { issueId: draggableId, column: targetColumn, position: destination.index },
      {
        onSuccess: () => {
          setOptimisticIssues(null)
          void queryClient.invalidateQueries({ queryKey: ['issues', projectId] })
        },
        onError: () => {
          // Revert optimistic update
          setOptimisticIssues(null)
        },
      }
    )
  }

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <div
        style={{
          display: 'flex',
          gap: '12px',
          alignItems: 'flex-start',
          height: '100%',
          overflowX: 'auto',
          paddingBottom: '16px',
        }}
      >
        {COLUMNS.map((col) => (
          <KanbanColumn
            key={col.id}
            columnId={col.id}
            label={col.label}
            issues={issuesByColumn(col.id)}
            selectedIds={selectedIds}
            onSelect={onSelect}
            onOpenCard={onOpenCard}
            onCreateIssue={onCreateIssue}
          />
        ))}
      </div>
    </DragDropContext>
  )
}
