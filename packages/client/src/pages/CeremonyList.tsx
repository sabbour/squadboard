/**
 * CeremonyList.tsx — Fluent2 DataGrid list of ceremonies for a project.
 *
 * Columns: Name (clickable), Trigger (Badge), Kind (Badge), Created (relative + Tooltip).
 * Toolbar: Review-drafts subtle button with CounterBadge + primary New-ceremony button.
 * Empty state: centred card with CTA when no ceremonies exist.
 */

import { useParams, useNavigate } from 'react-router'
import { useProject } from '../api/projects.ts'
import {
  useCeremonies,
  useDraftCeremonies,
  type Ceremony,
} from '../api/ceremonies.ts'
import PageHeader from '../components/layout/PageHeader.tsx'
import { TriggerBadge, KindBadge } from '../components/ceremony/CeremonyBadges.tsx'
import { safeRelativeTime, safeAbsoluteTime } from '../utils/dates.ts'
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
} from '@fluentui/react-components'
import { Add16Regular } from '@fluentui/react-icons'

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
