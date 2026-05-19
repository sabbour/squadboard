import { useState, useEffect, useRef } from 'react'
import { Subtitle2, Caption1, tokens } from '@fluentui/react-components'
import { Dismiss20Regular } from '@fluentui/react-icons'
import { type Agent, useAgent, useUpdateAgent } from '../../api/agents.ts'
import { safeRelativeTime } from '../../utils/dates.ts'
import StatusBadge from './StatusBadge.tsx'
import CharterEditor from './CharterEditor.tsx'
import AgentCapabilities from './AgentCapabilities.tsx'
import { getAgentOriginBadge, isReadOnlyAgent } from './agent-origin.ts'
import { formatAgentDisplayName } from './display-name.ts'

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

type Tab = 'overview' | 'charter' | 'capabilities'

export default function AgentDetailPanel({ projectId, agent, onClose }: AgentDetailPanelProps) {
  const [tab, setTab] = useState<Tab>('overview')
  const panelRef = useRef<HTMLDivElement>(null)
  const readOnlyAgent = isReadOnlyAgent(agent)
  const { data: detail } = useAgent(projectId, agent.id, { enabled: !readOnlyAgent })
  const updateAgent = useUpdateAgent(projectId)

  const current = detail ?? agent
  const currentReadOnly = isReadOnlyAgent(current)
  const originBadge = getAgentOriginBadge(current)
  const tabs: Tab[] = currentReadOnly ? ['overview'] : ['overview', 'charter', 'capabilities']
  const avatarBg = getAvatarColor(current.name)
  const initials = getInitials(current.name)
  const displayName = formatAgentDisplayName(current.name)

  useEffect(() => {
    if (currentReadOnly && tab !== 'overview') setTab('overview')
  }, [currentReadOnly, tab])

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

  function setStatus(next: 'active' | 'disabled' | 'retired') {
    updateAgent.mutate({ agentId: current.id, status: next })
  }

  function handleRetire() {
    if (
      !window.confirm(
        `Retire ${displayName}? Retired agents are hidden from pickers and listings by default — they remain on disk and can be re-enabled later if needed.`,
      )
    ) {
      return
    }
    setStatus('retired')
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
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            flexShrink: 0,
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
              fontWeight: tokens.fontWeightBold,
              flexShrink: 0,
              userSelect: 'none',
            }}
          >
            {initials}
          </span>

          {/* Name + role */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <Subtitle2 style={{ display: 'block', color: tokens.colorNeutralForeground1 }}>{displayName}</Subtitle2>
            <Caption1 style={{ display: 'block', color: tokens.colorNeutralForeground3, marginTop: tokens.spacingVerticalXXS }}>{current.role}</Caption1>
          </div>

          <StatusBadge status={current.status} />
          <span
            title={originBadge.title}
            style={{
              fontSize: '11px',
              padding: '2px 8px',
              borderRadius: '12px',
              background: originBadge.background,
              color: originBadge.color,
              border: `1px solid ${originBadge.border}`,
              flexShrink: 0,
            }}
          >
            {originBadge.label}
          </span>

          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              fontSize: '18px',
              cursor: 'pointer',
              padding: '2px 6px',
              borderRadius: '4px',
              flexShrink: 0,
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text)' }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)' }}
          >
            <Dismiss20Regular />
          </button>
        </div>

        {/* Tabs */}
        <div
          style={{
            display: 'flex',
            borderBottom: '1px solid var(--border)',
          }}
        >
          {tabs.map((t) => (
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
                fontWeight: tab === t ? tokens.fontWeightMedium : tokens.fontWeightRegular,
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
              {currentReadOnly && (
                <div
                  style={{
                    padding: '10px 12px',
                    borderRadius: '6px',
                    background: 'rgba(121,192,255,0.10)',
                    border: '1px solid rgba(121,192,255,0.25)',
                    color: 'var(--text-muted)',
                    fontSize: '12px',
                    lineHeight: 1.5,
                  }}
                >
                  {originBadge.title}. Squadboard will not edit, disable, retire, or write charter files for this member.
                </div>
              )}

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
                  <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>auto</span>
                )}
              </div>

              {/* Charter path */}
              <div>
                <p style={labelStyle}>Charter Path</p>
                <code
                  style={{
                    fontSize: '12px',
                    color: 'var(--text)',
                    background: 'var(--bg)',
                    padding: '4px 8px',
                    borderRadius: '4px',
                    border: '1px solid var(--border)',
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
                  <span style={{ fontSize: '13px', color: 'var(--text)' }}>
                    {safeRelativeTime(current.createdAt)}
                  </span>
                </div>
                <div>
                  <p style={labelStyle}>Last Updated</p>
                  <span style={{ fontSize: '13px', color: 'var(--text)' }}>
                    {safeRelativeTime(current.updatedAt)}
                  </span>
                </div>
              </div>

              {/* History excerpt */}
              {detail?.historyExcerpt && (
                <div>
                  <p style={labelStyle}>Recent History</p>
                  <div
                    style={{
                      background: 'var(--bg)',
                      border: '1px solid var(--border)',
                      borderRadius: '6px',
                      padding: '12px',
                      fontSize: '12px',
                      color: 'var(--text-muted)',
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

          {!currentReadOnly && tab === 'charter' && (
            <CharterEditor projectId={projectId} agentId={current.id} />
          )}

          {!currentReadOnly && tab === 'capabilities' && (
            <AgentCapabilities projectId={projectId} agentId={current.id} />
          )}
        </div>

        {/* Footer actions — Wave 10 B9 three-state controls.
            Active   → Disable (recoverable pause)
            Disabled → Re-enable, Retire (archive)
            Retired  → Re-enable (rare; keeps the option open)              */}
        <div
          style={{
            padding: '12px 20px',
            borderTop: '1px solid var(--border)',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '8px',
            flexShrink: 0,
          }}
        >
          {currentReadOnly ? (
            <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>
              Read-only roster entry; no project lifecycle actions are available.
            </Caption1>
          ) : current.status === 'active' && (
            <button
              onClick={() => setStatus('disabled')}
              disabled={updateAgent.isPending}
              title="Pause this agent — it stops appearing in pickers and cannot be invoked. Reversible."
              style={{
                background: 'rgba(210,153,34,0.12)',
                border: '1px solid rgba(210,153,34,0.4)',
                borderRadius: 'var(--radius)',
                color: '#d29922',
                padding: '6px 16px',
                fontSize: '13px',
                fontWeight: 500,
                cursor: 'pointer',
                opacity: updateAgent.isPending ? 0.6 : 1,
              }}
            >
              {updateAgent.isPending ? 'Updating…' : 'Disable Agent'}
            </button>
          )}

          {!currentReadOnly && current.status !== 'active' && (
            <button
              onClick={() => setStatus('active')}
              disabled={updateAgent.isPending}
              title="Bring this agent back online — pickers and runs will accept it again."
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
              {updateAgent.isPending ? 'Updating…' : 'Re-enable Agent'}
            </button>
          )}

          {!currentReadOnly && current.status === 'disabled' && (
            <button
              onClick={handleRetire}
              disabled={updateAgent.isPending}
              title="Archive this agent — hidden from listings by default. Charter file stays on disk."
              style={{
                background: 'rgba(139,148,158,0.12)',
                border: '1px solid rgba(139,148,158,0.4)',
                borderRadius: 'var(--radius)',
                color: 'var(--text-muted)',
                padding: '6px 16px',
                fontSize: '13px',
                fontWeight: 500,
                cursor: 'pointer',
                opacity: updateAgent.isPending ? 0.6 : 1,
              }}
            >
              Retire Agent
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

const labelStyle: React.CSSProperties = {
  fontSize: '11px',
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  marginBottom: '6px',
  fontWeight: 600,
}
