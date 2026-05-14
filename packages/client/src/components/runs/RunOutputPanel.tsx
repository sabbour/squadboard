import { useEffect, useRef } from 'react'
import { type IssueRun, useRunStream, useCancelRun } from '../../api/runs.ts'
import { type Agent } from '../../api/agents.ts'
import RunStatusBadge from './RunStatusBadge.tsx'
import CostDisplay from './CostDisplay.tsx'

interface RunOutputPanelProps {
  projectId: string
  run: IssueRun
  agent?: Agent
}

export default function RunOutputPanel({ projectId, run, agent }: RunOutputPanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const isActive = run.status === 'running' || run.status === 'pending'
  const lines = useRunStream(projectId, run.id, isActive)
  const cancelRun = useCancelRun(projectId)

  // Combine SSE lines with stored output for completed runs
  const displayLines = isActive
    ? lines
    : (run.output ?? '').split('\n').filter(Boolean)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [displayLines.length])

  function handleCancel() {
    void cancelRun.mutate({ runId: run.id, issueId: run.issueId })
  }

  return (
    <div
      style={{
        background: '#0d1117',
        border: '1px solid #30363d',
        borderRadius: '6px',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        fontSize: '12px',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          borderBottom: '1px solid #21262d',
          background: '#161b22',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '12px', fontWeight: 600, color: '#e6edf3', fontFamily: 'monospace' }}>
            {agent ? `▶ ${agent.name}` : '▶ Run'}
          </span>
          {run.workspacePath && (
            <span style={{ fontSize: '11px', color: '#8b949e', fontFamily: 'monospace' }}>
              {run.workspacePath}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <RunStatusBadge status={run.status} />
          {isActive && (
            <button
              onClick={handleCancel}
              disabled={cancelRun.isPending}
              style={{
                background: 'rgba(248,81,73,0.12)',
                border: '1px solid rgba(248,81,73,0.4)',
                color: '#f85149',
                borderRadius: '4px',
                padding: '2px 8px',
                fontSize: '11px',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      {/* Output area */}
      <div
        style={{
          flex: 1,
          minHeight: '120px',
          maxHeight: '320px',
          overflowY: 'auto',
          padding: '10px 12px',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        }}
      >
        {displayLines.length === 0 && isActive && (
          <span style={{ color: '#484f58' }}>Waiting for output…</span>
        )}
        {displayLines.map((line, i) => (
          <div key={i} style={{ color: '#39d353', lineHeight: '1.5', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {line}
          </div>
        ))}
        {run.errorMessage && (
          <div style={{ color: '#f85149', marginTop: '8px', whiteSpace: 'pre-wrap' }}>
            ✗ {run.errorMessage}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Footer */}
      {!isActive && (
        <div
          style={{
            padding: '6px 12px',
            borderTop: '1px solid #21262d',
            background: '#161b22',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span style={{ fontSize: '12px', color: run.status === 'completed' ? '#3fb950' : '#f85149' }}>
            {run.status === 'completed' ? '✓ Completed' : run.status === 'cancelled' ? '⊘ Cancelled' : '✗ Failed'}
          </span>
          <CostDisplay costUsd={run.costUsd} costTokens={run.costTokens} />
        </div>
      )}
    </div>
  )
}
