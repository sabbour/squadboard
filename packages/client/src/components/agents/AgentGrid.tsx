import { useState } from 'react'
import { type Agent } from '../../api/agents.ts'
import AgentCard from './AgentCard.tsx'

interface AgentGridProps {
  agents: Agent[]
  onSelectAgent: (agent: Agent) => void
}

function SectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
      <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {label}
      </span>
      <span
        style={{
          fontSize: '11px',
          fontWeight: 600,
          padding: '1px 7px',
          borderRadius: '12px',
          background: 'rgba(139,148,158,0.15)',
          color: 'var(--text-muted)',
          border: '1px solid rgba(139,148,158,0.2)',
        }}
      >
        {count}
      </span>
    </div>
  )
}

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
  gap: '12px',
}

// Wave 10 B9: three-state legend pinned to the top of the grid so the
// status dots on each card are self-explanatory at a glance.
function StatusLegend() {
  const items: Array<{ color: string; label: string; title: string }> = [
    { color: '#3fb950', label: 'Active',   title: 'Active — runnable everywhere.' },
    { color: '#d29922', label: 'Disabled', title: 'Disabled — paused, can be re-enabled.' },
    { color: '#8b949e', label: 'Retired',  title: 'Retired — archived, hidden by default.' },
  ]
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
      {items.map((it) => (
        <span key={it.label} title={it.title} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--text-muted)' }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: it.color, display: 'inline-block' }} />
          {it.label}
        </span>
      ))}
    </div>
  )
}

export default function AgentGrid({ agents, onSelectAgent }: AgentGridProps) {
  // Wave 10 B9: split into three roster sections so disabled and retired
  // agents are visually distinct. Retired is hidden behind a toggle so the
  // common case stays uncluttered.
  const [showRetired, setShowRetired] = useState(false)

  const active   = agents.filter((a) => a.status === 'active')
  const disabled = agents.filter((a) => a.status === 'disabled')
  const retired  = agents.filter((a) => a.status === 'retired')

  if (agents.length === 0) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '12px',
          padding: '80px 24px',
          color: 'var(--text-muted)',
          textAlign: 'center',
        }}
      >
        <span style={{ fontSize: '32px' }}>⬡</span>
        <p style={{ fontSize: '15px', fontWeight: 500, color: 'var(--text)' }}>No agents yet</p>
        <p style={{ fontSize: '13px' }}>Click <strong>Hire Agent</strong> to discover your team</p>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Legend + show-retired toggle */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
        <StatusLegend />
        {retired.length > 0 && (
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-muted)', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={showRetired}
              onChange={(e) => setShowRetired(e.target.checked)}
              aria-label="Show retired agents"
            />
            Show retired ({retired.length})
          </label>
        )}
      </div>

      {/* Active section */}
      {active.length > 0 && (
        <section>
          <SectionHeader label="Active" count={active.length} />
          <div style={gridStyle}>
            {active.map((agent) => (
              <AgentCard key={agent.id} agent={agent} onClick={onSelectAgent} />
            ))}
          </div>
        </section>
      )}

      {/* Disabled section */}
      {disabled.length > 0 && (
        <section>
          <SectionHeader label="Disabled" count={disabled.length} />
          <div style={gridStyle}>
            {disabled.map((agent) => (
              <AgentCard key={agent.id} agent={agent} onClick={onSelectAgent} muted />
            ))}
          </div>
        </section>
      )}

      {/* Retired section — opt-in */}
      {showRetired && retired.length > 0 && (
        <section>
          <SectionHeader label="Retired" count={retired.length} />
          <div style={gridStyle}>
            {retired.map((agent) => (
              <AgentCard key={agent.id} agent={agent} onClick={onSelectAgent} muted />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
