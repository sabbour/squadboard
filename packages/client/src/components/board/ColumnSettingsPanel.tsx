import { useState, useEffect } from 'react'
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd'
import {
  Button,
  Input,
  Textarea,
  Subtitle1,
  Body1,
  Caption1,
  Badge,
  Tooltip,
  tokens,
} from '@fluentui/react-components'
import {
  Checkmark16Regular,
  ReOrder20Regular,
  Add20Regular,
  Delete16Regular,
  Star16Regular,
  Star16Filled,
} from '@fluentui/react-icons'
import {
  useColumnMeta,
  useUpdateColumn,
  useResetColumns,
  useCreateColumn,
  useDeleteColumn,
  useReorderColumns,
  type ColumnMeta,
} from '../../api/columns.ts'
import { useIssues } from '../../api/issues.ts'

// 8-swatch palette: 5 defaults + yellow, red, teal
const PALETTE = [
  { hex: '#6e7681', name: 'Gray' },
  { hex: '#1f6feb', name: 'Blue' },
  { hex: '#fb950b', name: 'Orange' },
  { hex: '#8957e5', name: 'Purple' },
  { hex: '#238636', name: 'Green' },
  { hex: '#d29922', name: 'Yellow' },
  { hex: '#da3633', name: 'Red' },
  { hex: '#1b7c83', name: 'Teal' },
]

// Slugs of the 5 seed columns — used to count "custom" columns for reset confirm
const SEED_SLUGS = new Set(['backlog', 'todo', 'in_progress', 'in_review', 'done'])

const SEMANTIC_OPTIONS: { value: ColumnMeta['semantic']; label: string }[] = [
  { value: 'backlog', label: 'Backlog' },
  { value: 'ready', label: 'Ready' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'review', label: 'Review' },
  { value: 'done', label: 'Done' },
  { value: 'custom', label: 'Custom' },
]

const SEMANTIC_LABELS: Record<ColumnMeta['semantic'], string> = {
  backlog: 'Backlog',
  ready: 'Ready',
  in_progress: 'In Progress',
  review: 'Review',
  done: 'Done',
  custom: 'Custom',
}

const SLUG_RE = /^[a-z0-9_-]{1,40}$/

function toSlug(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s_-]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 40)
}

function firstUnusedColor(columns: ColumnMeta[]): string {
  const used = new Set(columns.map((c) => c.color))
  const found = PALETTE.find((p) => !used.has(p.hex))
  return found ? found.hex : PALETTE[0].hex
}

interface LocalState {
  label: string
  description: string
  color: string
  semantic: ColumnMeta['semantic']
}

interface AddFormState {
  label: string
  columnId: string
  slugManuallyEdited: boolean
  description: string
  semantic: ColumnMeta['semantic']
  color: string
  slugError: string | null
}

interface DeleteConfirmState {
  columnId: string
  reassignTo: string
}

interface ColumnSettingsPanelProps {
  projectId: string
  onClose: () => void
}

export default function ColumnSettingsPanel({ projectId, onClose }: ColumnSettingsPanelProps) {
  const { data: columns = [], isLoading } = useColumnMeta(projectId)
  const { data: allIssues = [] } = useIssues(projectId)
  const updateColumn = useUpdateColumn(projectId)
  const resetColumns = useResetColumns(projectId)
  const createColumn = useCreateColumn(projectId)
  const deleteColumn = useDeleteColumn(projectId)
  const reorderColumns = useReorderColumns(projectId)

  // Local edits keyed by columnId
  const [localState, setLocalState] = useState<Record<string, LocalState>>({})
  // Ordered column IDs for DnD (optimistic)
  const [orderedIds, setOrderedIds] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const [addFormOpen, setAddFormOpen] = useState(false)
  const [addForm, setAddForm] = useState<AddFormState>({
    label: '',
    columnId: '',
    slugManuallyEdited: false,
    description: '',
    semantic: 'custom',
    color: '',
    slugError: null,
  })
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirmState | null>(null)

  // Initialise localState and orderedIds once columns load / change
  useEffect(() => {
    if (columns.length === 0) return
    const sorted = [...columns].sort((a, b) => a.position - b.position)
    setOrderedIds(sorted.map((c) => c.columnId))
    setLocalState((prev) => {
      const next: Record<string, LocalState> = {}
      for (const col of columns) {
        next[col.columnId] = prev[col.columnId] ?? {
          label: col.label,
          description: col.description ?? '',
          color: col.color,
          semantic: col.semantic,
        }
      }
      return next
    })
  }, [columns])

  function update(columnId: string, patch: Partial<LocalState>) {
    setLocalState((prev) => ({
      ...prev,
      [columnId]: { ...prev[columnId], ...patch },
    }))
  }

  // --- Drag-and-drop reorder ---
  function handleDrop(result: DropResult) {
    if (!result.destination) return
    const src = result.source.index
    const dst = result.destination.index
    if (src === dst) return

    const prev = [...orderedIds]
    const next = [...orderedIds]
    const [moved] = next.splice(src, 1)
    next.splice(dst, 0, moved)
    setOrderedIds(next)

    reorderColumns.mutate(
      { order: next },
      { onError: () => setOrderedIds(prev) },
    )
  }

  // --- Save label / description / color / semantic ---
  async function handleSave() {
    setError(null)
    try {
      for (const col of columns) {
        const local = localState[col.columnId]
        if (!local) continue
        const changed =
          local.label !== col.label ||
          local.description !== (col.description ?? '') ||
          local.color !== col.color ||
          local.semantic !== col.semantic
        if (!changed) continue
        await updateColumn.mutateAsync({
          columnId: col.columnId,
          label: local.label,
          description: local.description || null,
          color: local.color,
          semantic: local.semantic,
        })
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    }
  }

  // --- Make default (immediate) ---
  async function handleMakeDefault(columnId: string) {
    setError(null)
    try {
      await updateColumn.mutateAsync({ columnId, isDefault: true })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to set default')
    }
  }

  // --- Delete column ---
  async function handleDelete(columnId: string) {
    if (!deleteConfirm) return
    setError(null)
    try {
      await deleteColumn.mutateAsync({
        columnId,
        reassignTo: deleteConfirm.reassignTo,
      })
      setDeleteConfirm(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  // --- Add column ---
  function handleAddLabelChange(label: string) {
    setAddForm((prev) => ({
      ...prev,
      label,
      columnId: prev.slugManuallyEdited ? prev.columnId : toSlug(label),
      slugError: null,
    }))
  }

  function handleAddSlugChange(slug: string) {
    setAddForm((prev) => ({
      ...prev,
      columnId: slug,
      slugManuallyEdited: true,
      slugError: null,
    }))
  }

  function openAddForm() {
    setAddForm({
      label: '',
      columnId: '',
      slugManuallyEdited: false,
      description: '',
      semantic: 'custom',
      color: firstUnusedColor(columns),
      slugError: null,
    })
    setAddFormOpen(true)
  }

  async function handleAddColumn() {
    setError(null)
    const trimLabel = addForm.label.trim()
    if (!trimLabel || trimLabel.length > 80) {
      setAddForm((prev) => ({ ...prev, slugError: 'Label is required (1–80 chars)' }))
      return
    }
    if (!SLUG_RE.test(addForm.columnId)) {
      setAddForm((prev) => ({
        ...prev,
        slugError: 'Must be 1–40 chars: lowercase letters, digits, _ or -',
      }))
      return
    }
    if (columns.some((c) => c.columnId === addForm.columnId)) {
      setAddForm((prev) => ({ ...prev, slugError: 'A column with this ID already exists' }))
      return
    }
    try {
      await createColumn.mutateAsync({
        columnId: addForm.columnId,
        label: trimLabel,
        description: addForm.description.trim() || null,
        color: addForm.color,
        semantic: addForm.semantic,
      })
      setAddFormOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Create failed')
    }
  }

  // --- Reset to defaults ---
  async function handleReset() {
    setError(null)
    setConfirmReset(false)
    try {
      const fresh = await resetColumns.mutateAsync()
      setLocalState(() => {
        const init: Record<string, LocalState> = {}
        for (const col of fresh) {
          init[col.columnId] = {
            label: col.label,
            description: col.description ?? '',
            color: col.color,
            semantic: col.semantic,
          }
        }
        return init
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Reset failed')
    }
  }

  const isSaving = updateColumn.isPending
  const isResetting = resetColumns.isPending

  // Build ordered column list for render
  const orderedColumns: ColumnMeta[] = orderedIds
    .map((id) => columns.find((c) => c.columnId === id))
    .filter((c): c is ColumnMeta => c !== undefined)

  // Issue counts per column (reuses cached query from Board)
  const issueCounts: Record<string, number> = {}
  for (const issue of allIssues) {
    issueCounts[issue.column] = (issueCounts[issue.column] ?? 0) + 1
  }

  // Default column (for delete reassign sentinel)
  const defaultColumn = columns.find((c) => c.isDefault)

  // Count custom columns for reset confirm
  const customColumnCount = columns.filter((c) => !SEED_SLUGS.has(c.columnId)).length

  return (
    // Overlay backdrop
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        display: 'flex',
        justifyContent: 'flex-end',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      {/* Drawer panel — widened to 480px */}
      <div
        style={{
          width: '480px',
          maxWidth: '100vw',
          height: '100%',
          background: 'var(--bg)',
          borderLeft: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drawer header */}
        <div
          style={{
            padding: '20px 24px 16px',
            borderBottom: '1px solid var(--border)',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Subtitle1 as="h2">Columns</Subtitle1>
            <button
              onClick={onClose}
              aria-label="Close"
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: '18px',
                color: tokens.colorNeutralForeground2,
                lineHeight: 1,
                padding: '4px',
                borderRadius: '4px',
              }}
            >
              ×
            </button>
          </div>
          <Body1 style={{ color: tokens.colorNeutralForeground2, marginTop: '4px', display: 'block' }}>
            Rename, describe, reorder, and color the columns of this board.
          </Body1>
        </div>

        {/* Drawer body — scrollable */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '16px 24px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
          }}
        >
          {isLoading && (
            <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>Loading…</Caption1>
          )}

          <DragDropContext onDragEnd={handleDrop}>
            <Droppable droppableId="column-list">
              {(provided) => (
                <div
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}
                >
                  {orderedColumns.map((col, index) => {
                    const local = localState[col.columnId]
                    if (!local) return null

                    const isLast = orderedColumns.length === 1
                    const colIssueCount = issueCounts[col.columnId] ?? 0
                    const isInDeleteConfirm = deleteConfirm?.columnId === col.columnId
                    const cannotDelete = isLast || col.isDefault

                    const deleteTitle = isLast
                      ? 'You need at least one column'
                      : col.isDefault
                        ? 'Set another column as default before deleting this one'
                        : 'Delete column'

                    return (
                      <Draggable key={col.columnId} draggableId={col.columnId} index={index}>
                        {(drag, snapshot) => (
                          <div
                            ref={drag.innerRef}
                            {...drag.draggableProps}
                            style={{
                              border: `1px solid ${tokens.colorNeutralStroke1}`,
                              borderRadius: '8px',
                              borderLeft: `4px solid ${local.color}`,
                              padding: '14px 16px',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '10px',
                              background: snapshot.isDragging
                                ? tokens.colorNeutralBackground3
                                : tokens.colorNeutralBackground2,
                              ...drag.draggableProps.style,
                            }}
                          >
                            {/* Card header row */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              {/* Drag handle */}
                              <span
                                {...drag.dragHandleProps}
                                style={{
                                  cursor: 'grab',
                                  color: tokens.colorNeutralForeground3,
                                  display: 'flex',
                                  flexShrink: 0,
                                }}
                              >
                                <ReOrder20Regular />
                              </span>

                              {/* Color dot */}
                              <div
                                style={{
                                  width: '10px',
                                  height: '10px',
                                  borderRadius: '50%',
                                  background: local.color,
                                  flexShrink: 0,
                                }}
                              />

                              {/* Label preview */}
                              <Caption1
                                style={{
                                  fontWeight: 600,
                                  flex: 1,
                                  color: tokens.colorNeutralForeground1,
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {local.label || (
                                  <span style={{ color: tokens.colorNeutralForeground3 }}>Untitled</span>
                                )}
                              </Caption1>

                              {/* Semantic badge */}
                              <Badge appearance="outline" size="small">
                                {SEMANTIC_LABELS[col.semantic]}
                              </Badge>

                              {/* Make-default star */}
                              <Tooltip
                                content="Default column for new issues"
                                relationship="label"
                              >
                                <button
                                  onClick={() => {
                                    if (!col.isDefault) void handleMakeDefault(col.columnId)
                                  }}
                                  aria-label={
                                    col.isDefault ? 'Default column' : 'Set as default column'
                                  }
                                  style={{
                                    background: 'none',
                                    border: 'none',
                                    cursor: col.isDefault ? 'default' : 'pointer',
                                    padding: '2px',
                                    display: 'flex',
                                    color: col.isDefault
                                      ? '#d29922'
                                      : tokens.colorNeutralForeground3,
                                    flexShrink: 0,
                                  }}
                                >
                                  {col.isDefault ? (
                                    <Star16Filled />
                                  ) : (
                                    <Star16Regular />
                                  )}
                                </button>
                              </Tooltip>

                              {/* Delete button */}
                              <Tooltip content={deleteTitle} relationship="label">
                                <span style={{ display: 'flex' }}>
                                  <button
                                    onClick={() => {
                                      if (cannotDelete) return
                                      setDeleteConfirm({
                                        columnId: col.columnId,
                                        reassignTo: defaultColumn?.columnId ?? orderedColumns.find((c) => c.columnId !== col.columnId)?.columnId ?? '',
                                      })
                                    }}
                                    disabled={cannotDelete}
                                    aria-label={deleteTitle}
                                    style={{
                                      background: 'none',
                                      border: 'none',
                                      cursor: cannotDelete ? 'not-allowed' : 'pointer',
                                      padding: '2px',
                                      display: 'flex',
                                      color: cannotDelete
                                        ? tokens.colorNeutralForeground4
                                        : tokens.colorPaletteRedForeground1,
                                      flexShrink: 0,
                                    }}
                                  >
                                    <Delete16Regular />
                                  </button>
                                </span>
                              </Tooltip>
                            </div>

                            {/* Card body: delete confirm OR edit fields */}
                            {isInDeleteConfirm ? (
                              <div
                                style={{
                                  display: 'flex',
                                  flexDirection: 'column',
                                  gap: '10px',
                                  background: tokens.colorNeutralBackground1,
                                  border: `1px solid ${tokens.colorPaletteRedBorder2}`,
                                  borderRadius: '6px',
                                  padding: '12px',
                                }}
                              >
                                {colIssueCount > 0 ? (
                                  <>
                                    <Caption1 style={{ color: tokens.colorNeutralForeground1 }}>
                                      This column has {colIssueCount} issue{colIssueCount !== 1 ? 's' : ''}. Move them to:
                                    </Caption1>
                                    <select
                                      value={deleteConfirm.reassignTo}
                                      onChange={(e) =>
                                        setDeleteConfirm((prev) =>
                                          prev ? { ...prev, reassignTo: e.target.value } : prev,
                                        )
                                      }
                                      style={selectStyle}
                                    >
                                      {columns
                                        .filter((c) => c.columnId !== col.columnId)
                                        .map((c) => (
                                          <option key={c.columnId} value={c.columnId}>
                                            {c.label}
                                          </option>
                                        ))}
                                    </select>
                                  </>
                                ) : (
                                  <Caption1 style={{ color: tokens.colorNeutralForeground1 }}>
                                    Delete this column?
                                  </Caption1>
                                )}
                                <div style={{ display: 'flex', gap: '8px' }}>
                                  <Button
                                    appearance="primary"
                                    size="small"
                                    disabled={deleteColumn.isPending}
                                    onClick={() => void handleDelete(col.columnId)}
                                  >
                                    {deleteColumn.isPending
                                      ? 'Deleting…'
                                      : colIssueCount > 0
                                        ? 'Delete and move issues'
                                        : 'Delete'}
                                  </Button>
                                  <Button
                                    size="small"
                                    onClick={() => setDeleteConfirm(null)}
                                  >
                                    Cancel
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              <>
                                {/* Label input */}
                                <div>
                                  <Caption1
                                    style={{
                                      color: tokens.colorNeutralForeground3,
                                      display: 'block',
                                      marginBottom: '4px',
                                    }}
                                  >
                                    Label
                                  </Caption1>
                                  <Input
                                    size="small"
                                    value={local.label}
                                    maxLength={80}
                                    onChange={(_, d) => update(col.columnId, { label: d.value })}
                                    style={{ width: '100%' }}
                                  />
                                </div>

                                {/* Description textarea */}
                                <div>
                                  <Caption1
                                    style={{
                                      color: tokens.colorNeutralForeground3,
                                      display: 'block',
                                      marginBottom: '4px',
                                    }}
                                  >
                                    Description
                                  </Caption1>
                                  <Textarea
                                    size="small"
                                    value={local.description}
                                    maxLength={1000}
                                    resize="vertical"
                                    onChange={(_, d) =>
                                      update(col.columnId, { description: d.value })
                                    }
                                    style={{ width: '100%' }}
                                    rows={2}
                                  />
                                </div>

                                {/* Color swatches */}
                                <div>
                                  <Caption1
                                    style={{
                                      color: tokens.colorNeutralForeground3,
                                      display: 'block',
                                      marginBottom: '6px',
                                    }}
                                  >
                                    Color
                                  </Caption1>
                                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                    {PALETTE.map((swatch) => (
                                      <button
                                        key={swatch.hex}
                                        title={swatch.name}
                                        onClick={() =>
                                          update(col.columnId, { color: swatch.hex })
                                        }
                                        aria-pressed={local.color === swatch.hex}
                                        style={{
                                          width: '26px',
                                          height: '26px',
                                          borderRadius: '50%',
                                          background: swatch.hex,
                                          border:
                                            local.color === swatch.hex
                                              ? `2px solid ${tokens.colorNeutralForeground1}`
                                              : `2px solid transparent`,
                                          cursor: 'pointer',
                                          display: 'flex',
                                          alignItems: 'center',
                                          justifyContent: 'center',
                                          flexShrink: 0,
                                          padding: 0,
                                        }}
                                      >
                                        {local.color === swatch.hex && (
                                          <Checkmark16Regular
                                            style={{
                                              color: '#fff',
                                              width: '12px',
                                              height: '12px',
                                            }}
                                          />
                                        )}
                                      </button>
                                    ))}
                                  </div>
                                </div>

                                {/* Semantic select */}
                                <div>
                                  <Caption1
                                    style={{
                                      color: tokens.colorNeutralForeground3,
                                      display: 'block',
                                      marginBottom: '4px',
                                    }}
                                  >
                                    Semantic
                                  </Caption1>
                                  <select
                                    value={local.semantic}
                                    onChange={(e) =>
                                      update(col.columnId, {
                                        semantic: e.target.value as ColumnMeta['semantic'],
                                      })
                                    }
                                    style={selectStyle}
                                  >
                                    {SEMANTIC_OPTIONS.map((o) => (
                                      <option key={o.value} value={o.value}>
                                        {o.label}
                                      </option>
                                    ))}
                                  </select>
                                  <Caption1
                                    style={{
                                      color: tokens.colorNeutralForeground3,
                                      marginTop: '4px',
                                      display: 'block',
                                    }}
                                  >
                                    Tells analytics and integrations what this column means.
                                  </Caption1>
                                </div>
                              </>
                            )}
                          </div>
                        )}
                      </Draggable>
                    )
                  })}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          </DragDropContext>

          {/* Add column */}
          {addFormOpen ? (
            <div
              style={{
                border: `1px dashed ${tokens.colorNeutralStroke1}`,
                borderRadius: '8px',
                padding: '14px 16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
                background: tokens.colorNeutralBackground2,
              }}
            >
              {/* Label */}
              <div>
                <Caption1
                  style={{
                    color: tokens.colorNeutralForeground3,
                    display: 'block',
                    marginBottom: '4px',
                  }}
                >
                  Label <span style={{ color: tokens.colorPaletteRedForeground1 }}>*</span>
                </Caption1>
                <Input
                  size="small"
                  value={addForm.label}
                  maxLength={80}
                  onChange={(_, d) => handleAddLabelChange(d.value)}
                  placeholder="e.g. In Testing"
                  style={{ width: '100%' }}
                />
              </div>

              {/* Slug */}
              <div>
                <Caption1
                  style={{
                    color: tokens.colorNeutralForeground3,
                    display: 'block',
                    marginBottom: '4px',
                  }}
                >
                  ID / Slug <span style={{ color: tokens.colorPaletteRedForeground1 }}>*</span>
                </Caption1>
                <Input
                  size="small"
                  value={addForm.columnId}
                  maxLength={40}
                  onChange={(_, d) => handleAddSlugChange(d.value)}
                  placeholder="e.g. in_testing"
                  style={{ width: '100%' }}
                />
                {addForm.slugError ? (
                  <Caption1
                    style={{
                      color: tokens.colorPaletteRedForeground1,
                      marginTop: '4px',
                      display: 'block',
                    }}
                  >
                    {addForm.slugError}
                  </Caption1>
                ) : (
                  <Caption1
                    style={{
                      color: tokens.colorNeutralForeground3,
                      marginTop: '4px',
                      display: 'block',
                    }}
                  >
                    Used internally — don't change after issues are created.
                  </Caption1>
                )}
              </div>

              {/* Description */}
              <div>
                <Caption1
                  style={{
                    color: tokens.colorNeutralForeground3,
                    display: 'block',
                    marginBottom: '4px',
                  }}
                >
                  Description
                </Caption1>
                <Textarea
                  size="small"
                  value={addForm.description}
                  maxLength={1000}
                  resize="vertical"
                  onChange={(_, d) =>
                    setAddForm((prev) => ({ ...prev, description: d.value }))
                  }
                  style={{ width: '100%' }}
                  rows={2}
                />
              </div>

              {/* Semantic */}
              <div>
                <Caption1
                  style={{
                    color: tokens.colorNeutralForeground3,
                    display: 'block',
                    marginBottom: '4px',
                  }}
                >
                  Semantic <span style={{ color: tokens.colorPaletteRedForeground1 }}>*</span>
                </Caption1>
                <select
                  value={addForm.semantic}
                  onChange={(e) =>
                    setAddForm((prev) => ({
                      ...prev,
                      semantic: e.target.value as ColumnMeta['semantic'],
                    }))
                  }
                  style={selectStyle}
                >
                  {SEMANTIC_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <Caption1
                  style={{
                    color: tokens.colorNeutralForeground3,
                    marginTop: '4px',
                    display: 'block',
                  }}
                >
                  Tells analytics and integrations what this column means. Pick the closest match.
                </Caption1>
              </div>

              {/* Color */}
              <div>
                <Caption1
                  style={{
                    color: tokens.colorNeutralForeground3,
                    display: 'block',
                    marginBottom: '6px',
                  }}
                >
                  Color
                </Caption1>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {PALETTE.map((swatch) => (
                    <button
                      key={swatch.hex}
                      title={swatch.name}
                      onClick={() =>
                        setAddForm((prev) => ({ ...prev, color: swatch.hex }))
                      }
                      aria-pressed={addForm.color === swatch.hex}
                      style={{
                        width: '26px',
                        height: '26px',
                        borderRadius: '50%',
                        background: swatch.hex,
                        border:
                          addForm.color === swatch.hex
                            ? `2px solid ${tokens.colorNeutralForeground1}`
                            : `2px solid transparent`,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                        padding: 0,
                      }}
                    >
                      {addForm.color === swatch.hex && (
                        <Checkmark16Regular
                          style={{ color: '#fff', width: '12px', height: '12px' }}
                        />
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* Add / Cancel */}
              <div style={{ display: 'flex', gap: '8px' }}>
                <Button
                  appearance="primary"
                  size="small"
                  disabled={createColumn.isPending}
                  onClick={() => void handleAddColumn()}
                >
                  {createColumn.isPending ? 'Adding…' : 'Add'}
                </Button>
                <Button
                  size="small"
                  onClick={() => setAddFormOpen(false)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button
              appearance="subtle"
              icon={<Add20Regular />}
              onClick={openAddForm}
              style={{ alignSelf: 'flex-start' }}
            >
              Add column
            </Button>
          )}
        </div>

        {/* Drawer footer */}
        <div
          style={{
            padding: '16px 24px',
            borderTop: '1px solid var(--border)',
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          {error && (
            <Caption1 style={{ color: tokens.colorPaletteRedForeground1, display: 'block' }}>
              {error}
            </Caption1>
          )}

          {confirmReset ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <Caption1 style={{ color: tokens.colorNeutralForeground2 }}>
                This will delete all custom columns and reset the 5 default columns.
                {customColumnCount > 0
                  ? ` ${customColumnCount} custom column${customColumnCount !== 1 ? 's' : ''} will be removed.`
                  : ''}
              </Caption1>
              <div style={{ display: 'flex', gap: '8px' }}>
                <Button
                  appearance="primary"
                  size="small"
                  disabled={isResetting}
                  onClick={() => void handleReset()}
                >
                  {isResetting ? 'Resetting…' : 'Yes, reset'}
                </Button>
                <Button size="small" onClick={() => setConfirmReset(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: '8px' }}>
              <Button
                appearance="primary"
                disabled={isSaving}
                onClick={() => void handleSave()}
              >
                {isSaving ? 'Saving…' : 'Save'}
              </Button>
              <Button
                appearance="secondary"
                disabled={isResetting}
                onClick={() => setConfirmReset(true)}
              >
                Reset to defaults
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Style helpers
// ---------------------------------------------------------------------------

const selectStyle: React.CSSProperties = {
  width: '100%',
  background: tokens.colorNeutralBackground1,
  border: `1px solid ${tokens.colorNeutralStroke1}`,
  borderRadius: '6px',
  color: tokens.colorNeutralForeground1,
  padding: '6px 8px',
  fontSize: '13px',
  outline: 'none',
  cursor: 'pointer',
}
