import { useState } from 'react'
import { useCreateIssue, type ColumnId } from '../../api/issues.ts'
import { useLabels } from '../../api/labels.ts'
import LabelBadge from '../LabelBadge.tsx'

interface CreateIssueModalProps {
  projectId: string
  defaultColumn: ColumnId
  onClose: () => void
}

const COLUMNS: { id: ColumnId; label: string }[] = [
  { id: 'backlog', label: 'Backlog' },
  { id: 'todo', label: 'Todo' },
  { id: 'in_progress', label: 'In Progress' },
  { id: 'in_review', label: 'In Review' },
  { id: 'done', label: 'Done' },
]

export default function CreateIssueModal({ projectId, defaultColumn, onClose }: CreateIssueModalProps) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [column, setColumn] = useState<ColumnId>(defaultColumn)
  const [selectedLabelIds, setSelectedLabelIds] = useState<string[]>([])

  const { data: labels } = useLabels(projectId)
  const createIssue = useCreateIssue(projectId)

  function toggleLabel(id: string) {
    setSelectedLabelIds((prev) =>
      prev.includes(id) ? prev.filter((l) => l !== id) : [...prev, id]
    )
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmedTitle = title.trim()
    if (!trimmedTitle) return
    createIssue.mutate(
      { title: trimmedTitle, body: body.trim() || undefined, column, labelIds: selectedLabelIds },
      { onSuccess: onClose }
    )
  }

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 300,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
      }}
    >
      <div
        style={{
          background: '#161b22',
          border: '1px solid #30363d',
          borderRadius: '8px',
          width: '100%',
          maxWidth: '520px',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '90vh',
          overflow: 'hidden',
        }}
      >
        {/* Modal header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 20px',
            borderBottom: '1px solid #30363d',
          }}
        >
          <h2 style={{ fontSize: '15px', fontWeight: 600, color: '#e6edf3' }}>New Issue</h2>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: '#8b949e', fontSize: '18px', cursor: 'pointer' }}
          >
            ✕
          </button>
        </div>

        {/* Modal form */}
        <form onSubmit={handleSubmit} style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px', overflowY: 'auto' }}>
          {/* Title */}
          <div>
            <label style={{ fontSize: '12px', color: '#8b949e', display: 'block', marginBottom: '6px' }}>
              Title <span style={{ color: '#f85149' }}>*</span>
            </label>
            <input
              autoFocus
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Issue title"
              required
              style={{
                width: '100%',
                background: '#0d1117',
                border: '1px solid #30363d',
                borderRadius: '6px',
                color: '#e6edf3',
                padding: '8px 10px',
                fontSize: '13px',
                outline: 'none',
              }}
              onFocus={(e) => { e.currentTarget.style.borderColor = '#388bfd' }}
              onBlur={(e) => { e.currentTarget.style.borderColor = '#30363d' }}
            />
          </div>

          {/* Body (markdown) */}
          <div>
            <label style={{ fontSize: '12px', color: '#8b949e', display: 'block', marginBottom: '6px' }}>
              Description <span style={{ fontSize: '11px' }}>(Markdown)</span>
            </label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Describe the issue… (Markdown supported)"
              rows={4}
              style={{
                width: '100%',
                background: '#0d1117',
                border: '1px solid #30363d',
                borderRadius: '6px',
                color: '#e6edf3',
                padding: '8px 10px',
                fontSize: '13px',
                resize: 'vertical',
                outline: 'none',
                lineHeight: '1.5',
              }}
              onFocus={(e) => { e.currentTarget.style.borderColor = '#388bfd' }}
              onBlur={(e) => { e.currentTarget.style.borderColor = '#30363d' }}
            />
          </div>

          {/* Column picker */}
          <div>
            <label style={{ fontSize: '12px', color: '#8b949e', display: 'block', marginBottom: '6px' }}>
              Column
            </label>
            <select
              value={column}
              onChange={(e) => setColumn(e.target.value as ColumnId)}
              style={{
                background: '#0d1117',
                border: '1px solid #30363d',
                borderRadius: '6px',
                color: '#e6edf3',
                padding: '6px 10px',
                fontSize: '13px',
                cursor: 'pointer',
                outline: 'none',
              }}
            >
              {COLUMNS.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          </div>

          {/* Labels */}
          {labels && labels.length > 0 && (
            <div>
              <label style={{ fontSize: '12px', color: '#8b949e', display: 'block', marginBottom: '6px' }}>
                Labels
              </label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {labels.map((label) => (
                  <button
                    key={label.id}
                    type="button"
                    onClick={() => toggleLabel(label.id)}
                    style={{
                      background: 'none',
                      border: `2px solid ${selectedLabelIds.includes(label.id) ? label.color : 'transparent'}`,
                      borderRadius: '12px',
                      padding: '0',
                      cursor: 'pointer',
                      opacity: selectedLabelIds.includes(label.id) ? 1 : 0.6,
                    }}
                  >
                    <LabelBadge name={label.name} color={label.color} />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', paddingTop: '4px' }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                background: 'none',
                border: '1px solid #30363d',
                borderRadius: '6px',
                color: '#e6edf3',
                padding: '6px 16px',
                fontSize: '13px',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!title.trim() || createIssue.isPending}
              style={{
                background: '#238636',
                border: '1px solid #2ea043',
                borderRadius: '6px',
                color: '#e6edf3',
                padding: '6px 16px',
                fontSize: '13px',
                fontWeight: 500,
                cursor: title.trim() ? 'pointer' : 'not-allowed',
                opacity: !title.trim() || createIssue.isPending ? 0.6 : 1,
              }}
            >
              {createIssue.isPending ? 'Creating…' : 'Create Issue'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
