import { type RunStatus } from '../../api/runs.ts'

interface RunStatusBadgeProps {
  status: RunStatus
  size?: 'sm' | 'md'
}

const STATUS_CONFIG: Record<RunStatus, { label: string; color: string; bg: string; pulse: boolean }> = {
  pending:   { label: 'Queued',    color: '#8b949e', bg: 'rgba(139,148,158,0.12)', pulse: false },
  running:   { label: 'Running',   color: '#58a6ff', bg: 'rgba(88,166,255,0.12)',  pulse: true  },
  completed: { label: 'Done',      color: '#3fb950', bg: 'rgba(63,185,80,0.12)',   pulse: false },
  failed:    { label: 'Failed',    color: '#f85149', bg: 'rgba(248,81,73,0.12)',   pulse: false },
  cancelled: { label: 'Cancelled', color: '#8b949e', bg: 'rgba(139,148,158,0.12)', pulse: false },
}

export default function RunStatusBadge({ status, size = 'sm' }: RunStatusBadgeProps) {
  const cfg = STATUS_CONFIG[status]
  const fontSize = size === 'md' ? '12px' : '11px'
  const dotSize = size === 'md' ? '8px' : '6px'

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '5px',
        background: cfg.bg,
        color: cfg.color,
        border: `1px solid ${cfg.color}33`,
        borderRadius: '10px',
        padding: size === 'md' ? '3px 10px' : '2px 7px',
        fontSize,
        fontWeight: 500,
        whiteSpace: 'nowrap',
      }}
    >
      <span
        style={{
          width: dotSize,
          height: dotSize,
          borderRadius: '50%',
          background: cfg.color,
          flexShrink: 0,
          animation: cfg.pulse ? 'runPulse 1.4s ease-in-out infinite' : undefined,
        }}
      />
      {cfg.label}
      <style>{`
        @keyframes runPulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%       { opacity: 0.4; transform: scale(0.7); }
        }
      `}</style>
    </span>
  )
}
