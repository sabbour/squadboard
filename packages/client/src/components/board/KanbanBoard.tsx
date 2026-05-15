import { DragDropContext, type DropResult } from '@hello-pangea/dnd'
import { useState, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { type Issue, type ColumnId, useMoveIssue } from '../../api/issues.ts'
import { useColumnMeta } from '../../api/columns.ts'
import KanbanColumn from './KanbanColumn.tsx'

const COLUMN_ORDER: ColumnId[] = ['backlog', 'todo', 'in_progress', 'in_review', 'done']

const COLUMN_FALLBACKS: Record<ColumnId, { label: string; color: string }> = {
  backlog:     { label: 'Backlog',      color: '#6e7681' },
  todo:        { label: 'To Do',        color: '#1f6feb' },
  in_progress: { label: 'In Progress',  color: '#fb950b' },
  in_review:   { label: 'In Review',    color: '#8957e5' },
  done:        { label: 'Done',         color: '#238636' },
}

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
  const { data: columnMetaList } = useColumnMeta(projectId)

  const displayIssues = optimisticIssues ?? issues

  const issuesByColumn = useCallback(
    (columnId: ColumnId) => displayIssues.filter((i) => i.column === columnId),
    [displayIssues]
  )

  function getColumnMeta(columnId: ColumnId) {
    const meta = columnMetaList?.find((m) => m.columnId === columnId)
    const fallback = COLUMN_FALLBACKS[columnId]
    return {
      label: meta?.label ?? fallback?.label ?? columnId,
      description: meta?.description ?? null,
      color: meta?.color ?? fallback?.color,
    }
  }

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
        {COLUMN_ORDER.map((colId) => {
          const meta = getColumnMeta(colId)
          return (
            <KanbanColumn
              key={colId}
              columnId={colId}
              label={meta.label}
              description={meta.description}
              color={meta.color}
              issues={issuesByColumn(colId)}
              projectId={projectId}
              selectedIds={selectedIds}
              onSelect={onSelect}
              onOpenCard={onOpenCard}
              onCreateIssue={onCreateIssue}
            />
          )
        })}
      </div>
    </DragDropContext>
  )
}
