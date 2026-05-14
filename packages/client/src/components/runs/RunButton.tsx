import { useState, useRef, useEffect } from 'react'
import { useAgents } from '../../api/agents.ts'
import { useStartRun, useCancelRun, useIssueRuns, type IssueRun } from '../../api/runs.ts'

interface RunButtonProps {
  projectId: string
  issueId: string
  onRunStarted?: (run: IssueRun) => void
}

export default function RunButton({ projectId, issueId, onRunStarted }: RunButtonProps) {
  const [open, setOpen] = useState(false)
  const [selectedAgentId, setSelectedAgentId] = useState<string>('')
  const [doneFlash, setDoneFlash] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const { data: agents } = useAgents(projectId)
  const { data: runs } = useIssueRuns(projectId, issueId)
  const startRun = useStartRun(projectId)
  const cancelRun = useCancelRun(projectId)

  const activeRun = runs?.find((r) => r.status === 'running' || r.status === 'pending')
  const lastRun = runs?.[0]

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // Flash "Done" briefly when run completes
  useEffect(() => {
    if (lastRun?.status === 'completed') {
      setDoneFlash(true)
      const t = setTimeout(() => setDoneFlash(false), 2500)
      return () => clearTimeout(t)
    }
  }, [lastRun?.status])

  function handleRun() {
    const agentId = selectedAgentId || agents?.[0]?.id
    if (!agentId) return
    startRun.mutate(
      { issueId, agentId },
      {
        onSuccess: (run) => {
          setOpen(false)
          onRunStarted?.(run)
        },
      },
    )
  }

  function handleCancel() {
    if (!activeRun) return
    void cancelRun.mutate({ runId: activeRun.id, issueId })
  }

  // Running state
  if (activeRun) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
        <span
          style={{
            fontSize: '11px',
            color: '#58a6ff',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
          }}
        >
          <span
            style={{
              display: 'inline-block',
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: '#58a6ff',
              animation: 'runPulse 1.4s ease-in-out infinite',
            }}
          />
          Running
        </span>
        <button
          onClick={handleCancel}
          style={{
            background: 'none',
            border: '1px solid var(--border)',
            color: 'var(--text-muted)',
            borderRadius: '4px',
            padding: '1px 6px',
            fontSize: '11px',
            cursor: 'pointer',
          }}
        >
          Cancel
        </button>
        <style>{`@keyframes runPulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.4;transform:scale(.7)} }`}</style>
      </div>
    )
  }

  // Done flash state
  if (doneFlash) {
    return (
      <span style={{ fontSize: '11px', color: '#3fb950', fontWeight: 500 }}>✓ Done</span>
    )
  }

  // Normal state: dropdown + Run button
  const activeAgents = agents?.filter((a) => a.status === 'active') ?? []

  return (
    <div ref={dropdownRef} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: '4px' }}>
      {activeAgents.length > 1 && (
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setOpen((v) => !v)}
            style={{
              background: 'var(--bg)',
              border: '1px solid var(--border)',
              color: 'var(--text-muted)',
              borderRadius: '4px',
              padding: '2px 6px',
              fontSize: '11px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '3px',
            }}
          >
            {selectedAgentId
              ? (activeAgents.find((a) => a.id === selectedAgentId)?.name ?? 'Agent')
              : (activeAgents[0]?.name ?? 'Agent')}
            <span style={{ fontSize: '9px' }}>▾</span>
          </button>

          {open && (
            <div
              style={{
                position: 'absolute',
                bottom: '100%',
                left: 0,
                marginBottom: '4px',
                background: 'var(--bg)',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                minWidth: '140px',
                zIndex: 50,
                overflow: 'hidden',
                boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
              }}
            >
              {activeAgents.map((agent) => (
                <button
                  key={agent.id}
                  onClick={() => { setSelectedAgentId(agent.id); setOpen(false) }}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    background: selectedAgentId === agent.id ? '#388bfd22' : 'none',
                    border: 'none',
                    color: 'var(--text)',
                    padding: '7px 12px',
                    fontSize: '12px',
                    cursor: 'pointer',
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = '#388bfd22' }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = selectedAgentId === agent.id ? '#388bfd22' : 'none' }}
                >
                  {agent.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <button
        onClick={handleRun}
        disabled={startRun.isPending || activeAgents.length === 0}
        title={activeAgents.length === 0 ? 'No active agents' : undefined}
        style={{
          background: 'rgba(56,139,253,0.15)',
          border: '1px solid rgba(56,139,253,0.4)',
          color: '#58a6ff',
          borderRadius: '4px',
          padding: '2px 8px',
          fontSize: '11px',
          fontWeight: 500,
          cursor: activeAgents.length === 0 ? 'not-allowed' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          opacity: activeAgents.length === 0 ? 0.5 : 1,
        }}
      >
        ▶ Run
      </button>
    </div>
  )
}
