import { useEffect, useState } from 'react'
import { useIssueRuns, useRetriggerRun, type RunStatus } from '../../api/runs.ts'
import { useAgents } from '../../api/agents.ts'
import RunStatusBadge from './RunStatusBadge.tsx'
import RunOutputPanel from './RunOutputPanel.tsx'
import CostDisplay from './CostDisplay.tsx'
import Avatar from '../Avatar.tsx'
import { ChevronDown20Regular, ChevronRight20Regular } from '@fluentui/react-icons'

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

function isActiveRun(status: RunStatus): boolean {
  return status === 'pending' || status === 'running'
}

function runSummary(status: RunStatus): string {
  if (status === 'pending') return 'Queued and waiting for an agent'
  if (status === 'running') return 'Live now — streaming progress below'
  if (status === 'completed') return 'Completed run'
  if (status === 'failed') return 'Failed run — inspect error and recovery markers'
  return 'Cancelled run'
}

export default function RunHistory({ projectId, issueId }: RunHistoryProps) {
  const { data: runs, isLoading } = useIssueRuns(projectId, issueId)
  const { data: agents } = useAgents(projectId)
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null)
  const [hasAutoExpanded, setHasAutoExpanded] = useState(false)
  const [retriggerError, setRetriggerError] = useState<string | null>(null)
  const retriggerRun = useRetriggerRun(projectId)

  useEffect(() => {
    if (hasAutoExpanded || !runs || runs.length === 0) return
    const active = runs.find((run) => isActiveRun(run.status))
    const latest = runs[runs.length - 1]
    setExpandedRunId((active ?? latest).id)
    setHasAutoExpanded(true)
  }, [hasAutoExpanded, runs])

  if (isLoading) {
    return <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Loading runs…</p>
  }

  if (!runs || runs.length === 0) {
    return (
      <div
        style={{
          border: '1px dashed var(--border)',
          borderRadius: '10px',
          padding: '28px 20px',
          textAlign: 'center',
          color: 'var(--text-muted)',
          background: 'var(--bg)',
        }}
      >
        <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text)', marginBottom: '6px' }}>
          No runs yet
        </div>
        <div style={{ fontSize: '13px' }}>
          Start a run to see live status, workspace, logs, outputs, and flow context here.
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {runs.map((run) => {
        const agent = agents?.find((a) => a.id === run.agentId)
        const isExpanded = expandedRunId === run.id
        const active = isActiveRun(run.status)
        const retriggerDisabled = retriggerRun.isPending || runs.some((r) => r.status === 'pending' || r.status === 'running')

        return (
          <div key={run.id} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
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
                alignItems: 'stretch',
                gap: '12px',
                background: 'var(--bg)',
                border: `1px solid ${isExpanded ? '#388bfd' : active ? 'rgba(88,166,255,0.45)' : 'var(--border)'}`,
                borderRadius: '10px',
                padding: '12px',
                cursor: 'pointer',
                textAlign: 'left',
                width: '100%',
                boxSizing: 'border-box',
                boxShadow: active ? '0 0 0 1px rgba(88,166,255,0.12)' : undefined,
              }}
            >
              {/* Agent avatar */}
              <div style={{ paddingTop: '2px' }}>
                <Avatar
                  name={agent?.name ?? run.agentId}
                  avatarUrl={undefined}
                  size={32}
                />
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '4px' }}>
                  <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text)' }}>
                    {agent?.name ?? run.agentId}
                  </span>
                  <RunStatusBadge status={run.status} />
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                  {runSummary(run.status)}
                </div>
                {run.workspacePath && (
                  <div
                    style={{
                      marginTop: '5px',
                      fontSize: '11px',
                      color: 'var(--text-muted)',
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={run.workspacePath}
                  >
                    {run.workspacePath}
                  </div>
                )}
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, auto)',
                  alignContent: 'center',
                  gap: '6px 12px',
                  color: 'var(--text-muted)',
                  fontSize: '11px',
                }}
              >
                <span style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>Elapsed</span>
                <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {duration(run.startedAt, run.completedAt)}
                </span>
                <span style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>Cost</span>
                <span style={{ textAlign: 'right' }}>
                  <CostDisplay costUsd={run.costUsd} costTokens={run.costTokens} />
                </span>
              </div>

              {canRetrigger(run.status) && (
                <button
                  aria-label={`Retrigger run ${run.id}`}
                  onClick={(event) => {
                    event.stopPropagation()
                    setRetriggerError(null)
                    retriggerRun.mutate(
                      { runId: run.id, issueId },
                      {
                        onSuccess: (newRun) => {
                          setExpandedRunId(newRun.id)
                          setHasAutoExpanded(true)
                        },
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
              <span style={{ color: 'var(--text-muted)', marginLeft: '2px', display: 'inline-flex', alignItems: 'center' }}>
                {isExpanded ? <ChevronDown20Regular /> : <ChevronRight20Regular />}
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
