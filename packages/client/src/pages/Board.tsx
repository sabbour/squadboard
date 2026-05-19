import { useState, useCallback, useEffect } from 'react'
import { useParams, useSearchParams } from 'react-router'
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
import ColumnSettingsPanel from '../components/board/ColumnSettingsPanel.tsx'
import { useRealtimeBoard } from '../realtime/useRealtimeBoard.ts'
import { Settings24Regular, Wand20Regular } from '@fluentui/react-icons'
import { Subtitle1, Caption1, Body1, tokens } from '@fluentui/react-components'
import { useConjure } from '../context/ConjureContext.tsx'

export default function Board() {
  const { id } = useParams<{ id: string }>()
  const projectId = id ?? ''
  const { openConjure } = useConjure()

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
  const [initialTab, setInitialTab] = useState<'overview' | 'runs' | 'outputs' | 'flow' | undefined>()

  // Phase 12: support deep-linking via ?openIssue=X&tab=flow|runs|...
  // Used by the project Flow board to jump straight into an issue's DAG.
  const [searchParams, setSearchParams] = useSearchParams()
  useEffect(() => {
    const openIssue = searchParams.get('openIssue')
    if (!openIssue || activeCard?.id === openIssue) return
    const target = allIssues.find((i) => i.id === openIssue)
    if (!target) return
    const tabParam = searchParams.get('tab')
    const tab =
      tabParam === 'deliverables'
        ? 'outputs'
        : tabParam === 'flow' || tabParam === 'runs' || tabParam === 'outputs' || tabParam === 'overview'
          ? tabParam
          : undefined
    setActiveCard(target)
    setInitialTab(tab)
    // Strip the query so refreshes don't keep popping the panel open
    const next = new URLSearchParams(searchParams)
    next.delete('openIssue')
    next.delete('tab')
    setSearchParams(next, { replace: true })
  }, [allIssues, searchParams, setSearchParams, activeCard?.id])

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

  // Column settings panel
  const [columnSettingsOpen, setColumnSettingsOpen] = useState(false)

  // ── Loading / error states ────────────────────────────────────────────
  if (projectLoading) {
    return (
      <div style={{ padding: '32px' }}>
        <Body1 style={{ color: tokens.colorNeutralForeground3 }}>Loading project…</Body1>
      </div>
    )
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
          <Subtitle1 as="h1" style={{ display: 'block', color: tokens.colorNeutralForeground1 }}>
            {project.name}
          </Subtitle1>
          <Caption1
            style={{
              display: 'block',
              color: tokens.colorNeutralForeground3,
              fontFamily: tokens.fontFamilyMonospace,
              marginTop: tokens.spacingVerticalXXS,
            }}
          >
            {project.squadPath}
          </Caption1>
        </div>
        {/* Live presence avatars + connection dot */}
        <PresenceBar
          users={presenceList}
          connected={connected}
          issueTitles={Object.fromEntries(
            (allIssues ?? []).map((i) => [i.id, i.title])
          )}
        />
        {/* Customize columns gear button */}
        <button
          onClick={() => setColumnSettingsOpen(true)}
          title="Customize columns"
          aria-label="Customize columns"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: tokens.colorNeutralForeground2,
            display: 'flex',
            alignItems: 'center',
            padding: '6px',
            borderRadius: '6px',
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = tokens.colorNeutralForeground1 }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = tokens.colorNeutralForeground2 }}
        >
          <Settings24Regular />
        </button>
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
          <div style={{ padding: '16px' }}>
            <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>Loading issues…</Caption1>
          </div>
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
          initialTab={initialTab}
          onClose={() => { setActiveCard(null); setInitialTab(undefined) }}
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

      {/* Wave 22: FAB opens ConjureModal biased with hint=issue (95% of board captures are issues) */}
      <button
        type="button"
        aria-label="Conjure (create something)"
        title="Conjure (c or Ctrl+K)"
        onClick={() => openConjure({ hint: 'issue', projectId })}
        style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          width: '56px',
          height: '56px',
          borderRadius: '50%',
          background: tokens.colorBrandBackground,
          border: 'none',
          color: '#fff',
          cursor: 'pointer',
          boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 200,
          transition: 'transform 0.1s ease',
        }}
        onMouseDown={(e) => { e.currentTarget.style.transform = 'scale(0.95)' }}
        onMouseUp={(e) => { e.currentTarget.style.transform = 'scale(1)' }}
        onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)' }}
      >
        <Wand20Regular />
      </button>

      {/* Column settings drawer */}
      {columnSettingsOpen && (
        <ColumnSettingsPanel
          projectId={projectId}
          onClose={() => setColumnSettingsOpen(false)}
        />
      )}
    </div>
  )
}
