import { useState } from 'react'
import { useParams } from 'react-router'
import { useAgents, type Agent } from '../api/agents.ts'
import { useProject } from '../api/projects.ts'
import { apiFetch } from '../api/client.ts'
import { useRoutingLog, useRoutingStats, useRefreshKeywords } from '../api/routing.ts'
import AgentGrid from '../components/agents/AgentGrid.tsx'
import AgentDetailPanel from '../components/agents/AgentDetailPanel.tsx'
import HireAgentModal from '../components/agents/HireAgentModal.tsx'
import HireTeamModal from '../components/agents/HireTeamModal.tsx'
import { RoutingTierBadge } from '../components/routing/RoutingTierBadge.tsx'
import { RoutingLogTable } from '../components/routing/RoutingLogTable.tsx'
import { RoutingStatsPanel } from '../components/routing/RoutingStatsPanel.tsx'
import { CastPanel } from '../components/routing/CastPanel.tsx'
import { ArrowSync20Regular, Bot20Regular, ArrowSwap20Regular, People20Regular } from '@fluentui/react-icons'
import { Caption1, Body1, tokens } from '@fluentui/react-components'
import PageHeader from '../components/layout/PageHeader.tsx'

interface RouteTestResult {
  matched: boolean
  agentName: string | null
  matchedRule: string | null
  tier?: string
  agentId?: string | null
  score?: number | null
  reasoning?: string | null
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
      const data = await apiFetch<RouteTestResult>(
        `/api/projects/${projectId}/routing/test`,
        { method: 'POST', body: JSON.stringify({ title: title.trim(), labels: labelList }) }
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
          fontWeight: tokens.fontWeightSemibold,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          textAlign: 'left',
        }}
      >
        <span style={{ fontSize: '11px', color: tokens.colorNeutralForeground3 }}>{open ? '▾' : '▸'}</span>
        🧪 Test Routing
      </button>

      {open && (
        <div style={{ padding: '16px', background: 'var(--surface)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div>
            <label style={{ fontSize: '11px', color: tokens.colorNeutralForeground3, display: 'block', marginBottom: '4px' }}>
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
            <label style={{ fontSize: '11px', color: tokens.colorNeutralForeground3, display: 'block', marginBottom: '4px' }}>
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
                color: tokens.colorNeutralForeground1,
              }}
            >
              {result.matched ? (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ color: '#3fb950', fontWeight: tokens.fontWeightSemibold }}>✓ Routed to: </span>
                    <span style={{ fontWeight: tokens.fontWeightSemibold }}>{result.agentName}</span>
                    {result.tier && <RoutingTierBadge tier={result.tier} showLabel />}
                  </div>
                  {result.matchedRule && (
                    <div style={{ marginTop: '4px', fontSize: '11px', color: tokens.colorNeutralForeground3 }}>
                      {result.matchedRule}
                    </div>
                  )}
                </>
              ) : (
                <span style={{ color: tokens.colorNeutralForeground3 }}>No rule matched → Tier 2</span>
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
  const { data: project } = useProject(projectId)
  const { data: agents = [], isLoading, isError } = useAgents(projectId)
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null)
  const [showHireModal, setShowHireModal] = useState(false)
  const [showHireTeamModal, setShowHireTeamModal] = useState(false)
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
    fontWeight: active ? tokens.fontWeightSemibold : tokens.fontWeightRegular,
    cursor: 'pointer',
    marginBottom: '-1px',
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <PageHeader
        eyebrow={project?.name}
        title={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '12px' }}>
            Agents
            {!isLoading && (
              <span
                style={{
                  fontSize: '12px',
                  fontWeight: tokens.fontWeightSemibold,
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
          </span>
        }
        description={activeTab === 'routing'
          ? 'Routing rules, recent decisions, and keyword tuning across the squad.'
          : 'Hired agents on this project — their roles, models, and capabilities.'}
        actions={
          <>
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
              <>
                <button
                  onClick={() => setShowHireTeamModal(true)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    background: 'var(--bg)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)',
                    color: 'var(--text)',
                    padding: '7px 14px',
                    fontSize: '13px',
                    fontWeight: 500,
                    cursor: 'pointer',
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface)' }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg)' }}
                >
                  <People20Regular />
                  Hire Team
                </button>
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
              </>
            )}
          </>
        }
      />

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
              <div style={{ textAlign: 'center', paddingTop: '48px' }}>
                <Body1 style={{ color: tokens.colorNeutralForeground3 }}>Loading agents…</Body1>
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
                {import.meta.env.DEV && <TestRoutingPanel projectId={projectId} />}
              </>
            )}
          </>
        )}

        {activeTab === 'routing' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {/* Cast — try the full 3-tier router on a hypothetical issue */}
            <div>
              <Caption1 as="p" style={{ display: 'block', color: tokens.colorNeutralForeground3, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: tokens.spacingVerticalM, fontWeight: tokens.fontWeightSemibold }}>
                Cast Issue
              </Caption1>
              <CastPanel
                projectId={projectId}
                onUseAgent={(agentId) => {
                  const agent = agents.find((a) => a.id === agentId)
                  if (agent) setSelectedAgent(agent)
                }}
              />
            </div>

            {/* Stats */}
            <div>
              <Caption1 as="p" style={{ display: 'block', color: tokens.colorNeutralForeground3, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: tokens.spacingVerticalM, fontWeight: tokens.fontWeightSemibold }}>
                Routing Stats
              </Caption1>
              {routingStats ? (
                <RoutingStatsPanel stats={routingStats} isLoading={statsLoading} />
              ) : statsLoading ? (
                <RoutingStatsPanel stats={{ tier1Count: 0, tier2Count: 0, tier3Count: 0, triageCount: 0, total: 0 }} isLoading />
              ) : (
                <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>No routing data yet.</Caption1>
              )}
            </div>

            {/* Log */}
            <div>
              <Caption1 as="p" style={{ display: 'block', color: tokens.colorNeutralForeground3, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: tokens.spacingVerticalM, fontWeight: tokens.fontWeightSemibold }}>
                Routing Log
              </Caption1>
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

      {/* Hire Team modal */}
      {showHireTeamModal && (
        <HireTeamModal
          projectId={projectId}
          onClose={() => setShowHireTeamModal(false)}
        />
      )}
    </div>
  )
}
