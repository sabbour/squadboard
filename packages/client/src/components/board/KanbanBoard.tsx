import { DragDropContext, type DropResult } from '@hello-pangea/dnd'
import { useState, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { tokens } from '@fluentui/react-components'
import { type Issue, type ColumnId, useMoveIssue } from '../../api/issues.ts'
import { useColumnMeta } from '../../api/columns.ts'
import KanbanColumn from './KanbanColumn.tsx'

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
  const { data: columnMetaList, isLoading: columnsLoading } = useColumnMeta(projectId)

  const displayIssues = optimisticIssues ?? issues

  const issuesByColumn = useCallback(
    (columnId: string) => displayIssues.filter((i) => i.column === columnId),
    [displayIssues]
  )

  function onDragEnd(result: DropResult) {
    const { draggableId, destination, source } = result
    if (!destination) return
    if (destination.droppableId === source.droppableId && destination.index === source.index) return

    const targetColumn = destination.droppableId

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

  // Skeleton row while column metadata is loading
  if (columnsLoading || !columnMetaList) {
    return (
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
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            style={{
              width: '280px',
              height: '200px',
              background: tokens.colorNeutralBackground2,
              borderRadius: '8px',
              flexShrink: 0,
              opacity: 0.4,
            }}
          />
        ))}
      </div>
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
        {columnMetaList.map((meta) => (
          <KanbanColumn
            key={meta.columnId}
            columnId={meta.columnId}
            label={meta.label}
            description={meta.description}
            color={meta.color}
            issues={issuesByColumn(meta.columnId)}
            projectId={projectId}
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

