import { type RoutingTier } from '../../api/routing.ts'

interface RoutingTierBadgeProps {
  tier: string
  showLabel?: boolean
}

const TIER_CONFIG: Record<RoutingTier, { label: string; sublabel: string; color: string; bg: string; border: string }> = {
  T1: {
    label: 'T1',
    sublabel: 'Deterministic',
    color: '#58a6ff',
    bg: 'rgba(88,166,255,0.15)',
    border: 'rgba(88,166,255,0.3)',
  },
  T2: {
    label: 'T2',
    sublabel: 'Keyword',
    color: '#d29922',
    bg: 'rgba(210,153,34,0.15)',
    border: 'rgba(210,153,34,0.3)',
  },
  T3: {
    label: 'T3',
    sublabel: 'LLM',
    color: '#bc8cff',
    bg: 'rgba(188,140,255,0.15)',
    border: 'rgba(188,140,255,0.3)',
  },
}

export function RoutingTierBadge({ tier, showLabel = false }: RoutingTierBadgeProps) {
  const cfg = TIER_CONFIG[tier as RoutingTier]
  if (!cfg) return null

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '3px',
        fontSize: '10px',
        fontWeight: 700,
        padding: '1px 6px',
        borderRadius: '10px',
        background: cfg.bg,
        color: cfg.color,
        border: `1px solid ${cfg.border}`,
        whiteSpace: 'nowrap',
        userSelect: 'none',
        letterSpacing: '0.02em',
      }}
    >
      {cfg.label}
      {showLabel && (
        <span style={{ fontWeight: 400, opacity: 0.8 }}>{cfg.sublabel}</span>
      )}
    </span>
  )
}
