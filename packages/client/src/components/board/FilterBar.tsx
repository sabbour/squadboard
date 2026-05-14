import { useState, useRef } from 'react'
import { useLabels } from '../../api/labels.ts'
import LabelBadge from '../LabelBadge.tsx'
import { Search20Regular } from '@fluentui/react-icons'

interface FilterBarProps {
  projectId: string
  search: string
  onSearchChange: (v: string) => void
  activeLabelId: string | undefined
  onLabelChange: (id: string | undefined) => void
}

export default function FilterBar({
  projectId,
  search,
  onSearchChange,
  activeLabelId,
  onLabelChange,
}: FilterBarProps) {
  const { data: labels } = useLabels(projectId)
  const inputRef = useRef<HTMLInputElement>(null)
  const [focused, setFocused] = useState(false)

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '10px 24px',
        borderBottom: '1px solid #30363d',
        flexWrap: 'wrap',
        flexShrink: 0,
      }}
    >
      {/* Search input */}
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <span
          style={{
            position: 'absolute',
            left: '8px',
            top: '50%',
            transform: 'translateY(-50%)',
            color: '#8b949e',
            display: 'flex',
            pointerEvents: 'none',
          }}
        >
          <Search20Regular />
        </span>
        <input
          ref={inputRef}
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Filter by title…"
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            background: '#0d1117',
            border: `1px solid ${focused ? '#388bfd' : '#30363d'}`,
            borderRadius: '6px',
            color: '#e6edf3',
            padding: '6px 10px 6px 32px',
            fontSize: '13px',
            width: '220px',
            outline: 'none',
            transition: 'border-color 0.15s',
          }}
        />
        {search && (
          <button
            onClick={() => { onSearchChange(''); inputRef.current?.focus() }}
            style={{
              position: 'absolute',
              right: '8px',
              top: '50%',
              transform: 'translateY(-50%)',
              background: 'none',
              border: 'none',
              color: '#8b949e',
              cursor: 'pointer',
              fontSize: '12px',
              padding: 0,
            }}
          >
            ✕
          </button>
        )}
      </div>

      {/* Label filter chips */}
      {labels && labels.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '12px', color: '#8b949e' }}>Labels:</span>
          {activeLabelId && (
            <button
              onClick={() => onLabelChange(undefined)}
              style={{
                background: 'none',
                border: '1px solid #30363d',
                borderRadius: '12px',
                color: '#8b949e',
                padding: '2px 8px',
                fontSize: '11px',
                cursor: 'pointer',
              }}
            >
              Clear
            </button>
          )}
          {labels.map((label) => (
            <button
              key={label.id}
              onClick={() => onLabelChange(activeLabelId === label.id ? undefined : label.id)}
              style={{
                background: 'none',
                border: `2px solid ${activeLabelId === label.id ? label.color : 'transparent'}`,
                borderRadius: '12px',
                padding: '0',
                cursor: 'pointer',
                outline: 'none',
              }}
            >
              <LabelBadge name={label.name} color={label.color} />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
