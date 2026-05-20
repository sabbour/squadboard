import { useState } from 'react'
import { useCastIssue, type CastIssueResult } from '../../api/roles.ts'
import { RoutingTierBadge } from './RoutingTierBadge.tsx'
import { Sparkle20Regular, Person20Regular, Checkmark20Regular, Dismiss20Regular } from '@fluentui/react-icons'

interface CastPanelProps {
  projectId: string
  onUseAgent?: (agentId: string) => void
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

const labelStyle: React.CSSProperties = {
  fontSize: '11px',
  color: 'var(--text-muted)',
  display: 'block',
  marginBottom: '4px',
}

function ScoreBar({ score }: { score: number | null }) {
  if (score == null || !Number.isFinite(score)) return null
  const pct = Math.max(0, Math.min(1, score)) * 100
  const color = pct >= 75 ? '#3fb950' : pct >= 50 ? '#d29922' : '#f85149'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <div
        style={{
          flex: 1,
          height: '6px',
          background: 'rgba(139,148,158,0.2)',
          borderRadius: '3px',
          overflow: 'hidden',
        }}
      >
        <div style={{ width: `${pct}%`, height: '100%', background: color, transition: 'width 0.3s' }} />
      </div>
      <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', minWidth: '40px', textAlign: 'right' }}>
        {pct.toFixed(0)}%
      </span>
    </div>
  )
}

function tierToBadge(tier: number | null): string | null {
  if (tier === 1) return 'T1'
  if (tier === 2) return 'T2'
  if (tier === 3) return 'T3'
  return null
}

export function CastPanel({ projectId, onUseAgent }: CastPanelProps) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [labels, setLabels] = useState('')
  const [result, setResult] = useState<CastIssueResult | null>(null)

  const cast = useCastIssue(projectId)

  async function handleCast() {
    if (!title.trim()) return
    setResult(null)
    const labelList = labels.split(',').map((l) => l.trim()).filter(Boolean)
    try {
      const data = await cast.mutateAsync({
        title: title.trim(),
        body: body.trim() || undefined,
        labels: labelList,
      })
      setResult(data)
    } catch {
      // error surfaced via cast.error
    }
  }

  const tierBadge = result ? tierToBadge(result.tier) : null

  return (
    <div
      style={{
        margin: '0',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        overflow: 'hidden',
      }}
    >
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
        <Sparkle20Regular style={{ color: '#bc8cff' }} />
        Cast an Issue
        <span style={{ fontSize: '11px', fontWeight: 400, color: 'var(--text-muted)', marginLeft: '4px' }}>
          — preview which agent the router would pick; does not change the Routing Log
        </span>
      </button>

      {open && (
        <div style={{ padding: '16px', background: 'var(--surface)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div>
            <label style={labelStyle}>Issue title</label>
            <input
              style={inputStyle}
              placeholder="e.g. Fix the WebSocket reconnect loop"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleCast()}
            />
          </div>

          <div>
            <label style={labelStyle}>Description (optional, helps Tier 3)</label>
            <textarea
              style={{ ...inputStyle, fontFamily: 'inherit', resize: 'vertical', minHeight: '60px' }}
              placeholder="More context about what needs doing…"
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>

          <div>
            <label style={labelStyle}>Labels (comma-separated)</label>
            <input
              style={inputStyle}
              placeholder="e.g. bug, area:routing"
              value={labels}
              onChange={(e) => setLabels(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCast()}
            />
          </div>

          <button
            onClick={handleCast}
            disabled={cast.isPending || !title.trim()}
            style={{
              alignSelf: 'flex-start',
              background: cast.isPending ? 'rgba(0,0,0,0.05)' : '#bc8cff',
              border: '1px solid #d2a8ff',
              borderRadius: 'var(--radius)',
              color: cast.isPending ? 'var(--text-muted)' : '#0d1117',
              padding: '6px 14px',
              fontSize: '13px',
              fontWeight: 600,
              cursor: cast.isPending || !title.trim() ? 'not-allowed' : 'pointer',
              opacity: !title.trim() ? 0.5 : 1,
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <Sparkle20Regular />
            {cast.isPending ? 'Casting…' : 'Cast issue'}
          </button>

          {cast.isError && (
            <div
              style={{
                fontSize: '12px',
                color: 'var(--danger)',
                padding: '8px',
                background: 'rgba(248,81,73,0.1)',
                borderRadius: 'var(--radius)',
                border: '1px solid rgba(248,81,73,0.3)',
              }}
            >
              {cast.error?.message ?? 'Failed to cast issue.'}
            </div>
          )}

          {result && (
            <div
              style={{
                padding: '12px 14px',
                borderRadius: 'var(--radius)',
                background: result.agentName ? 'rgba(46,160,67,0.08)' : 'rgba(139,148,158,0.08)',
                border: `1px solid ${result.agentName ? 'rgba(46,160,67,0.3)' : 'var(--border)'}`,
                fontSize: '13px',
                color: 'var(--text)',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <span style={{ color: result.agentName ? '#3fb950' : 'var(--text-muted)', fontWeight: 600 }}>
                  {result.agentName ? <><Checkmark20Regular style={{ verticalAlign: 'middle', marginRight: '4px' }} />Suggested:</> : <><Dismiss20Regular style={{ verticalAlign: 'middle', marginRight: '4px' }} />No suggestion</>}
                </span>
                {result.agentName && (
                  <>
                    <span style={{ fontWeight: 600, fontSize: '14px' }}>{result.agentName}</span>
                    {tierBadge && <RoutingTierBadge tier={tierBadge} showLabel />}
                  </>
                )}
              </div>

              {result.score != null && (
                <div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>Confidence</div>
                  <ScoreBar score={result.score} />
                </div>
              )}

              {result.matchedRule && (
                <div style={{ fontSize: '12px' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Matched rule: </span>
                  <code style={{ background: 'rgba(139,148,158,0.15)', padding: '1px 5px', borderRadius: '3px', fontSize: '11px' }}>
                    {result.matchedRule}
                  </code>
                </div>
              )}

              {result.reasoning && (
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                  <span style={{ color: 'var(--text)', fontWeight: 500 }}>Reasoning: </span>
                  {result.reasoning}
                </div>
              )}

              {result.agentId && onUseAgent && (
                <button
                  onClick={() => onUseAgent(result.agentId!)}
                  style={{
                    alignSelf: 'flex-start',
                    background: '#238636',
                    border: '1px solid #2ea043',
                    borderRadius: 'var(--radius)',
                    color: 'white',
                    padding: '5px 12px',
                    fontSize: '12px',
                    fontWeight: 500,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  <Person20Regular />
                  Open agent details
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
