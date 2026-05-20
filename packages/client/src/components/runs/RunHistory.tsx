import { useState } from 'react'
import { useIssueRuns, useRetriggerRun, type RunStatus } from '../../api/runs.ts'
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

function canRetrigger(status: RunStatus): boolean {
  return status === 'failed' || status === 'cancelled' || status === 'completed'
}

export default function RunHistory({ projectId, issueId }: RunHistoryProps) {
  const { data: runs, isLoading } = useIssueRuns(projectId, issueId)
  const { data: agents } = useAgents(projectId)
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null)
  const [retriggerError, setRetriggerError] = useState<string | null>(null)
  const retriggerRun = useRetriggerRun(projectId)

  if (isLoading) {
    return <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Loading runs…</p>
  }

  if (!runs || runs.length === 0) {
    return (
      <p style={{ fontSize: '13px', color: 'var(--text-muted)', textAlign: 'center', padding: '24px 0' }}>
        No runs yet. Use the ▶ Run button on the card.
      </p>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {runs.map((run) => {
        const agent = agents?.find((a) => a.id === run.agentId)
        const isExpanded = expandedRunId === run.id
        const retriggerDisabled = retriggerRun.isPending || runs.some((r) => r.status === 'pending' || r.status === 'running')

        return (
          <div key={run.id} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div
              role="button"
              tabIndex={0}
              aria-label={`Toggle run ${run.id}`}
              onClick={() => setExpandedRunId(isExpanded ? null : run.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  setExpandedRunId(isExpanded ? null : run.id)
                }
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                background: 'var(--bg)',
                border: `1px solid ${isExpanded ? '#388bfd' : 'var(--border)'}`,
                borderRadius: '6px',
                padding: '8px 12px',
                cursor: 'pointer',
                textAlign: 'left',
                width: '100%',
                boxSizing: 'border-box',
              }}
            >
              {/* Agent avatar */}
              <Avatar
                name={agent?.name ?? run.agentId}
                avatarUrl={undefined}
                size={24}
              />

              {/* Agent name */}
              <span style={{ flex: 1, fontSize: '12px', fontWeight: 500, color: 'var(--text)' }}>
                {agent?.name ?? run.agentId}
              </span>

              {/* Status badge */}
              <RunStatusBadge status={run.status} />

              {/* Duration */}
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', minWidth: '40px', textAlign: 'right' }}>
                {duration(run.startedAt, run.completedAt)}
              </span>

              {/* Cost */}
              <CostDisplay costUsd={run.costUsd} costTokens={run.costTokens} />

              {canRetrigger(run.status) && (
                <button
                  aria-label={`Retrigger run ${run.id}`}
                  onClick={(event) => {
                    event.stopPropagation()
                    setRetriggerError(null)
                    retriggerRun.mutate(
                      { runId: run.id, issueId },
                      {
                        onSuccess: (newRun) => setExpandedRunId(newRun.id),
                        onError: (err) => setRetriggerError(err.message),
                      },
                    )
                  }}
                  disabled={retriggerDisabled}
                  title={
                    retriggerDisabled
                      ? 'Wait for the active run to finish before retriggering.'
                      : 'Start a new run with the same agent and settings.'
                  }
                  style={{
                    background: retriggerDisabled ? 'var(--bg)' : 'rgba(56,139,253,0.12)',
                    border: '1px solid rgba(56,139,253,0.35)',
                    color: retriggerDisabled ? 'var(--text-muted)' : '#58a6ff',
                    borderRadius: '4px',
                    padding: '2px 7px',
                    fontSize: '11px',
                    fontWeight: 600,
                    cursor: retriggerDisabled ? 'not-allowed' : 'pointer',
                    opacity: retriggerDisabled ? 0.55 : 1,
                  }}
                >
                  {retriggerRun.isPending ? 'Starting...' : 'Retrigger'}
                </button>
              )}

              {/* Expand chevron */}
              <span style={{ fontSize: '10px', color: 'var(--text-muted)', marginLeft: '4px' }}>
                {isExpanded ? '▲' : '▼'}
              </span>
            </div>

            {retriggerError && (
              <p style={{ margin: 0, fontSize: '12px', color: '#ff7b72' }}>
                {retriggerError}
              </p>
            )}

            {isExpanded && (
              <RunOutputPanel projectId={projectId} run={run} agent={agent} />
            )}
          </div>
        )
      })}
    </div>
  )
}
