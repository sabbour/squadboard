import { useState, useEffect } from 'react'
import {
  useReviewPolicyDefault,
  useSetReviewPolicyDefault,
  useClearReviewPolicyDefault,
  type ReviewPolicyPayload,
} from '../../api/review-policies.ts'
import { ReviewPolicyPicker } from '../reviews/ReviewPolicyPicker.tsx'
import { ReviewPolicyHeader } from '../reviews/ReviewPolicyHeader.tsx'

export interface ReviewPolicySectionProps {
  projectId: string
}

export function ReviewPolicySection({ projectId }: ReviewPolicySectionProps) {
  const { data, isLoading, error } = useReviewPolicyDefault(projectId)
  const setDefault = useSetReviewPolicyDefault(projectId)
  const clearDefault = useClearReviewPolicyDefault(projectId)

  const [draft, setDraft] = useState<ReviewPolicyPayload | null>(null)
  const [dirty, setDirty] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    if (data && !dirty) setDraft(data.stored)
  }, [data, dirty])

  const handleChange = (next: ReviewPolicyPayload | null) => {
    setDraft(next)
    setDirty(true)
    setSavedAt(null)
    setSubmitError(null)
  }

  const handleSave = async () => {
    setSubmitError(null)
    try {
      if (draft == null) {
        await clearDefault.mutateAsync()
      } else {
        await setDefault.mutateAsync(draft)
      }
      setDirty(false)
      setSavedAt(Date.now())
      setTimeout(() => setSavedAt(null), 2500)
    } catch (e: unknown) {
      setSubmitError(e instanceof Error ? e.message : 'Save failed')
    }
  }

  const handleReset = () => {
    if (data) setDraft(data.stored)
    setDirty(false)
    setSubmitError(null)
  }

  if (isLoading) {
    return <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Loading review policy…</div>
  }
  if (error || !data) {
    return (
      <div style={{ fontSize: '13px', color: '#f85149' }}>
        Failed to load review policy: {error?.message ?? 'unknown error'}
      </div>
    )
  }

  const saving = setDefault.isPending || clearDefault.isPending

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '720px' }}>
      <div
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: '8px',
          padding: '14px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
        }}
      >
        <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Currently effective
        </div>
        <ReviewPolicyHeader policy={data.resolved} sources={data.sources} warnings={data.warnings} />
        {data.warnings.length > 0 && (
          <div style={{ fontSize: '11px', color: '#d29922' }}>
            ⚠ {data.warnings.length} warning{data.warnings.length === 1 ? '' : 's'} — open the explainer for details.
          </div>
        )}
      </div>

      <div
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: '8px',
          padding: '14px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}
      >
        <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Project default
        </div>
        <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
          Applied to all <code style={{ color: 'var(--text)' }}>approve</code> steps that don't override the policy in their workflow YAML.
          Choose a built-in preset, save a project-specific preset, or override individual fields.
        </p>

        <ReviewPolicyPicker projectId={projectId} value={draft} onChange={handleChange} />

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button
            onClick={handleSave}
            disabled={!dirty || saving}
            style={{
              background: dirty ? 'rgba(63,185,80,0.15)' : 'var(--bg)',
              border: '1px solid ' + (dirty ? 'rgba(63,185,80,0.4)' : 'var(--border)'),
              color: dirty ? '#3fb950' : 'var(--text-muted)',
              borderRadius: '6px',
              padding: '6px 14px',
              fontSize: '12px',
              fontWeight: 600,
              cursor: dirty && !saving ? 'pointer' : 'not-allowed',
            }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          {dirty && (
            <button
              onClick={handleReset}
              disabled={saving}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-muted)',
                fontSize: '12px',
                cursor: 'pointer',
                padding: '6px 4px',
              }}
            >
              Discard changes
            </button>
          )}
          {savedAt && <span style={{ fontSize: '11px', color: '#3fb950' }}>Saved.</span>}
          {submitError && <span style={{ fontSize: '11px', color: '#f85149' }}>{submitError}</span>}
        </div>
      </div>

      <div style={{ fontSize: '11px', color: 'var(--text-muted)', lineHeight: 1.6 }}>
        <strong>Resolution chain:</strong> workflow step override → board default → project default → system default.
        Board defaults will surface here once boards land.
      </div>
    </div>
  )
}
