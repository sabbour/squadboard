/**
 * CeremonyList.tsx — Fluent2 DataGrid list of ceremonies for a project.
 *
 * Columns: Name (clickable), Trigger (Badge), Kind (Badge), Created (relative + Tooltip).
 * Toolbar: Review-drafts subtle button with CounterBadge + End wave button + primary New-ceremony button.
 * Empty state: centred card with CTA when no ceremonies exist.
 */

import { useState } from 'react'
import { useParams, useNavigate } from 'react-router'
import { useProject } from '../api/projects.ts'
import {
  useCeremonies,
  useDraftCeremonies,
  type Ceremony,
} from '../api/ceremonies.ts'
import { apiFetch } from '../api/client.ts'
import PageHeader from '../components/layout/PageHeader.tsx'
import { TriggerBadge, KindBadge, ScopeBadge } from '../components/ceremony/CeremonyBadges.tsx'
import { safeRelativeTime, safeAbsoluteTime } from '../utils/dates.ts'
import { ActionLoading } from '../components/loading/index.tsx'
import {
  Button,
  Caption1,
  Body1,
  Subtitle1,
  CounterBadge,
  Tooltip,
  Spinner,
  tokens,
  DataGrid,
  DataGridHeader,
  DataGridHeaderCell,
  DataGridBody,
  DataGridRow,
  DataGridCell,
  TableCellLayout,
  createTableColumn,
  type TableColumnDefinition,
  Dialog,
  DialogTrigger,
  DialogSurface,
  DialogTitle,
  DialogBody,
  DialogContent,
  DialogActions,
  MessageBar,
  MessageBarBody,
} from '@fluentui/react-components'
import { Add16Regular, Flag20Regular } from '@fluentui/react-icons'

const columns: TableColumnDefinition<Ceremony>[] = [
  createTableColumn<Ceremony>({
    columnId: 'name',
    renderHeaderCell: () => 'Name',
    renderCell: (item) => (
      <TableCellLayout style={{ fontWeight: tokens.fontWeightSemibold }}>{item.name}</TableCellLayout>
    ),
  }),
  createTableColumn<Ceremony>({
    columnId: 'trigger',
    renderHeaderCell: () => 'Trigger',
    renderCell: (item) => <TriggerBadge kind={item.triggerKind} />,
  }),
  createTableColumn<Ceremony>({
    columnId: 'kind',
    renderHeaderCell: () => 'Kind',
    renderCell: (item) => <KindBadge kind={item.kind} />,
  }),
  createTableColumn<Ceremony>({
    columnId: 'scope',
    renderHeaderCell: () => 'Scope',
    renderCell: (item) => <ScopeBadge triggerKind={item.triggerKind} triggerConfig={item.triggerConfig} />,
  }),
  createTableColumn<Ceremony>({
    columnId: 'created',
    renderHeaderCell: () => 'Created',
    renderCell: (item) => (
      <Tooltip content={safeAbsoluteTime(item.createdAt)} relationship="label">
        <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>
          {safeRelativeTime(item.createdAt)}
        </Caption1>
      </Tooltip>
    ),
  }),
]

export default function CeremonyList() {
  const { id } = useParams<{ id: string }>()
  const projectId = id ?? ''
  const navigate = useNavigate()

  const { data: project } = useProject(projectId)
  const { data: ceremonies, isLoading, isError } = useCeremonies(projectId)
  const { data: drafts } = useDraftCeremonies(projectId)
  const draftCount = drafts?.length ?? 0

  // End Wave state
  const [endWaveOpen, setEndWaveOpen] = useState(false)
  const [endWaveRunning, setEndWaveRunning] = useState(false)
  const [endWaveToast, setEndWaveToast] = useState<{ kind: 'success' | 'error'; msg: string } | null>(null)

  async function handleEndWave() {
    setEndWaveRunning(true)
    setEndWaveToast({ kind: 'success', msg: 'Running Scribe close-out…' })
    setEndWaveOpen(false)
    try {
      const result = await apiFetch<{ ok: boolean; result?: { commitSha?: string } }>(
        `/api/projects/${projectId}/ceremonies/invoke`,
        {
          method: 'POST',
          body: JSON.stringify({ ceremonySlug: 'scribe-close-out', context: { projectId } }),
        },
      )
      const sha = result?.result?.commitSha
      setEndWaveToast({
        kind: 'success',
        msg: sha ? `Wave closed — commit ${sha.slice(0, 7)}` : 'Wave closed',
      })
    } catch (err) {
      setEndWaveToast({ kind: 'error', msg: err instanceof Error ? err.message : 'End wave failed' })
    } finally {
      setEndWaveRunning(false)
      setTimeout(() => setEndWaveToast(null), 8000)
    }
  }

  const toolbar = (
    <div style={{ display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalS }}>
      {draftCount > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalXS }}>
          <Button
            appearance="subtle"
            onClick={() => navigate(`/projects/${projectId}/ceremonies/review`)}
          >
            Review drafts
          </Button>
          <CounterBadge count={draftCount} color="brand" size="small" />
        </div>
      )}
      <Tooltip content="Manually trigger end-of-wave Scribe close-out" relationship="description">
        <Button
          appearance="subtle"
          icon={endWaveRunning ? <ActionLoading label="Ending wave…" /> : <Flag20Regular />}
          disabled={endWaveRunning}
          onClick={() => setEndWaveOpen(true)}
        >
          End wave
        </Button>
      </Tooltip>
      <Button
        appearance="primary"
        icon={<Add16Regular />}
        onClick={() => navigate(`/projects/${projectId}/ceremonies/new`)}
      >
        New ceremony
      </Button>
    </div>
  )

  if (isLoading) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          background: tokens.colorNeutralBackground1,
        }}
      >
        <PageHeader
          eyebrow={project?.name?.toUpperCase()}
          title="Ceremonies"
          description="Workflows, narratives, and review policies — anything triggered by an event, schedule, or hand."
          actions={toolbar}
        />
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Spinner label="Loading ceremonies…" />
        </div>
      </div>
    )
  }

  if (isError) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          background: tokens.colorNeutralBackground1,
        }}
      >
        <PageHeader
          eyebrow={project?.name?.toUpperCase()}
          title="Ceremonies"
          description="Workflows, narratives, and review policies — anything triggered by an event, schedule, or hand."
          actions={toolbar}
        />
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: tokens.colorPaletteRedForeground1,
          }}
        >
          <Caption1>Failed to load ceremonies.</Caption1>
        </div>
      </div>
    )
  }

  const hasCeremonies = ceremonies && ceremonies.length > 0

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: tokens.colorNeutralBackground1,
      }}
    >
      {/* End Wave confirmation dialog */}
      <Dialog open={endWaveOpen} onOpenChange={(_, d) => { if (!endWaveRunning) setEndWaveOpen(d.open) }}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>End the current wave?</DialogTitle>
            <DialogContent>
              <Body1>
                This will run Scribe close-out: merge inbox decisions into{' '}
                <strong>decisions.md</strong>, archive old history, and commit. Takes ~30 seconds.
              </Body1>
            </DialogContent>
            <DialogActions>
              <DialogTrigger disableButtonEnhancement>
                <Button appearance="secondary" disabled={endWaveRunning}>Cancel</Button>
              </DialogTrigger>
              <Button
                appearance="primary"
                icon={endWaveRunning ? <ActionLoading label="Ending wave…" /> : <Flag20Regular />}
                disabled={endWaveRunning}
                onClick={() => void handleEndWave()}
              >
                End wave
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      {/* End Wave toast */}
      {endWaveToast && (
        <div style={{ padding: '8px 24px 0' }}>
          <MessageBar intent={endWaveToast.kind === 'success' ? 'success' : 'error'}>
            <MessageBarBody>{endWaveToast.msg}</MessageBarBody>
          </MessageBar>
        </div>
      )}

      <PageHeader
        eyebrow={project?.name?.toUpperCase()}
        title="Ceremonies"
        description="Workflows, narratives, and review policies — anything triggered by an event, schedule, or hand."
        actions={toolbar}
      />

      {!hasCeremonies ? (
        /* Empty state — Fluent2 page padding (24px both axes) */
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: tokens.spacingVerticalM,
            paddingTop: tokens.spacingVerticalXXL,
            paddingBottom: tokens.spacingVerticalXXL,
            paddingLeft: tokens.spacingHorizontalXXL,
            paddingRight: tokens.spacingHorizontalXXL,
          }}
        >
          <Subtitle1 style={{ color: tokens.colorNeutralForeground1 }}>
            No ceremonies yet
          </Subtitle1>
          <Body1 style={{ color: tokens.colorNeutralForeground3, textAlign: 'center', maxWidth: 400 }}>
            Ceremonies are scheduled or triggered automations — a sequence of steps that run on a
            schedule, an event, or on demand.
          </Body1>
          <Button
            appearance="primary"
            icon={<Add16Regular />}
            onClick={() => navigate(`/projects/${projectId}/ceremonies/new`)}
          >
            New ceremony
          </Button>
        </div>
      ) : (
        /* DataGrid — Fluent2 page padding so the list breathes */
        <div
          style={{
            flex: 1,
            overflow: 'auto',
            paddingTop: tokens.spacingVerticalL,
            paddingBottom: tokens.spacingVerticalXXL,
            paddingLeft: tokens.spacingHorizontalXXL,
            paddingRight: tokens.spacingHorizontalXXL,
          }}
        >
          <DataGrid
            items={ceremonies}
            columns={columns}
            getRowId={(item) => item.id}
            style={{ width: '100%' }}
          >
            <DataGridHeader>
              <DataGridRow>
                {({ renderHeaderCell }) => (
                  <DataGridHeaderCell>{renderHeaderCell()}</DataGridHeaderCell>
                )}
              </DataGridRow>
            </DataGridHeader>
            <DataGridBody<Ceremony>>
              {({ item, rowId }) => (
                <DataGridRow<Ceremony>
                  key={rowId}
                  onClick={() => navigate(`/projects/${projectId}/ceremonies/${item.id}`)}
                  style={{ cursor: 'pointer' }}
                >
                  {({ renderCell }) => (
                    <DataGridCell>{renderCell(item)}</DataGridCell>
                  )}
                </DataGridRow>
              )}
            </DataGridBody>
          </DataGrid>
        </div>
      )}
    </div>
  )
}
