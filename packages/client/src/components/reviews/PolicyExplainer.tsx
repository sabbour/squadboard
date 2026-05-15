import { useState, useRef, useEffect } from 'react'
import {
  type PolicySources,
  type PolicyFieldSource,
  type ResolvedReviewPolicy,
} from '../../api/review-policies.ts'

const FIELD_LABELS: Record<keyof ResolvedReviewPolicy, string> = {
  approvers: 'Approvers',
  approver_objects: 'Typed approvers',
  request_changes_policy: 'Block policy',
  quorum: 'Quorum',
  exclude_author: 'Exclude author',
  timeout: 'Timeout',
  timeout_action: 'On timeout',
  fallback_reviewer: 'Fallback reviewer',
}

const SOURCE_LABELS: Record<PolicyFieldSource, { label: string; color: string }> = {
  step: { label: 'workflow step', color: '#a371f7' },
  board: { label: 'board default', color: '#388bfd' },
  project: { label: 'project default', color: '#3fb950' },
  system_default: { label: 'system default', color: '#8b949e' },
}

function fmtValue(key: keyof ResolvedReviewPolicy, value: unknown): string {
  if (value == null) return '—'
  if (key === 'quorum' && typeof value === 'object') {
    const q = value as { n: number; of: number }
    return `${q.n}/${q.of}`
  }
  if (Array.isArray(value)) return value.length === 0 ? '—' : value.join(', ')
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  return String(value)
}

export interface PolicyExplainerProps {
  policy: ResolvedReviewPolicy
  sources: PolicySources
  warnings?: string[]
}

export function PolicyExplainer({ policy, sources, warnings }: PolicyExplainerProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          background: 'none',
          border: '1px solid var(--border)',
          color: 'var(--text-muted)',
          fontSize: '11px',
          cursor: 'pointer',
          padding: '2px 8px',
          borderRadius: '999px',
          lineHeight: 1.6,
        }}
      >
        Why this policy?
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            zIndex: 50,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: '8px',
            padding: '12px',
            minWidth: '320px',
            maxWidth: '420px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
          }}
        >
          <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)', marginBottom: '8px' }}>
            Resolution chain
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '4px 12px', fontSize: '11px' }}>
            {(Object.keys(FIELD_LABELS) as (keyof ResolvedReviewPolicy)[])
              .filter((k) => k !== 'approver_objects')
              .map((key) => {
                const src = sources[key]
                const cfg = SOURCE_LABELS[src]
                return (
                  <div key={key} style={{ display: 'contents' }}>
                    <span style={{ color: 'var(--text-muted)' }}>{FIELD_LABELS[key]}</span>
                    <code style={{ color: 'var(--text)', fontFamily: 'monospace', fontSize: '10px' }}>
                      {fmtValue(key, policy[key])}
                    </code>
                    <span style={{ color: cfg.color, fontSize: '10px' }}>{cfg.label}</span>
                  </div>
                )
              })}
          </div>
          {warnings && warnings.length > 0 && (
            <div
              style={{
                marginTop: '10px',
                padding: '8px 10px',
                background: 'rgba(210,153,34,0.1)',
                borderLeft: '3px solid #d29922',
                borderRadius: '4px',
                fontSize: '11px',
                color: '#d29922',
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: '2px' }}>Warnings</div>
              <ul style={{ margin: 0, paddingLeft: '14px' }}>
                {warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
