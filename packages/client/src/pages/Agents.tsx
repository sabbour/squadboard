import { useState } from 'react'
import { useParams } from 'react-router'
import { useAgents, type Agent } from '../api/agents.ts'
import { apiFetch } from '../api/client.ts'
import { useRoutingLog, useRoutingStats, useRefreshKeywords, type TestRoutingResult } from '../api/routing.ts'
import AgentGrid from '../components/agents/AgentGrid.tsx'
import AgentDetailPanel from '../components/agents/AgentDetailPanel.tsx'
import HireAgentModal from '../components/agents/HireAgentModal.tsx'
import { RoutingTierBadge } from '../components/routing/RoutingTierBadge.tsx'
import { RoutingLogTable } from '../components/routing/RoutingLogTable.tsx'
import { RoutingStatsPanel } from '../components/routing/RoutingStatsPanel.tsx'
import { ArrowSync20Regular, Bot20Regular, ArrowSwap20Regular } from '@fluentui/react-icons'
import { Subtitle1 } from '@fluentui/react-components'

interface RouteTestResult {
  agentName: string | null
  ruleSummary: string | null
  matched: boolean
  tier?: TestRoutingResult['tier']
}

function TestRoutingPanel({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [labels, setLabels] = useState('')
  const [result, setResult] = useState<RouteTestResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleTest() {
    if (!title.trim()) return
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const labelList = labels.split(',').map((l) => l.trim()).filter(Boolean)
      const qs = new URLSearchParams({ title: title.trim() })
      labelList.forEach((l) => qs.append('label', l))
      const data = await apiFetch<RouteTestResult>(
        `/api/projects/${projectId}/routing/test?${qs.toString()}`
      )
      setResult(data)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Request failed')
    } finally {
      setLoading(false)
    }
  }

  const inputStyle: React.CSSProperties = {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    color: 'var(--text)',
    padding: '6px 10px',
    fontSize: '13px',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
  }

  return (
    <div
      style={{
        margin: '24px 0 0',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        overflow: 'hidden',
      }}
    >
      {/* Collapsible header */}
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: '100%',
          background: 'var(--bg)',
          border: 'none',
          borderBottom: open ? '1px solid var(--border)' : 'none',
          color: 'var(--text)',
          padding: '10px 16px',
          fontSize: '13px',
          fontWeight: 600,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          textAlign: 'left',
        }}
      >
        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{open ? '▾' : '▸'}</span>
        🧪 Test Routing
      </button>

      {open && (
        <div style={{ padding: '16px', background: 'var(--surface)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div>
            <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
              Issue title
            </label>
            <input
              style={inputStyle}
              placeholder="e.g. Fix the WebSocket reconnect bug"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleTest()}
            />
          </div>
          <div>
            <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
              Labels (comma-separated)
            </label>
            <input
              style={inputStyle}
              placeholder="e.g. bug, squad:hockney"
              value={labels}
              onChange={(e) => setLabels(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleTest()}
            />
          </div>

          <button
            onClick={handleTest}
            disabled={loading || !title.trim()}
            style={{
              alignSelf: 'flex-start',
              background: loading ? 'rgba(0,0,0,0.05)' : '#1f6feb',
              border: '1px solid #388bfd',
              borderRadius: 'var(--radius)',
              color: loading ? 'var(--text-muted)' : '#fff',
              padding: '6px 14px',
              fontSize: '13px',
              fontWeight: 500,
              cursor: loading || !title.trim() ? 'not-allowed' : 'pointer',
              opacity: !title.trim() ? 0.5 : 1,
            }}
          >
            {loading ? 'Testing…' : 'Test Route'}
          </button>

          {error && (
            <div style={{ fontSize: '12px', color: 'var(--danger)', padding: '8px', background: 'rgba(248,81,73,0.1)', borderRadius: 'var(--radius)', border: '1px solid rgba(248,81,73,0.3)' }}>
              {error}
            </div>
          )}

          {result && (
            <div
              style={{
                padding: '10px 14px',
                borderRadius: 'var(--radius)',
                background: result.matched ? 'rgba(46,160,67,0.1)' : 'rgba(139,148,158,0.1)',
                border: `1px solid ${result.matched ? 'rgba(46,160,67,0.3)' : 'var(--border)'}`,
                fontSize: '13px',
                color: 'var(--text)',
              }}
            >
              {result.matched ? (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ color: '#3fb950', fontWeight: 600 }}>✓ Routed to: </span>
                    <span style={{ fontWeight: 600 }}>{result.agentName}</span>
                    {result.tier && <RoutingTierBadge tier={result.tier} showLabel />}
                  </div>
                  {result.ruleSummary && (
                    <div style={{ marginTop: '4px', fontSize: '11px', color: 'var(--text-muted)' }}>
                      {result.ruleSummary}
                    </div>
                  )}
                </>
              ) : (
                <span style={{ color: 'var(--text-muted)' }}>No rule matched → Tier 2</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function Agents() {
  const { id: projectId = '' } = useParams<{ id: string }>()
  const { data: agents = [], isLoading, isError } = useAgents(projectId)
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null)
  const [showHireModal, setShowHireModal] = useState(false)
  const [activeTab, setActiveTab] = useState<'agents' | 'routing'>('agents')

  const { data: routingLog = [], isLoading: logLoading } = useRoutingLog(projectId)
  const { data: routingStats, isLoading: statsLoading } = useRoutingStats(projectId)
  const refreshKeywords = useRefreshKeywords(projectId)

  const TAB_STYLE = (active: boolean): React.CSSProperties => ({
    background: 'none',
    border: 'none',
    borderBottom: `2px solid ${active ? '#388bfd' : 'transparent'}`,
    color: active ? 'var(--text)' : 'var(--text-muted)',
    padding: '6px 14px',
    fontSize: '13px',
    fontWeight: active ? 600 : 400,
    cursor: 'pointer',
    marginBottom: '-1px',
  })

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
          <Subtitle1 as="h1">Agents</Subtitle1>
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

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {activeTab === 'routing' && (
            <button
              onClick={() => void refreshKeywords.mutate()}
              disabled={refreshKeywords.isPending}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                background: 'var(--bg)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                color: 'var(--text)',
                padding: '6px 12px',
                fontSize: '12px',
                cursor: refreshKeywords.isPending ? 'not-allowed' : 'pointer',
                opacity: refreshKeywords.isPending ? 0.6 : 1,
              }}
            >
              <ArrowSync20Regular /> Refresh keywords
            </button>
          )}
          {activeTab === 'agents' && (
            <button
              onClick={() => setShowHireModal(true)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                background: '#238636',
                border: '1px solid #2ea043',
                borderRadius: 'var(--radius)',
                color: 'white',
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
          )}
        </div>
      </div>

      {/* Tabs */}
      <div
        style={{
          display: 'flex',
          padding: '0 24px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}
      >
        <button style={TAB_STYLE(activeTab === 'agents')} onClick={() => setActiveTab('agents')}>
          <Bot20Regular /> Agents
        </button>
        <button style={TAB_STYLE(activeTab === 'routing')} onClick={() => setActiveTab('routing')}>
          <ArrowSwap20Regular /> Routing
        </button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
        {activeTab === 'agents' && (
          <>
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
              <>
                <AgentGrid agents={agents} onSelectAgent={setSelectedAgent} />
                <TestRoutingPanel projectId={projectId} />
              </>
            )}
          </>
        )}

        {activeTab === 'routing' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {/* Stats */}
            <div>
              <p style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '12px', fontWeight: 600 }}>
                Routing Stats
              </p>
              {routingStats ? (
                <RoutingStatsPanel stats={routingStats} isLoading={statsLoading} />
              ) : statsLoading ? (
                <RoutingStatsPanel stats={{ tier1Count: 0, tier2Count: 0, tier3Count: 0, triageCount: 0, total: 0 }} isLoading />
              ) : (
                <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>No routing data yet.</p>
              )}
            </div>

            {/* Log */}
            <div>
              <p style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '12px', fontWeight: 600 }}>
                Routing Log
              </p>
              <RoutingLogTable entries={routingLog} isLoading={logLoading} />
            </div>
          </div>
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
