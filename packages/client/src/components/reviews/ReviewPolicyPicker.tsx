import { useState, useEffect, useMemo } from 'react'
import {
  Field,
  Caption1,
  Link,
  tokens,
} from '@fluentui/react-components'
import {
  useReviewPolicyPresets,
  type ReviewPolicyPayload,
  type ReviewPolicyPreset,
  type RequestChangesPolicy,
  type TimeoutAction,
} from '../../api/review-policies.ts'

const REQUEST_CHANGES_OPTIONS: { value: RequestChangesPolicy; label: string; hint: string }[] = [
  { value: 'first', label: 'First request_changes blocks', hint: 'A single "request changes" verdict stops the step immediately.' },
  { value: 'majority', label: 'Majority must request changes to block', hint: 'More than half of the assigned reviewers must request changes before the step is blocked.' },
  { value: 'all', label: 'All reviewers must approve', hint: 'Every assigned reviewer must approve — one rejection is not enough to block, but approval is unanimous.' },
]

const TIMEOUT_ACTION_OPTIONS: { value: TimeoutAction; label: string; hint: string }[] = [
  { value: 'notify', label: 'Notify only', hint: 'Send a notification; the step stays pending so a reviewer can still act.' },
  { value: 'auto_approve', label: 'Auto-approve', hint: 'Automatically approve the step if no reviewer acts by the deadline.' },
  { value: 'auto_reject', label: 'Auto-reject', hint: 'Automatically reject the step if no reviewer acts by the deadline.' },
  { value: 'escalate', label: 'Escalate to fallback reviewer', hint: 'Re-assign the review to the fallback reviewer role if the primary reviewer misses the deadline.' },
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
  width: '100%',
  boxSizing: 'border-box',
}

/** Thin horizontal rule with a text label — separates sub-groups inside the advanced panel. */
function SubGroupDivider({ label }: { label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '4px 0' }}>
      <Caption1
        as="span"
        style={{
          color: tokens.colorNeutralForeground3,
          fontWeight: tokens.fontWeightSemibold,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          whiteSpace: 'nowrap',
          fontSize: '10px',
        }}
      >
        {label}
      </Caption1>
      <div style={{ flex: 1, height: '1px', background: 'var(--border)' }} />
    </div>
  )
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
    return <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>Loading presets…</Caption1>
  }

  const selectValue = matchingPresetSlug ?? (value == null ? '__clear__' : '__custom__')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>

      {/* ── Policy preset ──────────────────────────────────────────────── */}
      <Field
        label="Policy preset"
        hint="Choose a named bundle of rules as a starting point. You can fine-tune individual settings below."
      >
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
          <option value="__custom__">Custom — fine-tune below</option>
        </select>
      </Field>

      {/* ── Customise toggle ───────────────────────────────────────────── */}
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
          {showAdvanced ? '▾ Hide individual settings' : '▸ Customise individual settings'}
        </button>
      )}

      {/* ── Advanced settings panel ────────────────────────────────────── */}
      {value != null && showAdvanced && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
            padding: '14px 16px',
            background: 'var(--bg)',
            border: '1px solid var(--border)',
            borderRadius: '6px',
          }}
        >
          {/* ══ GROUP 1: Approval rules ══════════════════════════════════ */}
          <SubGroupDivider label="Approval rules" />

          {/* Who reviews */}
          <Field
            label="Who can approve"
            hint="Role names or agent names, comma-separated. Leave blank to allow any reviewer. Example: lead, qa"
          >
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
              placeholder="lead, qa — or leave blank for any"
              style={inputStyle}
            />
          </Field>

          {/* Quorum */}
          <Field
            label="Approvals needed (quorum)"
            hint="Require N out of the assigned reviewers to approve. Leave both boxes empty to require just one approval."
          >
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
                placeholder="N"
                style={{ ...inputStyle, width: '72px' }}
              />
              <Caption1 as="span" style={{ color: tokens.colorNeutralForeground3 }}>of</Caption1>
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
                placeholder="total"
                style={{ ...inputStyle, width: '72px' }}
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
          </Field>

          {/* Exclude author */}
          <Field
            label="Exclude author"
            hint="When on, the person who triggered the workflow cannot approve their own step."
          >
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--text)', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={value.exclude_author ?? false}
                onChange={(e) => update({ exclude_author: e.target.checked })}
              />
              Don't allow the author to review their own work
            </label>
          </Field>

          {/* Block policy */}
          <Field
            label="When someone requests changes"
            hint="Controls how many change-request verdicts are needed to block the step from proceeding."
          >
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
            {/* Inline contextual hint for the selected option */}
            <Caption1 style={{ display: 'block', color: tokens.colorNeutralForeground3, marginTop: '4px' }}>
              {REQUEST_CHANGES_OPTIONS.find((o) => o.value === (value.request_changes_policy ?? 'first'))?.hint}
            </Caption1>
          </Field>

          {/* ══ GROUP 2: Timing & escalation ═════════════════════════════ */}
          <SubGroupDivider label="Timing & escalation" />

          {/* Review deadline */}
          <Field
            label="Review deadline"
            hint="How long to wait for a reviewer before the deadline action fires. Use ISO-8601 duration: 24h, 2d, 1w."
          >
            <input
              type="text"
              value={value.timeout ?? ''}
              onChange={(e) => update({ timeout: e.target.value || undefined })}
              placeholder="24h"
              style={inputStyle}
            />
          </Field>

          {/* When deadline passes */}
          <Field
            label="When the deadline passes"
            hint="What the system does automatically if no reviewer acts before the deadline."
          >
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
            <Caption1 style={{ display: 'block', color: tokens.colorNeutralForeground3, marginTop: '4px' }}>
              {TIMEOUT_ACTION_OPTIONS.find((o) => o.value === (value.timeout_action ?? 'notify'))?.hint}
            </Caption1>
          </Field>

          {/* Escalate to (conditional) */}
          {value.timeout_action === 'escalate' && (
            <Field
              label="Escalate to (role)"
              hint="The role name to reassign the review to when the deadline passes. Example: lead"
            >
              <input
                type="text"
                value={value.fallback_reviewer ?? ''}
                onChange={(e) => update({ fallback_reviewer: e.target.value || undefined })}
                placeholder="lead"
                style={inputStyle}
              />
            </Field>
          )}

          <Caption1 style={{ display: 'block', color: tokens.colorNeutralForeground3, lineHeight: 1.6 }}>
            Need help? <Link href="docs/review-policy.md" target="_blank" rel="noopener">Read the policy reference.</Link>
          </Caption1>
        </div>
      )}
    </div>
  )
}
