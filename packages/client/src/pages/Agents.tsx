import { useState } from 'react'
import { useParams } from 'react-router'
import { useAgents, type Agent } from '../api/agents.ts'
import AgentGrid from '../components/agents/AgentGrid.tsx'
import AgentDetailPanel from '../components/agents/AgentDetailPanel.tsx'
import HireAgentModal from '../components/agents/HireAgentModal.tsx'

export default function Agents() {
  const { id: projectId = '' } = useParams<{ id: string }>()
  const { data: agents = [], isLoading, isError } = useAgents(projectId)
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null)
  const [showHireModal, setShowHireModal] = useState(false)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* Page header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 24px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <h1 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text)' }}>Agents</h1>
          {!isLoading && (
            <span
              style={{
                fontSize: '12px',
                fontWeight: 600,
                padding: '2px 8px',
                borderRadius: '12px',
                background: 'rgba(139,148,158,0.15)',
                color: 'var(--text-muted)',
                border: '1px solid rgba(139,148,158,0.2)',
              }}
            >
              {agents.length}
            </span>
          )}
        </div>

        <button
          onClick={() => setShowHireModal(true)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            background: '#238636',
            border: '1px solid #2ea043',
            borderRadius: 'var(--radius)',
            color: '#e6edf3',
            padding: '7px 14px',
            fontSize: '13px',
            fontWeight: 500,
            cursor: 'pointer',
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = '#2ea043' }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = '#238636' }}
        >
          <span style={{ fontSize: '16px', lineHeight: 1 }}>+</span>
          Hire Agent
        </button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
        {isLoading && (
          <div style={{ color: 'var(--text-muted)', fontSize: '13px', textAlign: 'center', paddingTop: '48px' }}>
            Loading agents…
          </div>
        )}
        {isError && (
          <div style={{ color: 'var(--danger)', fontSize: '13px', textAlign: 'center', paddingTop: '48px' }}>
            Failed to load agents.
          </div>
        )}
        {!isLoading && !isError && (
          <AgentGrid agents={agents} onSelectAgent={setSelectedAgent} />
        )}
      </div>

      {/* Detail panel */}
      {selectedAgent && (
        <AgentDetailPanel
          projectId={projectId}
          agent={selectedAgent}
          onClose={() => setSelectedAgent(null)}
        />
      )}

      {/* Hire modal */}
      {showHireModal && (
        <HireAgentModal
          projectId={projectId}
          onClose={() => setShowHireModal(false)}
        />
      )}
    </div>
  )
}
