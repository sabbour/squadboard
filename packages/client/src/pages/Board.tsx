import { useState, useCallback } from 'react'
import { useParams } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useProject } from '../api/projects.ts'
import { useIssues, useBulkAction, type Issue, type ColumnId } from '../api/issues.ts'
import KanbanBoard from '../components/board/KanbanBoard.tsx'
import FilterBar from '../components/board/FilterBar.tsx'
import CardDetail from '../components/board/CardDetail.tsx'
import BulkActionBar from '../components/board/BulkActionBar.tsx'
import CreateIssueModal from '../components/board/CreateIssueModal.tsx'
import PresenceBar from '../components/board/PresenceBar.tsx'
import ConflictToast from '../components/board/ConflictToast.tsx'
import { useRealtimeBoard } from '../realtime/useRealtimeBoard.ts'

export default function Board() {
  const { id } = useParams<{ id: string }>()
  const projectId = id ?? ''

  const { data: project, isLoading: projectLoading, isError: projectError } = useProject(projectId)
  const queryClient = useQueryClient()

  // Realtime: WS connection + live cache updates
  const { connected, presenceList } = useRealtimeBoard(projectId)

  // Conflict toast state (shown when an issue update returns 409)
  const [showConflict, setShowConflict] = useState(false)

  // Filter state
  const [search, setSearch] = useState('')
  const [activeLabelId, setActiveLabelId] = useState<string | undefined>()

  // Issues (API-filtered by label; client-filtered by search)
  const { data: allIssues = [], isLoading: issuesLoading } = useIssues(projectId, { labelId: activeLabelId })

  const filteredIssues = search.trim()
    ? allIssues.filter((i) => i.title.toLowerCase().includes(search.toLowerCase()))
    : allIssues

  // Card detail slide-over
  const [activeCard, setActiveCard] = useState<Issue | null>(null)

  // Multi-select
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const handleSelect = useCallback((issueId: string, shiftKey: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (shiftKey) {
        // Shift-click: toggle
        if (next.has(issueId)) next.delete(issueId)
        else next.add(issueId)
      } else {
        if (next.has(issueId)) next.delete(issueId)
        else next.add(issueId)
      }
      return next
    })
  }, [])

  // Bulk actions
  const bulkAction = useBulkAction(projectId)

  function handleBulkMove(column: ColumnId) {
    bulkAction.mutate(
      { issueIds: Array.from(selectedIds), action: 'move', column },
      { onSuccess: () => setSelectedIds(new Set()) }
    )
  }

  function handleBulkArchive() {
    bulkAction.mutate(
      { issueIds: Array.from(selectedIds), action: 'archive' },
      { onSuccess: () => setSelectedIds(new Set()) }
    )
  }

  // Create issue modal
  const [createColumn, setCreateColumn] = useState<ColumnId | null>(null)

  // ── Loading / error states ────────────────────────────────────────────
  if (projectLoading) {
    return <div style={{ padding: '32px', color: 'var(--text-muted)' }}>Loading project…</div>
  }

  if (projectError || !project) {
    return (
      <div style={{ padding: '32px', color: 'var(--danger)' }}>
        Failed to load project. Make sure the backend is running.
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Board header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
          padding: '16px 24px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}
      >
        <div>
          <h1 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--text)' }}>
            {project.name}
          </h1>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: 'monospace', marginTop: '2px' }}>
            {project.squadPath}
          </p>
        </div>
        <span
          style={{
            fontSize: '11px',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: '4px',
            padding: '3px 8px',
            color: 'var(--text-muted)',
          }}
        >
          Demo 12
        </span>

        {/* Live presence avatars + connection dot */}
        <PresenceBar
          users={presenceList}
          connected={connected}
          issueTitles={Object.fromEntries(
            (allIssues ?? []).map((i) => [i.id, i.title])
          )}
        />
      </div>

      {/* Filter bar */}
      <FilterBar
        projectId={projectId}
        search={search}
        onSearchChange={setSearch}
        activeLabelId={activeLabelId}
        onLabelChange={setActiveLabelId}
      />

      {/* Board body */}
      <div style={{ flex: 1, overflow: 'auto', padding: '16px 24px' }}>
        {issuesLoading ? (
          <div style={{ color: 'var(--text-muted)', padding: '16px' }}>Loading issues…</div>
        ) : (
          <KanbanBoard
            projectId={projectId}
            issues={filteredIssues}
            selectedIds={selectedIds}
            onSelect={handleSelect}
            onOpenCard={setActiveCard}
            onCreateIssue={setCreateColumn}
          />
        )}
      </div>

      {/* Card detail slide-over */}
      {activeCard && (
        <CardDetail
          projectId={projectId}
          issue={activeCard}
          onClose={() => setActiveCard(null)}
        />
      )}

      {/* Bulk action bar */}
      <BulkActionBar
        selectedCount={selectedIds.size}
        onMove={handleBulkMove}
        onArchive={handleBulkArchive}
        onClear={() => setSelectedIds(new Set())}
      />

      {/* Create issue modal */}
      {createColumn && (
        <CreateIssueModal
          projectId={projectId}
          defaultColumn={createColumn}
          onClose={() => setCreateColumn(null)}
        />
      )}

      {/* 409 conflict toast */}
      {showConflict && (
        <ConflictToast
          onReload={() => {
            void queryClient.invalidateQueries({ queryKey: ['issues', projectId] })
            setShowConflict(false)
          }}
          onDismiss={() => setShowConflict(false)}
        />
      )}
    </div>
  )
}
