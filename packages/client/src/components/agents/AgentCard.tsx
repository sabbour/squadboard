import { useState } from 'react'
import { type Agent } from '../../api/agents.ts'

interface AgentCardProps {
  agent: Agent
  onClick: (agent: Agent) => void
  muted?: boolean
}

const AVATAR_COLORS = ['#388bfd', '#3fb950', '#f78166', '#d2a8ff', '#ffa657', '#79c0ff', '#56d364']

function getAvatarColor(name: string): string {
  const idx = name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % AVATAR_COLORS.length
  return AVATAR_COLORS[idx]
}

function getInitials(name: string): string {
  return name
    .split(/[-\s]+/)
    .map((w) => w[0] ?? '')
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

export default function AgentCard({ agent, onClick, muted = false }: AgentCardProps) {
  const [hovered, setHovered] = useState(false)
  const avatarBg = getAvatarColor(agent.name)
  const initials = getInitials(agent.name)

  // Wave 10 B9: three-state legend instead of binary active/!active.
  // Active = green, Disabled = amber (paused, recoverable), Retired = gray
  // (archived). The tooltip uses the literal status value so QA can grep.
  const statusDotColor =
    agent.status === 'active' ? '#3fb950'
    : agent.status === 'disabled' ? '#d29922'
    : '#8b949e'

  return (
    <button
      onClick={() => onClick(agent)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        padding: '16px',
        background: 'var(--surface)',
        border: `1px solid ${hovered ? 'var(--accent)' : 'var(--card-border, var(--border))'}`,
        borderRadius: 'var(--radius)',
        cursor: 'pointer',
        textAlign: 'left',
        width: '100%',
        opacity: muted ? 0.6 : 1,
        transition: 'border-color 0.15s, opacity 0.15s',
      }}
    >
      {/* Avatar row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        {/* Initials avatar */}
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '40px',
            height: '40px',
            borderRadius: '50%',
            background: avatarBg,
            color: '#0d1117',
            fontSize: '15px',
            fontWeight: 700,
            flexShrink: 0,
            userSelect: 'none',
          }}
        >
          {initials}
        </span>

        {/* Name + role */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontWeight: 600,
              fontSize: '13px',
              color: muted ? 'var(--text-muted)' : 'var(--text)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {agent.name}
          </div>
          <div
            style={{
              fontSize: '12px',
              color: 'var(--text-muted)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              marginTop: '2px',
            }}
          >
            {agent.role}
          </div>
        </div>

        {/* Status dot — green=active, amber=disabled, gray=retired (B9) */}
        <span
          title={agent.status}
          style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: statusDotColor,
            flexShrink: 0,
          }}
        />
      </div>

      {/* Model badge */}
      {agent.model && (
        <span
          style={{
            alignSelf: 'flex-start',
            fontSize: '11px',
            padding: '2px 8px',
            borderRadius: '12px',
            background: 'rgba(56,139,253,0.12)',
            color: '#79c0ff',
            border: '1px solid rgba(56,139,253,0.25)',
            fontFamily: 'ui-monospace, SFMono-Regular, monospace',
          }}
        >
          {agent.model}
        </span>
      )}
    </button>
  )
}
