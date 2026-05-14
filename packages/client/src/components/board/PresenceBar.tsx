// Demo 12 — shows connected users with avatar initials + cursor tooltip.

import { type PresenceUser } from '../../realtime/usePresence.ts'
import { type ConnectionState } from '../../realtime/ws-client.ts'

// Deterministic color per userId so avatars are stable across renders
const AVATAR_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f59e0b',
  '#10b981', '#3b82f6', '#f97316', '#06b6d4',
]

function colorFor(userId: string): string {
  let hash = 0
  for (const ch of userId) hash = (hash * 31 + ch.charCodeAt(0)) | 0
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

function initials(userId: string): string {
  return userId.slice(0, 2).toUpperCase()
}

const STATUS_DOT: Record<ConnectionState, { color: string; label: string }> = {
  connected: { color: '#22c55e', label: 'Connected' },
  reconnecting: { color: '#eab308', label: 'Reconnecting…' },
  connecting: { color: '#eab308', label: 'Connecting…' },
  disconnected: { color: '#ef4444', label: 'Disconnected' },
}

interface PresenceBarProps {
  users: PresenceUser[]
  connected: ConnectionState
  /** Issue title lookup so tooltips show "Viewing: My Issue Title" */
  issueTitles?: Record<string, string>
}

export default function PresenceBar({ users, connected, issueTitles = {} }: PresenceBarProps) {
  const MAX = 5
  const visible = users.slice(0, MAX)
  const overflow = users.length - MAX

  const dot = STATUS_DOT[connected]

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        marginLeft: 'auto',
        flexShrink: 0,
      }}
      aria-label="Presence bar"
    >
      {/* Avatars */}
      <div style={{ display: 'flex', alignItems: 'center' }}>
        {visible.map((user, idx) => {
          const title = user.issueId ? (issueTitles[user.issueId] ?? user.issueId) : null
          const tooltip = title ? `Viewing: ${title}` : user.userId
          return (
            <div
              key={user.userId}
              title={tooltip}
              style={{
                width: '28px',
                height: '28px',
                borderRadius: '50%',
                background: colorFor(user.userId),
                color: '#fff',
                fontSize: '11px',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: '2px solid var(--bg, #0d1117)',
                marginLeft: idx === 0 ? 0 : '-6px',
                cursor: 'default',
                userSelect: 'none',
                zIndex: MAX - idx,
                position: 'relative',
              }}
            >
              {initials(user.userId)}
            </div>
          )
        })}

        {overflow > 0 && (
          <div
            title={`${overflow} more user${overflow > 1 ? 's' : ''}`}
            style={{
              width: '28px',
              height: '28px',
              borderRadius: '50%',
              background: 'var(--surface, #161b22)',
              border: '2px solid var(--border, #30363d)',
              color: 'var(--text-muted, #8b949e)',
              fontSize: '10px',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginLeft: '-6px',
              cursor: 'default',
              userSelect: 'none',
              zIndex: 0,
              position: 'relative',
            }}
          >
            +{overflow}
          </div>
        )}
      </div>

      {/* Connection status dot */}
      <div
        title={dot.label}
        style={{
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          background: dot.color,
          flexShrink: 0,
          boxShadow: `0 0 4px ${dot.color}`,
          transition: 'background 0.3s',
        }}
        aria-label={dot.label}
      />
    </div>
  )
}
