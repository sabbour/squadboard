import { useState, useEffect } from 'react'
import {
  Button,
  Input,
  Textarea,
  Subtitle1,
  Body1,
  Caption1,
  tokens,
} from '@fluentui/react-components'
import { Checkmark16Regular } from '@fluentui/react-icons'
import { useColumnMeta, useUpdateColumn, useResetColumns, type ColumnMeta } from '../../api/columns.ts'

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

const COLUMN_ORDER = ['backlog', 'todo', 'in_progress', 'in_review', 'done']

interface LocalState {
  label: string
  description: string
  color: string
}

interface ColumnSettingsPanelProps {
  projectId: string
  onClose: () => void
}

export default function ColumnSettingsPanel({ projectId, onClose }: ColumnSettingsPanelProps) {
  const { data: columns = [], isLoading } = useColumnMeta(projectId)
  const updateColumn = useUpdateColumn(projectId)
  const resetColumns = useResetColumns(projectId)

  // Local edits keyed by columnId
  const [localState, setLocalState] = useState<Record<string, LocalState>>({})
  const [error, setError] = useState<string | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)

  // Initialise localState once columns load
  useEffect(() => {
    if (columns.length > 0 && Object.keys(localState).length === 0) {
      const init: Record<string, LocalState> = {}
      for (const col of columns) {
        init[col.columnId] = {
          label: col.label,
          description: col.description ?? '',
          color: col.color,
        }
      }
      setLocalState(init)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns])

  function update(columnId: string, patch: Partial<LocalState>) {
    setLocalState((prev) => ({
      ...prev,
      [columnId]: { ...prev[columnId], ...patch },
    }))
  }

  async function handleSave() {
    setError(null)
    try {
      for (const col of columns) {
        const local = localState[col.columnId]
        if (!local) continue
        const changed =
          local.label !== col.label ||
          local.description !== (col.description ?? '') ||
          local.color !== col.color
        if (!changed) continue
        await updateColumn.mutateAsync({
          columnId: col.columnId,
          label: local.label,
          description: local.description || null,
          color: local.color,
        })
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    }
  }

  async function handleReset() {
    setError(null)
    setConfirmReset(false)
    try {
      const fresh = await resetColumns.mutateAsync()
      const init: Record<string, LocalState> = {}
      for (const col of fresh) {
        init[col.columnId] = {
          label: col.label,
          description: col.description ?? '',
          color: col.color,
        }
      }
      setLocalState(init)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Reset failed')
    }
  }

  const isSaving = updateColumn.isPending
  const isResetting = resetColumns.isPending

  const orderedColumns: ColumnMeta[] = COLUMN_ORDER
    .map((id) => columns.find((c) => c.columnId === id))
    .filter((c): c is ColumnMeta => c !== undefined)

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
      {/* Drawer panel */}
      <div
        style={{
          width: '420px',
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
            Rename, describe, and color the columns of this board.
          </Body1>
        </div>

        {/* Drawer body — scrollable */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {isLoading && (
            <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>Loading…</Caption1>
          )}

          {orderedColumns.map((col) => {
            const local = localState[col.columnId]
            if (!local) return null

            return (
              <div
                key={col.columnId}
                style={{
                  border: `1px solid ${tokens.colorNeutralStroke1}`,
                  borderRadius: '8px',
                  borderLeft: `4px solid ${local.color}`,
                  padding: '14px 16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                  background: tokens.colorNeutralBackground2,
                }}
              >
                {/* Preview chip */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div
                    style={{
                      width: '10px',
                      height: '10px',
                      borderRadius: '50%',
                      background: local.color,
                      flexShrink: 0,
                    }}
                  />
                  <Caption1 style={{ fontWeight: 600, color: tokens.colorNeutralForeground1 }}>
                    {local.label || <span style={{ color: tokens.colorNeutralForeground3 }}>Untitled</span>}
                  </Caption1>
                </div>

                {/* Label input */}
                <div>
                  <Caption1 style={{ color: tokens.colorNeutralForeground3, display: 'block', marginBottom: '4px' }}>
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
                  <Caption1 style={{ color: tokens.colorNeutralForeground3, display: 'block', marginBottom: '4px' }}>
                    Description
                  </Caption1>
                  <Textarea
                    size="small"
                    value={local.description}
                    maxLength={1000}
                    resize="vertical"
                    onChange={(_, d) => update(col.columnId, { description: d.value })}
                    style={{ width: '100%' }}
                    rows={2}
                  />
                </div>

                {/* Color swatches */}
                <div>
                  <Caption1 style={{ color: tokens.colorNeutralForeground3, display: 'block', marginBottom: '6px' }}>
                    Color
                  </Caption1>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {PALETTE.map((swatch) => (
                      <button
                        key={swatch.hex}
                        title={swatch.name}
                        onClick={() => update(col.columnId, { color: swatch.hex })}
                        aria-pressed={local.color === swatch.hex}
                        style={{
                          width: '26px',
                          height: '26px',
                          borderRadius: '50%',
                          background: swatch.hex,
                          border: local.color === swatch.hex
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
                          <Checkmark16Regular style={{ color: '#fff', width: '12px', height: '12px' }} />
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )
          })}
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
                This will restore all 5 columns to their default labels, descriptions, and colors. Continue?
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
                <Button size="small" onClick={() => setConfirmReset(false)}>Cancel</Button>
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
