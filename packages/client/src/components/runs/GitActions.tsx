/**
 * GitActions — Stream G Phase 2A
 *
 * Push branch + Create PR + Comment on issue + Merge PR buttons for the Run output panel footer.
 * Only renders for worktree runs (workspaceStrategy === 'worktree').
 *
 * WS fast path:
 *   - git.push.complete   → updates push state without page refresh
 *   - git.pr.created      → updates PR link without page refresh
 *   - git.comment.posted  → shows comment URL
 *   - git.pr.merged       → updates merged state
 */
import { useEffect, useState } from 'react'
import { type IssueRun } from '../../api/runs.ts'
import {
  usePushBranch, useCreatePr, useCommentOnIssue, useMergePr,
  type PushResult, type PrResult, type CommentResult, type MergeResult, type MergeMethod,
} from '../../api/git.ts'
import { wsClient } from '../../realtime/ws-client.ts'

interface GitActionsProps {
  projectId: string
  run: IssueRun
  /** Linked GitHub issue number (from the issue record), if any. */
  linkedIssueNumber?: number
  /** Last run summary to pre-fill the comment body. */
  lastSummary?: string
}

export default function GitActions({ projectId, run, linkedIssueNumber, lastSummary }: GitActionsProps) {
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

  const [commentState, setCommentState] = useState<
    | { phase: 'idle' }
    | { phase: 'modal' }
    | { phase: 'posting' }
    | { phase: 'done'; result: CommentResult }
    | { phase: 'error'; message: string }
  >({ phase: 'idle' })

  const [mergeState, setMergeState] = useState<
    | { phase: 'idle' }
    | { phase: 'merging'; method: MergeMethod }
    | { phase: 'done'; result: MergeResult }
    | { phase: 'error'; message: string }
  >({ phase: 'idle' })

  const [prTitle, setPrTitle] = useState('')
  const [prBody, setPrBody] = useState(DEFAULT_PR_BODY)
  const [commentBody, setCommentBody] = useState('')
  const [commentIssueNumber, setCommentIssueNumber] = useState<number>(linkedIssueNumber ?? 0)
  const [mergeMethodMenuOpen, setMergeMethodMenuOpen] = useState(false)

  const pushMutation = usePushBranch(projectId)
  const prMutation = useCreatePr(projectId)
  const commentMutation = useCommentOnIssue(projectId)
  const mergeMutation = useMergePr(projectId)

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
    const commentHandler = (payload: { runId: string; commentUrl: string; issueNumber: number }) => {
      if (payload.runId === run.id) {
        setCommentState({ phase: 'done', result: { commentUrl: payload.commentUrl, issueNumber: payload.issueNumber } })
      }
    }
    const mergeHandler = (payload: { runId: string; prUrl: string; sha: string; method: MergeMethod }) => {
      if (payload.runId === run.id) {
        setMergeState({ phase: 'done', result: { prUrl: payload.prUrl, sha: payload.sha, method: payload.method } })
      }
    }

    wsClient.on('git.push.complete', pushHandler)
    wsClient.on('git.pr.created', prHandler)
    wsClient.on('git.comment.posted', commentHandler)
    wsClient.on('git.pr.merged', mergeHandler)
    return () => {
      wsClient.off('git.push.complete', pushHandler)
      wsClient.off('git.pr.created', prHandler)
      wsClient.off('git.comment.posted', commentHandler)
      wsClient.off('git.pr.merged', mergeHandler)
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

  function openCommentModal() {
    setCommentBody(lastSummary ?? '')
    setCommentIssueNumber(linkedIssueNumber ?? 0)
    setCommentState({ phase: 'modal' })
  }

  function handlePostComment() {
    if (!commentIssueNumber || !commentBody.trim()) return
    setCommentState({ phase: 'posting' })
    commentMutation.mutate(
      { runId: run.id, issueNumber: commentIssueNumber, body: commentBody.trim() },
      {
        onSuccess: (result) => setCommentState({ phase: 'done', result }),
        onError: (err) => setCommentState({ phase: 'error', message: err.message }),
      },
    )
  }

  function handleMergePr(method: MergeMethod) {
    setMergeMethodMenuOpen(false)
    setMergeState({ phase: 'merging', method })
    mergeMutation.mutate(
      { runId: run.id, method },
      {
        onSuccess: (result) => setMergeState({ phase: 'done', result }),
        onError: (err) => setMergeState({ phase: 'error', message: err.message }),
      },
    )
  }

  const pushed = pushState.phase === 'done'
  const prCreated = prState.phase === 'done'

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

      {/* ── Merge PR button (visible once PR created, CI checked, not yet merged) ── */}
      {prCreated && mergeState.phase === 'idle' && (
        <div style={{ position: 'relative' }}>
          <div style={{ display: 'flex', border: '1px solid rgba(56,139,253,0.4)', borderRadius: '4px', overflow: 'hidden' }}>
            <button
              onClick={() => handleMergePr('squash')}
              style={{ ...mergeMainBtnStyle, borderRight: '1px solid rgba(56,139,253,0.3)' }}
            >
              ⤴ Merge PR
            </button>
            <button
              onClick={() => setMergeMethodMenuOpen((v) => !v)}
              style={mergeDropBtnStyle}
              title="Choose merge method"
            >
              ▾
            </button>
          </div>
          {mergeMethodMenuOpen && (
            <div style={mergeMenuStyle}>
              {(['squash', 'merge', 'rebase'] as MergeMethod[]).map((m) => (
                <button key={m} onClick={() => handleMergePr(m)} style={mergeMenuItemStyle}>
                  {m === 'squash' ? 'Squash and merge' : m === 'merge' ? 'Create a merge commit' : 'Rebase and merge'}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {mergeState.phase === 'merging' && (
        <span style={{ fontSize: '11px', color: '#8b949e' }}>Merging ({mergeState.method})…</span>
      )}

      {mergeState.phase === 'done' && (
        <span style={{ fontSize: '11px', color: '#3fb950', display: 'flex', alignItems: 'center', gap: '4px' }}>
          ✓ Merged{' '}
          <a href={mergeState.result.prUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#58a6ff', textDecoration: 'none' }}>
            ({mergeState.result.method})
          </a>
        </span>
      )}

      {mergeState.phase === 'error' && (
        <span style={{ fontSize: '11px', color: '#f85149' }} title={mergeState.message}>
          ✗ Merge failed — {mergeState.message.slice(0, 80)}
        </span>
      )}

      {/* ── Comment on issue button (visible when a GH issue is linked) ── */}
      {linkedIssueNumber && mergeState.phase !== 'done' && commentState.phase === 'idle' && (
        <button onClick={openCommentModal} style={btnStyle(false)}>
          💬 Comment on issue
        </button>
      )}

      {commentState.phase === 'done' && (
        <span style={{ fontSize: '11px', color: '#3fb950', display: 'flex', alignItems: 'center', gap: '4px' }}>
          ✓ Commented{' '}
          {commentState.result.commentUrl && (
            <a href={commentState.result.commentUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#58a6ff', textDecoration: 'none' }}>
              #{commentState.result.issueNumber}
            </a>
          )}
        </span>
      )}

      {commentState.phase === 'error' && (
        <span style={{ fontSize: '11px', color: '#f85149' }} title={commentState.message}>
          ✗ Comment failed — {commentState.message.slice(0, 60)}
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

      {/* ── Comment modal ── */}
      {commentState.phase === 'modal' && (
        <div style={modalOverlayStyle} onClick={() => setCommentState({ phase: 'idle' })}>
          <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 12px', fontSize: '14px', color: '#e6edf3' }}>Comment on GitHub Issue</h3>

            <label style={labelStyle}>Issue number</label>
            <input
              type="number"
              value={commentIssueNumber || ''}
              onChange={(e) => setCommentIssueNumber(parseInt(e.target.value, 10) || 0)}
              style={{ ...inputStyle, width: '120px' }}
              placeholder="42"
              min={1}
            />

            <label style={{ ...labelStyle, marginTop: '10px' }}>Comment body</label>
            <textarea
              value={commentBody}
              onChange={(e) => setCommentBody(e.target.value)}
              style={{ ...inputStyle, height: '180px', resize: 'vertical', fontFamily: 'ui-monospace, monospace', fontSize: '11px' }}
              placeholder="Write your comment…"
            />

            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '12px' }}>
              <button onClick={() => setCommentState({ phase: 'idle' })} style={cancelBtnStyle}>
                Cancel
              </button>
              <button
                onClick={handlePostComment}
                disabled={!commentBody.trim() || !commentIssueNumber}
                style={btnStyle(!commentBody.trim() || !commentIssueNumber)}
              >
                Post comment
              </button>
            </div>
          </div>
        </div>
      )}

      {commentState.phase === 'posting' && (
        <span style={{ fontSize: '11px', color: '#8b949e' }}>Posting comment…</span>
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

const mergeMainBtnStyle: React.CSSProperties = {
  background: 'rgba(46,160,67,0.15)',
  border: 'none',
  color: '#3fb950',
  padding: '2px 10px',
  fontSize: '11px',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}

const mergeDropBtnStyle: React.CSSProperties = {
  background: 'rgba(46,160,67,0.15)',
  border: 'none',
  color: '#3fb950',
  padding: '2px 6px',
  fontSize: '11px',
  cursor: 'pointer',
}

const mergeMenuStyle: React.CSSProperties = {
  position: 'absolute',
  top: '100%',
  right: 0,
  marginTop: '4px',
  background: '#161b22',
  border: '1px solid #30363d',
  borderRadius: '6px',
  overflow: 'hidden',
  zIndex: 100,
  minWidth: '180px',
  boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
}

const mergeMenuItemStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  background: 'transparent',
  border: 'none',
  color: '#e6edf3',
  padding: '8px 12px',
  fontSize: '12px',
  cursor: 'pointer',
  textAlign: 'left',
  whiteSpace: 'nowrap',
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
