import { useState, useEffect, useRef } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { type Agent, useAgent, useUpdateAgent } from '../../api/agents.ts'
import StatusBadge from './StatusBadge.tsx'
import CharterEditor from './CharterEditor.tsx'

interface AgentDetailPanelProps {
  projectId: string
  agent: Agent
  onClose: () => void
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

type Tab = 'overview' | 'charter'

export default function AgentDetailPanel({ projectId, agent, onClose }: AgentDetailPanelProps) {
  const [tab, setTab] = useState<Tab>('overview')
  const panelRef = useRef<HTMLDivElement>(null)
  const { data: detail } = useAgent(projectId, agent.id)
  const updateAgent = useUpdateAgent(projectId)

  const current = detail ?? agent
  const avatarBg = getAvatarColor(current.name)
  const initials = getInitials(current.name)

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  function handleBackdropClick(e: React.MouseEvent) {
    if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
      onClose()
    }
  }

  function toggleStatus() {
    const newStatus = current.status === 'active' ? 'disabled' : 'active'
    updateAgent.mutate({ agentId: current.id, status: newStatus })
  }

  return (
    <div
      onClick={handleBackdropClick}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        justifyContent: 'flex-end',
      }}
    >
      <div
        ref={panelRef}
        style={{
          width: '520px',
          maxWidth: '100vw',
          height: '100%',
          background: 'var(--surface)',
          borderLeft: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          overflowY: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid var(--border)',
          }}
        >
          {/* Avatar */}
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '44px',
              height: '44px',
              borderRadius: '50%',
              background: avatarBg,
              color: '#0d1117',
              fontSize: '16px',
              fontWeight: 700,
              flexShrink: 0,
              userSelect: 'none',
            }}
          >
            {initials}
          </span>

          {/* Name + role */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: '15px', color: '#e6edf3' }}>{current.name}</div>
            <div style={{ fontSize: '12px', color: '#8b949e', marginTop: '2px' }}>{current.role}</div>
          </div>

          <StatusBadge status={current.status} />

          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: '#8b949e',
              fontSize: '18px',
              cursor: 'pointer',
              padding: '2px 6px',
              borderRadius: '4px',
              flexShrink: 0,
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '#e6edf3' }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '#8b949e' }}
          >
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div
          style={{
            display: 'flex',
            borderBottom: '1px solid #30363d',
            flexShrink: 0,
          }}
        >
          {(['overview', 'charter'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                padding: '10px 20px',
                background: 'none',
                border: 'none',
                borderBottom: `2px solid ${tab === t ? 'var(--accent)' : 'transparent'}`,
                color: tab === t ? 'var(--text)' : 'var(--text-muted)',
                fontSize: '13px',
                fontWeight: tab === t ? 500 : 400,
                cursor: 'pointer',
                textTransform: 'capitalize',
                marginBottom: '-1px',
              }}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Tab body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {tab === 'overview' && (
            <>
              {/* Model */}
              <div>
                <p style={labelStyle}>Model</p>
                {current.model ? (
                  <span
                    style={{
                      fontSize: '12px',
                      padding: '3px 10px',
                      borderRadius: '12px',
                      background: 'rgba(56,139,253,0.12)',
                      color: '#79c0ff',
                      border: '1px solid rgba(56,139,253,0.25)',
                      fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                    }}
                  >
                    {current.model}
                  </span>
                ) : (
                  <span style={{ fontSize: '13px', color: '#8b949e' }}>auto</span>
                )}
              </div>

              {/* Charter path */}
              <div>
                <p style={labelStyle}>Charter Path</p>
                <code
                  style={{
                    fontSize: '12px',
                    color: '#e6edf3',
                    background: '#0d1117',
                    padding: '4px 8px',
                    borderRadius: '4px',
                    border: '1px solid #30363d',
                    display: 'inline-block',
                    wordBreak: 'break-all',
                  }}
                >
                  {current.charterPath}
                </code>
              </div>

              {/* Dates */}
              <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
                <div>
                  <p style={labelStyle}>Created</p>
                  <span style={{ fontSize: '13px', color: '#e6edf3' }}>
                    {formatDistanceToNow(new Date(current.createdAt), { addSuffix: true })}
                  </span>
                </div>
                <div>
                  <p style={labelStyle}>Last Updated</p>
                  <span style={{ fontSize: '13px', color: '#e6edf3' }}>
                    {formatDistanceToNow(new Date(current.updatedAt), { addSuffix: true })}
                  </span>
                </div>
              </div>

              {/* History excerpt */}
              {detail?.historyExcerpt && (
                <div>
                  <p style={labelStyle}>Recent History</p>
                  <div
                    style={{
                      background: '#0d1117',
                      border: '1px solid #30363d',
                      borderRadius: '6px',
                      padding: '12px',
                      fontSize: '12px',
                      color: '#8b949e',
                      lineHeight: '1.6',
                      whiteSpace: 'pre-wrap',
                      fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                      maxHeight: '180px',
                      overflowY: 'auto',
                    }}
                  >
                    {detail.historyExcerpt}
                  </div>
                </div>
              )}
            </>
          )}

          {tab === 'charter' && (
            <CharterEditor projectId={projectId} agentId={current.id} />
          )}
        </div>

        {/* Footer actions */}
        <div
          style={{
            padding: '12px 20px',
            borderTop: '1px solid #30363d',
            display: 'flex',
            justifyContent: 'flex-end',
            flexShrink: 0,
          }}
        >
          {current.status === 'active' ? (
            <button
              onClick={toggleStatus}
              disabled={updateAgent.isPending}
              style={{
                background: 'rgba(248,81,73,0.1)',
                border: '1px solid rgba(248,81,73,0.4)',
                borderRadius: 'var(--radius)',
                color: '#f85149',
                padding: '6px 16px',
                fontSize: '13px',
                fontWeight: 500,
                cursor: 'pointer',
                opacity: updateAgent.isPending ? 0.6 : 1,
              }}
            >
              {updateAgent.isPending ? 'Updating…' : 'Disable Agent'}
            </button>
          ) : (
            <button
              onClick={toggleStatus}
              disabled={updateAgent.isPending}
              style={{
                background: 'rgba(63,185,80,0.1)',
                border: '1px solid rgba(63,185,80,0.4)',
                borderRadius: 'var(--radius)',
                color: '#3fb950',
                padding: '6px 16px',
                fontSize: '13px',
                fontWeight: 500,
                cursor: 'pointer',
                opacity: updateAgent.isPending ? 0.6 : 1,
              }}
            >
              {updateAgent.isPending ? 'Updating…' : 'Enable Agent'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

const labelStyle: React.CSSProperties = {
  fontSize: '11px',
  color: '#8b949e',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  marginBottom: '6px',
  fontWeight: 600,
}
