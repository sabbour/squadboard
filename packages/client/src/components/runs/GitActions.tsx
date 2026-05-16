/**
 * GitActions — Stream G Phase 1
 *
 * Push branch + Create PR buttons for the Run output panel footer.
 * Only renders for worktree runs (workspaceStrategy === 'worktree').
 *
 * WS fast path:
 *   - git.push.complete  → updates push state without page refresh
 *   - git.pr.created     → updates PR link without page refresh
 */
import { useEffect, useState } from 'react'
import { type IssueRun } from '../../api/runs.ts'
import { usePushBranch, useCreatePr, type PushResult, type PrResult } from '../../api/git.ts'
import { wsClient } from '../../realtime/ws-client.ts'

interface GitActionsProps {
  projectId: string
  run: IssueRun
}

export default function GitActions({ projectId, run }: GitActionsProps) {
  const [pushState, setPushState] = useState<
    | { phase: 'idle' }
    | { phase: 'pushing' }
    | { phase: 'done'; result: PushResult }
    | { phase: 'error'; message: string }
  >({ phase: 'idle' })

  const [prState, setPrState] = useState<
    | { phase: 'idle' }
    | { phase: 'modal' }
    | { phase: 'creating' }
    | { phase: 'done'; result: PrResult }
    | { phase: 'error'; message: string }
  >({ phase: 'idle' })

  const [prTitle, setPrTitle] = useState('')
  const [prBody, setPrBody] = useState(DEFAULT_PR_BODY)

  const pushMutation = usePushBranch(projectId)
  const prMutation = useCreatePr(projectId)

  // WS fast path — git events update state without waiting for UI re-render from API
  useEffect(() => {
    const pushHandler = (payload: { runId: string; branch: string; branchUrl: string; pushOutput: string }) => {
      if (payload.runId === run.id) {
        setPushState({ phase: 'done', result: payload })
      }
    }
    const prHandler = (payload: { runId: string; prUrl: string; prNumber?: number }) => {
      if (payload.runId === run.id) {
        setPrState({ phase: 'done', result: { prUrl: payload.prUrl, prNumber: payload.prNumber } })
      }
    }

    wsClient.on('git.push.complete', pushHandler)
    wsClient.on('git.pr.created', prHandler)
    return () => {
      wsClient.off('git.push.complete', pushHandler)
      wsClient.off('git.pr.created', prHandler)
    }
  }, [run.id])

  if (run.workspaceStrategy !== 'worktree') return null

  function handlePush() {
    setPushState({ phase: 'pushing' })
    pushMutation.mutate(
      { runId: run.id },
      {
        onSuccess: (result) => setPushState({ phase: 'done', result }),
        onError: (err) => setPushState({ phase: 'error', message: err.message }),
      },
    )
  }

  function openPrModal() {
    setPrBody(DEFAULT_PR_BODY)
    setPrTitle(run.id ? `Run ${run.id.slice(0, 8)}` : 'Squad run')
    setPrState({ phase: 'modal' })
  }

  function handleCreatePr() {
    setPrState({ phase: 'creating' })
    prMutation.mutate(
      { runId: run.id, title: prTitle.trim() || undefined, body: prBody.trim() || undefined },
      {
        onSuccess: (result) => setPrState({ phase: 'done', result }),
        onError: (err) => setPrState({ phase: 'error', message: err.message }),
      },
    )
  }

  const pushed = pushState.phase === 'done'

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
      {/* ── Push branch button ── */}
      {pushState.phase !== 'done' && (
        <button
          onClick={handlePush}
          disabled={pushState.phase === 'pushing'}
          style={btnStyle(pushState.phase === 'pushing')}
        >
          {pushState.phase === 'pushing' ? 'Pushing…' : '↑ Push branch'}
        </button>
      )}

      {pushState.phase === 'done' && (
        <span style={{ fontSize: '11px', color: '#3fb950', display: 'flex', alignItems: 'center', gap: '4px' }}>
          ✓ Pushed
          {pushState.result.branchUrl && (
            <>
              {' '}·{' '}
              <a href={pushState.result.branchUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#58a6ff', textDecoration: 'none' }}>
                {pushState.result.branch}
              </a>
            </>
          )}
        </span>
      )}

      {pushState.phase === 'error' && (
        <span style={{ fontSize: '11px', color: '#f85149' }} title={pushState.message}>
          ✗ Push failed — {pushState.message.slice(0, 60)}
        </span>
      )}

      {/* ── Create PR button (visible once pushed) ── */}
      {pushed && prState.phase === 'idle' && (
        <button onClick={openPrModal} style={btnStyle(false)}>
          ⎇ Create PR
        </button>
      )}

      {prState.phase === 'done' && (
        <span style={{ fontSize: '11px', color: '#3fb950', display: 'flex', alignItems: 'center', gap: '4px' }}>
          ✓ PR{' '}
          <a href={prState.result.prUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#58a6ff', textDecoration: 'none' }}>
            #{prState.result.prNumber ?? '—'}
          </a>
        </span>
      )}

      {prState.phase === 'error' && (
        <span style={{ fontSize: '11px', color: '#f85149' }} title={prState.message}>
          ✗ PR failed — {prState.message.slice(0, 60)}
        </span>
      )}

      {/* ── PR modal ── */}
      {prState.phase === 'modal' && (
        <div style={modalOverlayStyle} onClick={() => setPrState({ phase: 'idle' })}>
          <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 12px', fontSize: '14px', color: '#e6edf3' }}>Create Pull Request</h3>

            <label style={labelStyle}>Title</label>
            <input
              value={prTitle}
              onChange={(e) => setPrTitle(e.target.value)}
              style={inputStyle}
              placeholder="PR title…"
            />

            <label style={{ ...labelStyle, marginTop: '10px' }}>Body</label>
            <textarea
              value={prBody}
              onChange={(e) => setPrBody(e.target.value)}
              style={{ ...inputStyle, height: '220px', resize: 'vertical', fontFamily: 'ui-monospace, monospace', fontSize: '11px' }}
            />

            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '12px' }}>
              <button onClick={() => setPrState({ phase: 'idle' })} style={cancelBtnStyle}>
                Cancel
              </button>
              <button
                onClick={handleCreatePr}
                disabled={!prTitle.trim()}
                style={btnStyle(!prTitle.trim())}
              >
                Create PR
              </button>
            </div>
          </div>
        </div>
      )}

      {prState.phase === 'creating' && (
        <span style={{ fontSize: '11px', color: '#8b949e' }}>Creating PR…</span>
      )}
    </div>
  )
}

// ── Default PR body template ─────────────────────────────────────────────────

const DEFAULT_PR_BODY = `## Summary
<!-- What this PR does in one paragraph -->

## Squad Context
- **Agent:** <!-- cast name -->
- **Ceremony / Run:** <!-- ceremony slug + run id, or "ad-hoc" -->
- **Issue:** <!-- Closes #N (if applicable) -->

## Test Plan
<!-- How a reviewer can verify -->

## Risk
- [ ] No risk / cosmetic
- [ ] Low — UI-only / non-breaking
- [ ] Medium — touches backend / migrations
- [ ] High — touches engine loops / multi-pod liveness

## Notes for the next agent
<!-- Handoff context if a follow-up ceremony picks up -->
`

// ── Styles ───────────────────────────────────────────────────────────────────

function btnStyle(disabled: boolean): React.CSSProperties {
  return {
    background: disabled ? '#21262d' : 'rgba(56,139,253,0.15)',
    border: `1px solid ${disabled ? '#30363d' : 'rgba(56,139,253,0.4)'}`,
    color: disabled ? '#484f58' : '#58a6ff',
    borderRadius: '4px',
    padding: '2px 10px',
    fontSize: '11px',
    cursor: disabled ? 'not-allowed' : 'pointer',
    whiteSpace: 'nowrap' as const,
  }
}

const cancelBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid #30363d',
  color: '#8b949e',
  borderRadius: '4px',
  padding: '4px 12px',
  fontSize: '12px',
  cursor: 'pointer',
}

const modalOverlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.6)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
}

const modalStyle: React.CSSProperties = {
  background: '#161b22',
  border: '1px solid #30363d',
  borderRadius: '8px',
  padding: '20px',
  width: '560px',
  maxWidth: '90vw',
  display: 'flex',
  flexDirection: 'column',
}

const labelStyle: React.CSSProperties = {
  fontSize: '11px',
  color: '#8b949e',
  marginBottom: '4px',
  display: 'block',
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: '#0d1117',
  border: '1px solid #30363d',
  borderRadius: '4px',
  color: '#e6edf3',
  padding: '6px 8px',
  fontSize: '12px',
  boxSizing: 'border-box' as const,
}
