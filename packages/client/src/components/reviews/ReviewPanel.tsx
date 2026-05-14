import { useState } from 'react'
import { type WorkflowRunReviews, type ReviewVerb, useSubmitReview } from '../../api/reviews.ts'
import { ReviewDecisionBadge } from './ReviewDecisionBadge.tsx'
import { formatDistanceToNow } from 'date-fns'
import Avatar from '../Avatar.tsx'
import {
  CheckmarkCircle20Regular,
  ArrowSync20Regular,
  Chat20Regular,
  DismissCircle20Regular,
} from '@fluentui/react-icons'

const VERB_CONFIG: Record<ReviewVerb, { icon: React.ReactNode; label: string; color: string }> = {
  approve: { icon: <CheckmarkCircle20Regular />, label: 'Approved', color: '#3fb950' },
  request_changes: { icon: <ArrowSync20Regular />, label: 'Changes requested', color: '#d29922' },
  comment: { icon: <Chat20Regular />, label: 'Commented', color: '#58a6ff' },
  dismiss: { icon: <DismissCircle20Regular />, label: 'Dismissed', color: '#f85149' },
}

const POLICY_LABELS: Record<string, string> = {
  first_veto: 'Policy: first veto blocks',
  majority: 'Policy: majority',
  all_must_approve: 'Policy: all must approve',
}

interface ReviewPanelProps {
  reviewGroup: WorkflowRunReviews
  allowHumanOverride?: boolean
}

function SuggestionsAccordion({ suggestions }: { suggestions: string[] }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ marginTop: '6px' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          background: 'none',
          border: 'none',
          color: '#388bfd',
          fontSize: '11px',
          cursor: 'pointer',
          padding: 0,
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
        }}
      >
        <span style={{ fontSize: '10px' }}>{open ? '▾' : '▸'}</span>
        {suggestions.length} suggestion{suggestions.length !== 1 ? 's' : ''}
      </button>
      {open && (
        <ul style={{ margin: '6px 0 0 12px', padding: 0, listStyle: 'disc', color: '#8b949e', fontSize: '12px', lineHeight: '1.6' }}>
          {suggestions.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function ReviewPanel({ reviewGroup, allowHumanOverride = true }: ReviewPanelProps) {
  const submitReview = useSubmitReview(reviewGroup.stepRunId)
  const [submitting, setSubmitting] = useState<ReviewVerb | null>(null)
  const [comment, setComment] = useState('')
  const [showComment, setShowComment] = useState(false)

  async function handleSubmit(verb: ReviewVerb) {
    setSubmitting(verb)
    try {
      await submitReview.mutateAsync({ verb, comment: comment.trim() || undefined })
      setComment('')
      setShowComment(false)
    } finally {
      setSubmitting(null)
    }
  }

  const inputStyle: React.CSSProperties = {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: '6px',
    color: 'var(--text)',
    padding: '6px 10px',
    fontSize: '12px',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
    resize: 'vertical',
    minHeight: '60px',
    fontFamily: 'inherit',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '12px', fontWeight: 600, color: '#e6edf3' }}>
            {reviewGroup.stepLabel ?? 'Peer Review'}
          </span>
          <ReviewDecisionBadge decision={reviewGroup.decision} />
        </div>
        {reviewGroup.policy && (
          <span style={{ fontSize: '11px', color: '#8b949e' }}>
            {POLICY_LABELS[reviewGroup.policy.kind] ?? reviewGroup.policy.kind}
            {reviewGroup.policy.required != null && reviewGroup.policy.total != null && (
              <> ({reviewGroup.policy.required}/{reviewGroup.policy.total})</>
            )}
          </span>
        )}
      </div>

      {/* Events */}
      {reviewGroup.events.length === 0 ? (
        <div style={{ fontSize: '12px', color: '#484f58', padding: '8px 0' }}>
          No review events yet.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {reviewGroup.events.map((event) => {
            const verbCfg = VERB_CONFIG[event.verb]
            return (
              <div
                key={event.id}
                style={{
                  display: 'flex',
                  gap: '10px',
                  background: 'var(--bg)',
                  border: '1px solid var(--border)',
                  borderRadius: '6px',
                  padding: '10px 12px',
                }}
              >
                <Avatar name={event.agentName} size={28} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)' }}>
                      {event.agentName}
                    </span>
                    <span
                      style={{
                        fontSize: '11px',
                        color: verbCfg.color,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '3px',
                      }}
                    >
                      {verbCfg.icon} {verbCfg.label}
                    </span>
                    <span style={{ fontSize: '11px', color: '#484f58', marginLeft: 'auto' }}>
                      {formatDistanceToNow(new Date(event.createdAt), { addSuffix: true })}
                    </span>
                  </div>
                  {event.comment && (
                    <p style={{ fontSize: '12px', color: 'var(--text)', margin: '6px 0 0', lineHeight: '1.5', whiteSpace: 'pre-wrap' }}>
                      {event.comment}
                    </p>
                  )}
                  {event.suggestions && event.suggestions.length > 0 && (
                    <SuggestionsAccordion suggestions={event.suggestions} />
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Human override actions */}
      {allowHumanOverride && reviewGroup.decision === 'pending' && (
        <div
          style={{
            borderTop: '1px solid var(--border)',
            paddingTop: '12px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          {showComment && (
            <textarea
              style={inputStyle}
              placeholder="Optional comment…"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <button
              onClick={() => handleSubmit('approve')}
              disabled={Boolean(submitting)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                background: submitting ? 'rgba(0,0,0,0.05)' : 'rgba(63,185,80,0.12)',
                border: '1px solid rgba(63,185,80,0.4)',
                color: '#3fb950',
                borderRadius: '6px',
                padding: '5px 12px',
                fontSize: '12px',
                fontWeight: 500,
                cursor: submitting ? 'not-allowed' : 'pointer',
                opacity: submitting && submitting !== 'approve' ? 0.5 : 1,
              }}
            >
              <CheckmarkCircle20Regular /> Approve
            </button>
            <button
              onClick={() => handleSubmit('request_changes')}
              disabled={Boolean(submitting)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                background: submitting ? 'rgba(0,0,0,0.05)' : 'rgba(210,153,34,0.12)',
                border: '1px solid rgba(210,153,34,0.4)',
                color: '#d29922',
                borderRadius: '6px',
                padding: '5px 12px',
                fontSize: '12px',
                fontWeight: 500,
                cursor: submitting ? 'not-allowed' : 'pointer',
                opacity: submitting && submitting !== 'request_changes' ? 0.5 : 1,
              }}
            >
              <ArrowSync20Regular /> Request changes
            </button>
            <button
              onClick={() => setShowComment((o) => !o)}
              style={{
                background: 'none',
                border: 'none',
                color: '#8b949e',
                fontSize: '12px',
                cursor: 'pointer',
                padding: '5px 4px',
              }}
            >
              {showComment ? 'Hide comment' : '+ Add comment'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
