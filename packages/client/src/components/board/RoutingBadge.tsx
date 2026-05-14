import { useState } from 'react'
import { tokens } from '@fluentui/react-components'

export interface RoutingBadgeProps {
  ruleSummary: string // e.g., "Matched: label:bug → hockney"
}

/**
 * ⚡ Auto badge — shown on IssueCards that were assigned via deterministic routing.
 * Displays a tooltip with the matched rule summary on hover.
 */
export function RoutingBadge({ ruleSummary }: RoutingBadgeProps) {
  const [hovered, setHovered] = useState(false)

  return (
    <span
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '2px',
          fontSize: '10px',
          fontWeight: 600,
          padding: '1px 5px',
          borderRadius: '10px',
          background: 'rgba(210, 153, 34, 0.15)',
          color: '#d29922',
          border: '1px solid rgba(210, 153, 34, 0.3)',
          cursor: 'default',
          userSelect: 'none',
          whiteSpace: 'nowrap',
        }}
      >
        ⚡ Auto
      </span>

      {hovered && (
        <span
          style={{
            position: 'absolute',
            bottom: '100%',
            left: '50%',
            transform: 'translateX(-50%)',
            marginBottom: '4px',
            background: tokens.colorNeutralBackground1,
            border: `1px solid ${tokens.colorNeutralStroke1}`,
            borderRadius: '6px',
            padding: '5px 8px',
            fontSize: '11px',
            color: tokens.colorNeutralForeground1,
            whiteSpace: 'nowrap',
            zIndex: 100,
            boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
            pointerEvents: 'none',
          }}
        >
          {ruleSummary}
        </span>
      )}
    </span>
  )
}
