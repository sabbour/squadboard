import { type ReviewDecision } from '../../api/reviews.ts'

interface ReviewDecisionBadgeProps {
  decision: ReviewDecision
}

const DECISION_CONFIG: Record<ReviewDecision, { label: string; color: string; bg: string; border: string; icon: string }> = {
  approved: {
    label: 'Approved',
    icon: '✅',
    color: '#3fb950',
    bg: 'rgba(63,185,80,0.12)',
    border: 'rgba(63,185,80,0.3)',
  },
  changes_requested: {
    label: 'Changes requested',
    icon: '🔄',
    color: '#d29922',
    bg: 'rgba(210,153,34,0.12)',
    border: 'rgba(210,153,34,0.3)',
  },
  pending: {
    label: 'Pending review',
    icon: '⏳',
    color: '#8b949e',
    bg: 'rgba(139,148,158,0.12)',
    border: 'rgba(139,148,158,0.3)',
  },
}

export function ReviewDecisionBadge({ decision }: ReviewDecisionBadgeProps) {
  const cfg = DECISION_CONFIG[decision]

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        fontSize: '11px',
        fontWeight: 500,
        padding: '2px 8px',
        borderRadius: '10px',
        background: cfg.bg,
        color: cfg.color,
        border: `1px solid ${cfg.border}`,
        whiteSpace: 'nowrap',
        userSelect: 'none',
      }}
    >
      <span>{cfg.icon}</span>
      {cfg.label}
    </span>
  )
}
