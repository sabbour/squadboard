import { useEffect, useRef, useState } from 'react'
import { type IssueRun, useCancelRun } from '../../api/runs.ts'
import { type Agent } from '../../api/agents.ts'
import RunStatusBadge from './RunStatusBadge.tsx'
import CostDisplay from './CostDisplay.tsx'
import { RoutingTierBadge } from '../routing/RoutingTierBadge.tsx'
import { wsClient } from '../../realtime/ws-client.ts'
import { Search20Regular, Play20Regular } from '@fluentui/react-icons'

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

/** Stream run output lines via WS if connected, falling back to SSE EventSource. */
function useRunStreamWS(projectId: string, runId: string, enabled: boolean): string[] {
  const [lines, setLines] = useState<string[]>([])

  useEffect(() => {
    if (!enabled || !runId) return
    setLines([])

    // Primary: WebSocket
    if (wsClient.state === 'connected') {
      wsClient.send({ type: 'subscribe_run', runId })

      const handler = (payload: { runId: string; line: string }) => {
        if (payload.runId === runId) {
          setLines((prev) => [...prev, payload.line])
        }
      }
      wsClient.on('run.output', handler)

      return () => {
        wsClient.off('run.output', handler)
        wsClient.send({ type: 'unsubscribe_run', runId })
      }
    }

    // Fallback: SSE EventSource (original behaviour)
    const es = new EventSource(`${BASE}/api/projects/${projectId}/runs/${runId}/stream`)
    es.onmessage = (e) => setLines((prev) => [...prev, e.data as string])
    es.onerror = () => es.close()
    return () => es.close()
  }, [projectId, runId, enabled])

  return lines
}

interface RunOutputPanelProps {
  projectId: string
  run: IssueRun
  agent?: Agent
}

export default function RunOutputPanel({ projectId, run, agent }: RunOutputPanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const isActive = run.status === 'running' || run.status === 'pending'
  const lines = useRunStreamWS(projectId, run.id, isActive)
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
          {run.kind === 'peer_review'
              ? <><Search20Regular /> Review by {agent?.name ?? 'agent'}</>
              : agent ? <><Play20Regular /> {agent.name}</> : <><Play20Regular /> Run</>}
          </span>
          {run.workspacePath && (
            <span style={{ fontSize: '11px', color: '#8b949e', fontFamily: 'monospace' }}>
              {run.workspacePath}
            </span>
          )}
          {run.routingTier && <RoutingTierBadge tier={run.routingTier} />}
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
