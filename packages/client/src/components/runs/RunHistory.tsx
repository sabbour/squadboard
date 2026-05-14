import { useState } from 'react'
import { useIssueRuns } from '../../api/runs.ts'
import { useAgents } from '../../api/agents.ts'
import RunStatusBadge from './RunStatusBadge.tsx'
import RunOutputPanel from './RunOutputPanel.tsx'
import CostDisplay from './CostDisplay.tsx'
import Avatar from '../Avatar.tsx'

interface RunHistoryProps {
  projectId: string
  issueId: string
}

function duration(startedAt?: string, completedAt?: string): string {
  if (!startedAt) return '—'
  const start = new Date(startedAt).getTime()
  const end = completedAt ? new Date(completedAt).getTime() : Date.now()
  const secs = Math.round((end - start) / 1000)
  if (secs < 60) return `${secs}s`
  return `${Math.floor(secs / 60)}m ${secs % 60}s`
}

export default function RunHistory({ projectId, issueId }: RunHistoryProps) {
  const { data: runs, isLoading } = useIssueRuns(projectId, issueId)
  const { data: agents } = useAgents(projectId)
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null)

  if (isLoading) {
    return <p style={{ fontSize: '12px', color: '#8b949e' }}>Loading runs…</p>
  }

  if (!runs || runs.length === 0) {
    return (
      <p style={{ fontSize: '13px', color: '#484f58', textAlign: 'center', padding: '24px 0' }}>
        No runs yet. Use the ▶ Run button on the card.
      </p>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {runs.map((run) => {
        const agent = agents?.find((a) => a.id === run.agentId)
        const isExpanded = expandedRunId === run.id

        return (
          <div key={run.id} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <button
              onClick={() => setExpandedRunId(isExpanded ? null : run.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                background: '#21262d',
                border: `1px solid ${isExpanded ? '#388bfd' : '#30363d'}`,
                borderRadius: '6px',
                padding: '8px 12px',
                cursor: 'pointer',
                textAlign: 'left',
                width: '100%',
              }}
            >
              {/* Agent avatar */}
              <Avatar
                name={agent?.name ?? run.agentId}
                avatarUrl={undefined}
                size={24}
              />

              {/* Agent name */}
              <span style={{ flex: 1, fontSize: '12px', fontWeight: 500, color: '#e6edf3' }}>
                {agent?.name ?? run.agentId}
              </span>

              {/* Status badge */}
              <RunStatusBadge status={run.status} />

              {/* Duration */}
              <span style={{ fontSize: '11px', color: '#8b949e', minWidth: '40px', textAlign: 'right' }}>
                {duration(run.startedAt, run.completedAt)}
              </span>

              {/* Cost */}
              <CostDisplay costUsd={run.costUsd} costTokens={run.costTokens} />

              {/* Expand chevron */}
              <span style={{ fontSize: '10px', color: '#8b949e', marginLeft: '4px' }}>
                {isExpanded ? '▲' : '▼'}
              </span>
            </button>

            {isExpanded && (
              <RunOutputPanel projectId={projectId} run={run} agent={agent} />
            )}
          </div>
        )
      })}
    </div>
  )
}
