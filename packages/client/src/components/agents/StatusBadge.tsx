import { type Agent } from '../../api/agents.ts'

interface StatusBadgeProps {
  status: Agent['status']
}

const STATUS_CONFIG: Record<Agent['status'], { label: string; bg: string; color: string; border: string }> = {
  active: { label: 'Active', bg: 'rgba(63,185,80,0.12)', color: '#3fb950', border: 'rgba(63,185,80,0.3)' },
  disabled: { label: 'Disabled', bg: 'rgba(139,148,158,0.12)', color: '#8b949e', border: 'rgba(139,148,158,0.3)' },
  retired: { label: 'Retired', bg: 'rgba(255,166,87,0.12)', color: '#ffa657', border: 'rgba(255,166,87,0.3)' },
}

export default function StatusBadge({ status }: StatusBadgeProps) {
  const cfg = STATUS_CONFIG[status]
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '5px',
        fontSize: '11px',
        fontWeight: 500,
        padding: '2px 8px',
        borderRadius: '12px',
        background: cfg.bg,
        color: cfg.color,
        border: `1px solid ${cfg.border}`,
        letterSpacing: '0.02em',
        userSelect: 'none',
      }}
    >
      <span
        style={{
          width: '6px',
          height: '6px',
          borderRadius: '50%',
          background: cfg.color,
          flexShrink: 0,
        }}
      />
      {cfg.label}
    </span>
  )
}
