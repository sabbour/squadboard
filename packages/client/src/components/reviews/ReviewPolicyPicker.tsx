import { useState, useEffect, useMemo } from 'react'
import {
  useReviewPolicyPresets,
  type ReviewPolicyPayload,
  type ReviewPolicyPreset,
  type RequestChangesPolicy,
  type TimeoutAction,
} from '../../api/review-policies.ts'

const REQUEST_CHANGES_OPTIONS: { value: RequestChangesPolicy; label: string }[] = [
  { value: 'first', label: 'first request_changes blocks' },
  { value: 'majority', label: 'majority blocks' },
  { value: 'all', label: 'all must approve' },
]

const TIMEOUT_ACTION_OPTIONS: { value: TimeoutAction; label: string }[] = [
  { value: 'notify', label: 'Notify only' },
  { value: 'auto_approve', label: 'Auto-approve' },
  { value: 'auto_reject', label: 'Auto-reject' },
  { value: 'escalate', label: 'Escalate to fallback reviewer' },
]

export interface ReviewPolicyPickerProps {
  projectId: string
  value: ReviewPolicyPayload | null
  onChange: (next: ReviewPolicyPayload | null) => void
  /** When true, "Use system default" is shown (clears to null). Defaults to true. */
  allowClear?: boolean
}

function payloadEqual(a: ReviewPolicyPayload, b: ReviewPolicyPayload): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

const inputStyle: React.CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: '6px',
  color: 'var(--text)',
  padding: '6px 10px',
  fontSize: '12px',
  outline: 'none',
  fontFamily: 'inherit',
}

const labelStyle: React.CSSProperties = {
  fontSize: '11px',
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  fontWeight: 600,
}

export function ReviewPolicyPicker({ projectId, value, onChange, allowClear = true }: ReviewPolicyPickerProps) {
  const { data: presets, isLoading } = useReviewPolicyPresets(projectId)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [approversText, setApproversText] = useState('')

  useEffect(() => {
    setApproversText((value?.approvers ?? []).join(', '))
  }, [value?.approvers])

  const matchingPresetSlug = useMemo(() => {
    if (!value || !presets) return null
    const all: ReviewPolicyPreset[] = [...presets.system, ...presets.project]
    const hit = all.find((p) => payloadEqual(p.payload, value))
    return hit ? `${hit.scope}:${hit.slug}` : null
  }, [value, presets])

  const update = (patch: Partial<ReviewPolicyPayload>) => {
    onChange({ ...(value ?? {}), ...patch })
  }

  const handlePresetChange = (val: string) => {
    if (val === '__clear__') {
      onChange(null)
      return
    }
    if (val === '__custom__') {
      onChange(value ?? {})
      setShowAdvanced(true)
      return
    }
    if (!presets) return
    const [scope, slug] = val.split(':')
    const all = scope === 'system' ? presets.system : presets.project
    const hit = all.find((p) => p.slug === slug)
    if (hit) onChange(hit.payload)
  }

  if (isLoading || !presets) {
    return <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Loading presets…</div>
  }

  const selectValue = matchingPresetSlug ?? (value == null ? '__clear__' : '__custom__')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <label style={labelStyle}>Preset</label>
        <select value={selectValue} onChange={(e) => handlePresetChange(e.target.value)} style={inputStyle}>
          {allowClear && <option value="__clear__">Use system default</option>}
          <optgroup label="Built-in presets">
            {presets.system.map((p) => (
              <option key={`system:${p.slug}`} value={`system:${p.slug}`}>
                {p.name}
              </option>
            ))}
          </optgroup>
          {presets.project.length > 0 && (
            <optgroup label="Project presets">
              {presets.project.map((p) => (
                <option key={`project:${p.slug}`} value={`project:${p.slug}`}>
                  {p.name}
                </option>
              ))}
            </optgroup>
          )}
          <option value="__custom__">Custom (override below)</option>
        </select>
      </div>

      {value != null && (
        <button
          onClick={() => setShowAdvanced((o) => !o)}
          style={{
            background: 'none',
            border: 'none',
            color: '#388bfd',
            fontSize: '12px',
            cursor: 'pointer',
            padding: 0,
            alignSelf: 'flex-start',
          }}
        >
          {showAdvanced ? '▾ Hide details' : '▸ Customise'}
        </button>
      )}

      {value != null && showAdvanced && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '12px',
            padding: '12px',
            background: 'var(--bg)',
            border: '1px solid var(--border)',
            borderRadius: '6px',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', gridColumn: '1 / -1' }}>
            <label style={labelStyle}>Approvers (role names, comma-separated)</label>
            <input
              type="text"
              value={approversText}
              onChange={(e) => setApproversText(e.target.value)}
              onBlur={() =>
                update({
                  approvers: approversText
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
              placeholder="lead, qa"
              style={inputStyle}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={labelStyle}>Block policy</label>
            <select
              value={value.request_changes_policy ?? 'first'}
              onChange={(e) => update({ request_changes_policy: e.target.value as RequestChangesPolicy })}
              style={inputStyle}
            >
              {REQUEST_CHANGES_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={labelStyle}>Quorum (n of total)</label>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <input
                type="number"
                min={1}
                max={value.quorum?.of ?? 99}
                value={value.quorum?.n ?? ''}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10)
                  if (Number.isNaN(n)) {
                    update({ quorum: undefined })
                    return
                  }
                  update({ quorum: { n, of: value.quorum?.of ?? n } })
                }}
                placeholder="—"
                style={{ ...inputStyle, width: '60px' }}
              />
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>of</span>
              <input
                type="number"
                min={value.quorum?.n ?? 1}
                max={99}
                value={value.quorum?.of ?? ''}
                onChange={(e) => {
                  const of = parseInt(e.target.value, 10)
                  if (Number.isNaN(of) || !value.quorum) return
                  update({ quorum: { n: value.quorum.n, of } })
                }}
                placeholder="—"
                style={{ ...inputStyle, width: '60px' }}
              />
              {value.quorum && (
                <button
                  onClick={() => update({ quorum: undefined })}
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '11px', cursor: 'pointer' }}
                >
                  clear
                </button>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={labelStyle}>Exclude author</label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text)' }}>
              <input
                type="checkbox"
                checked={value.exclude_author ?? false}
                onChange={(e) => update({ exclude_author: e.target.checked })}
              />
              Author of the change cannot review their own
            </label>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={labelStyle}>Timeout</label>
            <input
              type="text"
              value={value.timeout ?? ''}
              onChange={(e) => update({ timeout: e.target.value || undefined })}
              placeholder="24h"
              style={inputStyle}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={labelStyle}>On timeout</label>
            <select
              value={value.timeout_action ?? 'notify'}
              onChange={(e) => update({ timeout_action: e.target.value as TimeoutAction })}
              style={inputStyle}
            >
              {TIMEOUT_ACTION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          {value.timeout_action === 'escalate' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Fallback reviewer (role)</label>
              <input
                type="text"
                value={value.fallback_reviewer ?? ''}
                onChange={(e) => update({ fallback_reviewer: e.target.value || undefined })}
                placeholder="lead"
                style={inputStyle}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
