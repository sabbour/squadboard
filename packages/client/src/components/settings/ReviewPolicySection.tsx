import { useState, useEffect } from 'react'
import {
  Body1Strong,
  Caption1,
  Link,
  MessageBar,
  MessageBarBody,
  tokens,
} from '@fluentui/react-components'
import {
  useReviewPolicyDefault,
  useSetReviewPolicyDefault,
  useClearReviewPolicyDefault,
  describePolicy,
  type ReviewPolicyPayload,
  type ResolvedReviewPolicy,
} from '../../api/review-policies.ts'
import { ReviewPolicyPicker } from '../reviews/ReviewPolicyPicker.tsx'
import { ReviewPolicyHeader } from '../reviews/ReviewPolicyHeader.tsx'

export interface ReviewPolicySectionProps {
  projectId: string
}

/** Card-like section container, matches the project's existing surface style. */
function PolicyCard({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: '8px',
        padding: '16px 18px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      }}
    >
      {children}
    </div>
  )
}

/** Card heading row: title on the left, optional action on the right. */
function CardHeading({ title, sub, action }: { title: string; sub?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
        <Body1Strong>{title}</Body1Strong>
        {sub && (
          <span style={{ display: 'block', color: tokens.colorNeutralForeground3, lineHeight: 1.5, fontSize: '12px' }}>
            {sub}
          </span>
        )}
      </div>
      {action}
    </div>
  )
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
    return <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>Loading review policy…</Caption1>
  }
  if (error || !data) {
    return (
      <MessageBar intent="error">
        <MessageBarBody>
          Failed to load review policy: {error?.message ?? 'unknown error'}
        </MessageBarBody>
      </MessageBar>
    )
  }

  const saving = setDefault.isPending || clearDefault.isPending

  // Build a best-effort preview of what the draft would resolve to.
  // We layer the draft fields over the current resolved policy (which already
  // incorporates system defaults) so the user can see a plain-English outcome.
  const previewResolved: ResolvedReviewPolicy = {
    approvers: draft?.approvers ?? data.resolved.approvers,
    approver_objects: draft?.approver_objects ?? data.resolved.approver_objects,
    request_changes_policy: draft?.request_changes_policy ?? data.resolved.request_changes_policy,
    quorum: draft?.quorum ?? data.resolved.quorum,
    exclude_author: draft?.exclude_author ?? data.resolved.exclude_author,
    timeout: draft?.timeout ?? data.resolved.timeout,
    timeout_action: draft?.timeout_action ?? data.resolved.timeout_action,
    fallback_reviewer: draft?.fallback_reviewer ?? data.resolved.fallback_reviewer,
  }

  const learnMoreLink = (
    <Link href="docs/review-policy.md" target="_blank" rel="noopener" style={{ fontSize: '12px', whiteSpace: 'nowrap' }}>
      Learn more
    </Link>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalL, maxWidth: '720px' }}>

      {/* ── Card 1: Active policy ─────────────────────────────────────────── */}
      <PolicyCard>
        <CardHeading
          title="Active policy"
          sub="What runs right now on every approve step in this project — resolved from project default and system fallbacks."
          action={learnMoreLink}
        />
        <ReviewPolicyHeader policy={data.resolved} sources={data.sources} warnings={data.warnings} />
        {data.warnings.length > 0 && (
          <MessageBar intent="warning">
            <MessageBarBody>
              {data.warnings.length} configuration warning{data.warnings.length === 1 ? '' : 's'} — click "Why this policy?" above for details.
            </MessageBarBody>
          </MessageBar>
        )}
      </PolicyCard>

      {/* ── Card 2: Project default (editable) ───────────────────────────── */}
      <PolicyCard>
        <CardHeading
          title="Project default"
          sub={
            <>
              Applied to every <code style={{ fontSize: '11px' }}>approve</code> step that doesn't set its own policy in the workflow YAML.
              Pick a preset for quick setup, or expand "Customise" to fine-tune individual rules.
            </>
          }
        />

        <ReviewPolicyPicker projectId={projectId} value={draft} onChange={handleChange} />

        {/* ── Policy preview strip (shown while editing) ── */}
        {dirty && draft != null && (
          <div
            style={{
              background: 'var(--bg)',
              border: '1px dashed var(--border)',
              borderRadius: '6px',
              padding: '10px 14px',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
            }}
          >
            <Caption1
              style={{
                display: 'block',
                color: tokens.colorNeutralForeground3,
                fontWeight: tokens.fontWeightSemibold,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              Preview — with these settings
            </Caption1>
            <Caption1 style={{ display: 'block', color: 'var(--text)', lineHeight: 1.6 }}>
              {describePolicy(previewResolved)}
            </Caption1>
          </div>
        )}

        {/* ── Save / discard actions ── */}
        <div style={{ display: 'flex', gap: tokens.spacingHorizontalS, alignItems: 'center' }}>
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
          {savedAt && <Caption1 style={{ color: '#3fb950' }}>Saved.</Caption1>}
          {submitError && <Caption1 style={{ color: '#f85149' }}>{submitError}</Caption1>}
        </div>
      </PolicyCard>

      {/* ── Footer: resolution order hint ────────────────────────────────── */}
      <span style={{ display: 'block', color: tokens.colorNeutralForeground3, lineHeight: 1.6, fontSize: '12px' }}>
        <strong>Resolution order:</strong> workflow step override → board default → project default → system default.
        Each field resolves independently — a step can override just the timeout and inherit everything else.{' '}
        <Link href="docs/review-policy.md" target="_blank" rel="noopener">Learn more about policy resolution.</Link>
      </span>
    </div>
  )
}
