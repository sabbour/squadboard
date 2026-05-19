import { type ColumnId } from '../../api/issues.ts'
import { tokens } from '@fluentui/react-components'
import { Dismiss20Regular } from '@fluentui/react-icons'

interface BulkActionBarProps {
  selectedCount: number
  onMove: (column: ColumnId) => void
  onArchive: () => void
  onClear: () => void
}

const COLUMNS: { id: ColumnId; label: string }[] = [
  { id: 'backlog', label: 'Backlog' },
  { id: 'ready', label: 'Ready' },
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
        background: tokens.colorNeutralBackground2,
        border: `1px solid ${tokens.colorBrandBackground}`,
        borderRadius: '8px',
        padding: '10px 16px',
        boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
      }}
    >
      <span style={{ fontSize: '13px', fontWeight: 500, color: tokens.colorNeutralForeground1, marginRight: '4px' }}>
        {selectedCount} selected
      </span>

      <span style={{ color: tokens.colorNeutralStroke1, marginRight: '4px' }}>|</span>

      <span style={{ fontSize: '12px', color: tokens.colorNeutralForeground2 }}>Move to:</span>

      {COLUMNS.map((col) => (
        <button
          key={col.id}
          onClick={() => onMove(col.id)}
          style={{
            background: tokens.colorNeutralBackground1,
            border: `1px solid ${tokens.colorNeutralStroke1}`,
            borderRadius: '6px',
            color: tokens.colorNeutralForeground1,
            padding: '4px 10px',
            fontSize: '12px',
            cursor: 'pointer',
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = tokens.colorBrandBackground }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = tokens.colorNeutralStroke1 }}
        >
          {col.label}
        </button>
      ))}

      <span style={{ color: tokens.colorNeutralStroke1, margin: '0 4px' }}>|</span>

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
          color: tokens.colorNeutralForeground2,
          fontSize: '18px',
          cursor: 'pointer',
          padding: '0 4px',
          lineHeight: 1,
        }}
        title="Clear selection"
      >
        <Dismiss20Regular />
      </button>
    </div>
  )
}
