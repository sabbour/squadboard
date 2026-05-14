import { type ColumnId } from '../../api/issues.ts'

interface BulkActionBarProps {
  selectedCount: number
  onMove: (column: ColumnId) => void
  onArchive: () => void
  onClear: () => void
}

const COLUMNS: { id: ColumnId; label: string }[] = [
  { id: 'backlog', label: 'Backlog' },
  { id: 'todo', label: 'Todo' },
  { id: 'in_progress', label: 'In Progress' },
  { id: 'in_review', label: 'In Review' },
  { id: 'done', label: 'Done' },
]

export default function BulkActionBar({ selectedCount, onMove, onArchive, onClear }: BulkActionBarProps) {
  if (selectedCount === 0) return null

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '24px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 200,
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        background: '#21262d',
        border: '1px solid #388bfd',
        borderRadius: '8px',
        padding: '10px 16px',
        boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
      }}
    >
      <span style={{ fontSize: '13px', fontWeight: 500, color: '#e6edf3', marginRight: '4px' }}>
        {selectedCount} selected
      </span>

      <span style={{ color: '#30363d', marginRight: '4px' }}>|</span>

      <span style={{ fontSize: '12px', color: '#8b949e' }}>Move to:</span>

      {COLUMNS.map((col) => (
        <button
          key={col.id}
          onClick={() => onMove(col.id)}
          style={{
            background: '#0d1117',
            border: '1px solid #30363d',
            borderRadius: '6px',
            color: '#e6edf3',
            padding: '4px 10px',
            fontSize: '12px',
            cursor: 'pointer',
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#388bfd' }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#30363d' }}
        >
          {col.label}
        </button>
      ))}

      <span style={{ color: '#30363d', margin: '0 4px' }}>|</span>

      <button
        onClick={onArchive}
        style={{
          background: 'none',
          border: '1px solid #f85149',
          borderRadius: '6px',
          color: '#f85149',
          padding: '4px 10px',
          fontSize: '12px',
          cursor: 'pointer',
        }}
      >
        Archive
      </button>

      <button
        onClick={onClear}
        style={{
          background: 'none',
          border: 'none',
          color: '#8b949e',
          fontSize: '18px',
          cursor: 'pointer',
          padding: '0 4px',
          lineHeight: 1,
        }}
        title="Clear selection"
      >
        ✕
      </button>
    </div>
  )
}
