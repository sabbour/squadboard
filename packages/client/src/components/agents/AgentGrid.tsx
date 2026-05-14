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

export default function AgentGrid({ agents, onSelectAgent }: AgentGridProps) {
  const active = agents.filter((a) => a.status === 'active')
  const disabled = agents.filter((a) => a.status !== 'active')

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
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
    </div>
  )
}
