/**
 * CaptureModal — Phase 14 quick-capture modal.
 *
 * Used by both the global "+ Capture" button (Layout) and the per-project
 * floating action button (Board). Two view modes:
 *
 *   draft    — empty textarea + "Formulate" button (or Ctrl+Enter).
 *              Cancel closes without saving.
 *   preview  — editable Title / Body / Labels / Project / Column with
 *              rationale + confidence pill above. Footer offers
 *              Discard / Save for later / Publish.
 *
 * If `existingItemId` is provided the modal hydrates from /api/inbox/:id
 * and skips straight to preview mode. Otherwise it starts in draft mode.
 *
 * `lockedProjectId` and `lockedColumn` (used by the per-project FAB) lock
 * those two dropdowns and are passed through on create/publish.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { tokens, Spinner } from '@fluentui/react-components'
import { Beaker20Regular } from '@fluentui/react-icons'
import { useProjects } from '../../api/projects.ts'
import { useLabels } from '../../api/labels.ts'
import {
  useCreateInboxItem,
  useUpdateInboxItem,
  usePublishInboxItem,
  useDiscardInboxItem,
  useInboxItem,
  type InboxItem,
  type FormulateResult,
  type FormulateModelInfo,
} from '../../api/inbox.ts'
import type { ColumnId } from '../../api/issues.ts'

const COLUMNS: { id: ColumnId; label: string }[] = [
  { id: 'backlog', label: 'Backlog' },
  { id: 'todo', label: 'Todo' },
  { id: 'in_progress', label: 'In Progress' },
  { id: 'in_review', label: 'In Review' },
  { id: 'done', label: 'Done' },
]

interface CaptureModalProps {
  open: boolean
  onClose: () => void
  /** When set: lock the project dropdown and pass through on create. */
  lockedProjectId?: string
  /** When set: lock the column dropdown to this slug (defaults to 'backlog'). */
  lockedColumn?: ColumnId
  /** When set: hydrate an existing inbox item and start in preview mode. */
  existingItemId?: string | null
}

export default function CaptureModal({
  open,
  onClose,
  lockedProjectId,
  lockedColumn,
  existingItemId,
}: CaptureModalProps) {
  const [draft, setDraft] = useState('')
  const [itemId, setItemId] = useState<string | null>(null)

  // Editable preview fields (mirror the InboxItem shape).
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [labels, setLabels] = useState<string[]>([])
  const [labelInput, setLabelInput] = useState('')
  const [projectId, setProjectId] = useState<string>('')
  const [column, setColumn] = useState<ColumnId>(lockedColumn ?? 'backlog')
  const [confidence, setConfidence] = useState<string | null>(null)
  const [rationale, setRationale] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [modelUsed, setModelUsed] = useState<FormulateModelInfo | null>(null)
  const [isFormulating, setIsFormulating] = useState(false)
  const draftRef = useRef<HTMLTextAreaElement | null>(null)

  // Hydrate from existing inbox item when caller passes an id.
  const { data: existing } = useInboxItem(existingItemId)
  const create = useCreateInboxItem()
  const update = useUpdateInboxItem(itemId)
  const publish = usePublishInboxItem(itemId)
  const discard = useDiscardInboxItem(itemId)
  const { data: projects = [] } = useProjects()
  const { data: projectLabels = [] } = useLabels(projectId)

  // Reset whenever the modal opens.
  useEffect(() => {
    if (!open) return
    setError(null)
    if (existingItemId) {
      setItemId(existingItemId)
    } else {
      setItemId(null)
      setDraft('')
      setTitle('')
      setBody('')
      setLabels([])
      setLabelInput('')
      setProjectId(lockedProjectId ?? '')
      setColumn(lockedColumn ?? 'backlog')
      setConfidence(null)
      setRationale(null)
      // Focus the draft textarea on next paint.
      setTimeout(() => draftRef.current?.focus(), 50)
    }
  }, [open, existingItemId, lockedProjectId, lockedColumn])

  // Hydrate preview fields from server when item arrives.
  useEffect(() => {
    if (!open) return
    const item = existing
    if (!item) return
    hydrateFromItem(item)
  }, [existing, open])

  function hydrateFromItem(item: InboxItem) {
    setItemId(item.id)
    setDraft(item.originalDraft)
    setTitle(item.formulatedTitle ?? '')
    setBody(item.formulatedBody ?? '')
    setLabels(item.suggestedLabels ?? [])
    setProjectId(lockedProjectId ?? item.suggestedProjectId ?? '')
    setColumn(lockedColumn ?? item.suggestedColumn ?? 'backlog')
    setConfidence(item.confidence)
    setRationale(item.rationale)
  }

  const inPreview = useMemo(
    () => Boolean(itemId) && (Boolean(title) || Boolean(existing?.formulatedTitle)),
    [itemId, title, existing],
  )

  async function handleFormulate() {
    setError(null)
    const trimmed = draft.trim()
    if (!trimmed) {
      setError('Type something first.')
      return
    }
    setIsFormulating(true)
    try {
      let id = itemId
      if (!id) {
        const created = await create.mutateAsync({
          originalDraft: trimmed,
          suggestedProjectId: lockedProjectId ?? null,
        })
        id = created.id
        setItemId(id)
      }
      // The mutation hook is bound to itemId; we pass through manually.
      const payload = await window
        .fetch(`/api/inbox/${id}/formulate`, { method: 'POST' })
        .then(async (r) => {
          if (!r.ok) {
            const txt = await r.text()
            throw new Error(`HTTP ${r.status}: ${txt}`)
          }
          return r.json() as Promise<FormulateResult>
        })
      setModelUsed(payload.modelUsed)
      hydrateFromItem(payload.item)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to formulate')
    } finally {
      setIsFormulating(false)
    }
  }

  async function handleSaveForLater() {
    setError(null)
    if (!itemId) {
      onClose()
      return
    }
    try {
      await update.mutateAsync({
        formulatedTitle: title,
        formulatedBody: body,
        suggestedLabels: labels,
        suggestedProjectId: projectId || null,
        suggestedColumn: column,
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    }
  }

  async function handlePublish() {
    setError(null)
    if (!itemId) {
      setError('Formulate first.')
      return
    }
    if (!projectId) {
      setError('Pick a project to publish to.')
      return
    }
    try {
      // Persist any user edits first so publish picks up the latest title/body.
      await update.mutateAsync({
        formulatedTitle: title,
        formulatedBody: body,
        suggestedLabels: labels,
        suggestedProjectId: projectId,
        suggestedColumn: column,
      })
      await publish.mutateAsync({ projectId, columnSlug: column })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to publish')
    }
  }

  async function handleDiscard() {
    setError(null)
    if (!itemId) {
      onClose()
      return
    }
    try {
      await discard.mutateAsync()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to discard')
    }
  }

  function addLabel(name: string) {
    const trimmed = name.trim()
    if (!trimmed) return
    setLabels((prev) => (prev.includes(trimmed) ? prev : [...prev, trimmed]))
    setLabelInput('')
  }

  function removeLabel(name: string) {
    setLabels((prev) => prev.filter((l) => l !== name))
  }

  function handleDraftKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      void handleFormulate()
    }
  }

  function handleEsc(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  if (!open) return null

  const labelSuggestions = (projectLabels ?? []).filter(
    (l) => !labels.includes(l.name) && (!labelInput || l.name.toLowerCase().includes(labelInput.toLowerCase())),
  )

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      onKeyDown={handleEsc}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 400,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
      }}
    >
      <div
        style={{
          background: tokens.colorNeutralBackground1,
          border: `1px solid ${tokens.colorNeutralStroke1}`,
          borderRadius: '8px',
          width: '100%',
          maxWidth: '640px',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '90vh',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 20px',
            borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
          }}
        >
          <h2 style={{ fontSize: '15px', fontWeight: 600, color: tokens.colorNeutralForeground1 }}>
            {inPreview ? 'Review formulated draft' : 'Quick capture'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: tokens.colorNeutralForeground2,
              fontSize: '18px',
              cursor: 'pointer',
            }}
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div
          style={{
            padding: '20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
            overflowY: 'auto',
          }}
        >
          {!inPreview && (
            <>
              <p style={{ fontSize: '12px', color: tokens.colorNeutralForeground2, margin: 0 }}>
                Brain-dump your idea. We'll tighten it into a clean issue you can review and publish.
              </p>
              <textarea
                ref={draftRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={handleDraftKey}
                placeholder="What's on your mind? (Ctrl+Enter to formulate)"
                rows={6}
                style={{
                  width: '100%',
                  background: tokens.colorNeutralBackground1,
                  border: `1px solid ${tokens.colorNeutralStroke1}`,
                  borderRadius: '6px',
                  color: tokens.colorNeutralForeground1,
                  padding: '10px 12px',
                  fontSize: '13px',
                  resize: 'vertical',
                  outline: 'none',
                  lineHeight: '1.5',
                }}
              />
            </>
          )}

          {inPreview && (
            <>
              {(rationale || confidence || modelUsed) && (
                <div
                  style={{
                    fontSize: '12px',
                    color: tokens.colorNeutralForeground3,
                    background: tokens.colorNeutralBackground2,
                    padding: '8px 10px',
                    borderRadius: '6px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    flexWrap: 'wrap',
                  }}
                >
                  {confidence && (
                    <span
                      style={{
                        background: confidenceBg(confidence),
                        color: '#fff',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        fontSize: '11px',
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px',
                      }}
                    >
                      {confidence}
                    </span>
                  )}
                  <span style={{ flex: 1 }}>{rationale || 'No rationale provided.'}</span>
                  {modelUsed && (
                    <span
                      title={`Resolved via: ${modelUsed.via}`}
                      style={{
                        background: tokens.colorNeutralBackground3,
                        color: tokens.colorNeutralForeground2,
                        padding: '2px 6px',
                        borderRadius: '4px',
                        fontSize: '11px',
                        fontFamily: 'monospace',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {modelUsed.model}
                    </span>
                  )}
                </div>
              )}

              {/* Title */}
              <div>
                <label style={fieldLabel}>Title</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  style={fieldInput}
                />
              </div>

              {/* Body */}
              <div>
                <label style={fieldLabel}>Body (Markdown)</label>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={6}
                  style={{ ...fieldInput, resize: 'vertical', lineHeight: '1.5' }}
                />
              </div>

              {/* Labels */}
              <div>
                <label style={fieldLabel}>Labels</label>
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '6px',
                    border: `1px solid ${tokens.colorNeutralStroke1}`,
                    borderRadius: '6px',
                    padding: '6px 8px',
                  }}
                >
                  {labels.map((l) => (
                    <span
                      key={l}
                      style={{
                        background: tokens.colorBrandBackground2,
                        color: tokens.colorBrandForeground2,
                        borderRadius: '12px',
                        padding: '2px 8px 2px 10px',
                        fontSize: '12px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                      }}
                    >
                      {l}
                      <button
                        type="button"
                        onClick={() => removeLabel(l)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'inherit',
                          cursor: 'pointer',
                          fontSize: '14px',
                          lineHeight: 1,
                        }}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  <input
                    type="text"
                    value={labelInput}
                    onChange={(e) => setLabelInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ',') {
                        e.preventDefault()
                        addLabel(labelInput)
                      }
                    }}
                    placeholder={labels.length === 0 ? 'Type a label and press Enter…' : 'Add another…'}
                    style={{
                      flex: 1,
                      minWidth: '120px',
                      border: 'none',
                      outline: 'none',
                      background: 'transparent',
                      color: tokens.colorNeutralForeground1,
                      fontSize: '12px',
                    }}
                  />
                </div>
                {labelSuggestions.length > 0 && labelInput && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '6px' }}>
                    {labelSuggestions.slice(0, 8).map((l) => (
                      <button
                        key={l.id}
                        type="button"
                        onClick={() => addLabel(l.name)}
                        style={{
                          background: 'none',
                          border: `1px dashed ${tokens.colorNeutralStroke2}`,
                          borderRadius: '10px',
                          padding: '1px 8px',
                          fontSize: '11px',
                          color: tokens.colorNeutralForeground2,
                          cursor: 'pointer',
                        }}
                      >
                        + {l.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Project + Column */}
              <div style={{ display: 'flex', gap: '12px' }}>
                <div style={{ flex: 1 }}>
                  <label style={fieldLabel}>Project</label>
                  <select
                    value={projectId}
                    disabled={Boolean(lockedProjectId)}
                    onChange={(e) => setProjectId(e.target.value)}
                    style={{ ...fieldInput, cursor: lockedProjectId ? 'not-allowed' : 'pointer' }}
                  >
                    <option value="">— pick a project —</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ width: '180px' }}>
                  <label style={fieldLabel}>Column</label>
                  <select
                    value={column}
                    disabled={Boolean(lockedColumn)}
                    onChange={(e) => setColumn(e.target.value as ColumnId)}
                    style={{ ...fieldInput, cursor: lockedColumn ? 'not-allowed' : 'pointer' }}
                  >
                    {COLUMNS.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </>
          )}

          {error && (
            <div
              style={{
                background: 'rgba(248, 81, 73, 0.1)',
                border: '1px solid rgba(248, 81, 73, 0.3)',
                color: '#f85149',
                padding: '8px 10px',
                borderRadius: '6px',
                fontSize: '12px',
              }}
            >
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '8px',
            padding: '12px 20px',
            borderTop: `1px solid ${tokens.colorNeutralStroke1}`,
          }}
        >
          {!inPreview ? (
            <>
              <button type="button" onClick={onClose} style={btnSecondary}>
                Cancel
              </button>
              <button
                type="button"
                onClick={handleFormulate}
                disabled={!draft.trim() || create.isPending || isFormulating}
                style={btnPrimary(!draft.trim() || create.isPending || isFormulating)}
              >
                {(create.isPending || isFormulating) ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                    <Spinner size="tiny" appearance="inverted" />
                    Formulating…
                  </span>
                ) : (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                    <Beaker20Regular />
                    Formulate
                  </span>
                )}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={handleDiscard}
                disabled={discard.isPending}
                style={btnDanger(discard.isPending)}
              >
                {discard.isPending ? 'Discarding…' : 'Discard'}
              </button>
              <div style={{ flex: 1 }} />
              <button
                type="button"
                onClick={handleSaveForLater}
                disabled={update.isPending}
                style={btnSecondary}
              >
                {update.isPending ? 'Saving…' : 'Save for later'}
              </button>
              <button
                type="button"
                onClick={handlePublish}
                disabled={!projectId || publish.isPending || update.isPending}
                style={btnPrimary(!projectId || publish.isPending || update.isPending)}
              >
                {publish.isPending ? 'Publishing…' : 'Publish'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Local style helpers
// ---------------------------------------------------------------------------

const fieldLabel: React.CSSProperties = {
  fontSize: '11px',
  color: tokens.colorNeutralForeground2,
  display: 'block',
  marginBottom: '4px',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
}

const fieldInput: React.CSSProperties = {
  width: '100%',
  background: tokens.colorNeutralBackground1,
  border: `1px solid ${tokens.colorNeutralStroke1}`,
  borderRadius: '6px',
  color: tokens.colorNeutralForeground1,
  padding: '8px 10px',
  fontSize: '13px',
  outline: 'none',
}

const btnSecondary: React.CSSProperties = {
  background: 'none',
  border: `1px solid ${tokens.colorNeutralStroke1}`,
  borderRadius: '6px',
  color: tokens.colorNeutralForeground1,
  padding: '6px 16px',
  fontSize: '13px',
  cursor: 'pointer',
}

function btnPrimary(disabled: boolean): React.CSSProperties {
  return {
    background: '#238636',
    border: '1px solid #2ea043',
    borderRadius: '6px',
    color: '#ffffff',
    padding: '6px 16px',
    fontSize: '13px',
    fontWeight: 500,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1,
  }
}

function btnDanger(disabled: boolean): React.CSSProperties {
  return {
    background: 'rgba(248, 81, 73, 0.1)',
    border: '1px solid #f85149',
    borderRadius: '6px',
    color: '#f85149',
    padding: '6px 16px',
    fontSize: '13px',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1,
  }
}

function confidenceBg(level: string): string {
  if (level === 'high') return '#238636'
  if (level === 'medium') return '#9a6700'
  return '#6e7681'
}
