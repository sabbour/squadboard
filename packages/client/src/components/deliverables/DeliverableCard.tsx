import { useState } from 'react'
import { tokens } from '@fluentui/react-components'
import { safeRelativeTime } from '../../utils/dates.ts'
import {
  type Deliverable,
  type DeliverableKind,
  type DeliverableStatus,
  type DeliverableReview,
  useRequestPeerReview,
  useDeliverable,
} from '../../api/deliverables.ts'
import { useAgents, type Agent } from '../../api/agents.ts'
import {
  type ReviewDecision,
  type ReviewEvent,
  type WorkflowRunReviews,
} from '../../api/reviews.ts'
import { ReviewPanel } from '../reviews/ReviewPanel.tsx'
import TextDeliverable from './kinds/TextDeliverable.tsx'
import FilesDeliverable from './kinds/FilesDeliverable.tsx'
import LinksDeliverable from './kinds/LinksDeliverable.tsx'
import StructuredDeliverable from './kinds/StructuredDeliverable.tsx'

interface DeliverableCardProps {
  projectId: string
  deliverable: Deliverable
}

const STATUS_TONE: Record<DeliverableStatus, { bg: string; fg: string; border: string; label: string }> = {
  draft: {
    bg: 'rgba(139,148,158,0.12)',
    fg: '#8b949e',
    border: 'rgba(139,148,158,0.4)',
    label: 'Draft',
  },
  submitted: {
    bg: 'rgba(88,166,255,0.12)',
    fg: '#58a6ff',
    border: 'rgba(88,166,255,0.4)',
    label: 'Submitted',
  },
  approved: {
    bg: 'rgba(63,185,80,0.12)',
    fg: '#3fb950',
    border: 'rgba(63,185,80,0.4)',
    label: 'Approved',
  },
  changes_requested: {
    bg: 'rgba(210,153,34,0.12)',
    fg: '#d29922',
    border: 'rgba(210,153,34,0.4)',
    label: 'Changes requested',
  },
  superseded: {
    bg: 'rgba(139,148,158,0.12)',
    fg: '#8b949e',
    border: 'rgba(139,148,158,0.4)',
    label: 'Superseded',
  },
}

const KIND_LABELS: Record<DeliverableKind, string> = {
  text: 'Text',
  files: 'Files',
  links: 'Links',
  structured: 'Structured',
}

export default function DeliverableCard({ projectId, deliverable }: DeliverableCardProps) {
  const [open, setOpen] = useState(false)
  const [showPicker, setShowPicker] = useState(false)
  const [pickerError, setPickerError] = useState<string | null>(null)
  const [pickerNote, setPickerNote] = useState<string | null>(null)

  const { data: agents = [] } = useAgents(projectId)
  const requestPeerReview = useRequestPeerReview(projectId, deliverable.id)
  const { data: full } = useDeliverable(projectId, open ? deliverable.id : null)
  const reviewGroup = buildSyntheticReviewGroup(deliverable, full?.reviews ?? [])

  const status = STATUS_TONE[deliverable.status]
  const kindLabel = KIND_LABELS[deliverable.kind]
  const producedRel = deliverable.producedAt
    ? safeRelativeTime(deliverable.producedAt)
    : safeRelativeTime(deliverable.createdAt)

  async function onPickReviewer(agent: Agent | null) {
    setPickerError(null)
    setPickerNote(null)
    try {
      const result = await requestPeerReview.mutateAsync(
        agent ? { agentId: agent.id } : {},
      )
      setPickerNote(`Requested review from ${result.agentName}.`)
      setShowPicker(false)
    } catch (e) {
      setPickerError((e as Error)?.message ?? 'Failed to request peer review')
    }
  }

  return (
    <div
      style={{
        background: tokens.colorNeutralBackground1,
        border: `1px solid ${tokens.colorNeutralStroke1}`,
        borderRadius: '6px',
        overflow: 'hidden',
      }}
    >
      {/* Card header (collapsed view) */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: '12px',
          width: '100%',
          padding: '10px 12px',
          background: 'transparent',
          border: 'none',
          textAlign: 'left',
          cursor: 'pointer',
          color: tokens.colorNeutralForeground1,
        }}
      >
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '10px', color: tokens.colorNeutralForeground3 }}>
              {open ? '▾' : '▸'}
            </span>
            <span style={{ fontSize: '13px', fontWeight: 600 }}>{deliverable.title}</span>
          </div>
          {deliverable.summary && (
            <p
              style={{
                margin: '2px 0 0 16px',
                fontSize: '12px',
                color: tokens.colorNeutralForeground2,
                lineHeight: 1.5,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
              }}
            >
              {deliverable.summary}
            </p>
          )}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              flexWrap: 'wrap',
              marginLeft: '16px',
              marginTop: '2px',
            }}
          >
            <Badge
              bg={status.bg}
              fg={status.fg}
              border={status.border}
              text={status.label}
            />
            <Badge
              bg={tokens.colorNeutralBackground3}
              fg={tokens.colorNeutralForeground2}
              border={tokens.colorNeutralStroke1}
              text={kindLabel}
            />
            <span
              style={{
                fontSize: '11px',
                color: tokens.colorNeutralForeground3,
              }}
            >
              {producedRel}
            </span>
          </div>
        </div>
      </button>

      {/* Expanded body */}
      {open && (
        <div
          style={{
            padding: '12px',
            borderTop: `1px solid ${tokens.colorNeutralStroke1}`,
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            background: tokens.colorNeutralBackground2,
          }}
        >
          {renderKindViewer(deliverable)}

          {/* Inline review panel — wired through the deliverable target */}
          <div
            style={{
              borderTop: `1px solid ${tokens.colorNeutralStroke1}`,
              paddingTop: '12px',
            }}
          >
            <ReviewPanel
              reviewGroup={reviewGroup}
              target={{
                kind: 'deliverable',
                id: deliverable.id,
                deliverableId: deliverable.id,
                projectId,
                title: deliverable.title,
              }}
              allowHumanOverride
            />
          </div>

          {/* Peer-review request bar */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              borderTop: `1px solid ${tokens.colorNeutralStroke1}`,
              paddingTop: '10px',
            }}
          >
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
              <button
                type="button"
                onClick={() => {
                  setShowPicker((s) => !s)
                  setPickerError(null)
                  setPickerNote(null)
                }}
                disabled={requestPeerReview.isPending}
                style={{
                  background: 'rgba(88,166,255,0.12)',
                  border: '1px solid rgba(88,166,255,0.4)',
                  color: '#58a6ff',
                  borderRadius: '6px',
                  padding: '5px 12px',
                  fontSize: '12px',
                  fontWeight: 500,
                  cursor: 'pointer',
                  opacity: requestPeerReview.isPending ? 0.6 : 1,
                }}
              >
                {showPicker ? 'Cancel' : '👀 Ask peer to review'}
              </button>
              {pickerNote && (
                <span style={{ fontSize: '11px', color: tokens.colorPaletteGreenForeground1 }}>
                  {pickerNote}
                </span>
              )}
              {pickerError && (
                <span style={{ fontSize: '11px', color: tokens.colorPaletteRedForeground1 }}>
                  {pickerError}
                </span>
              )}
            </div>
            {showPicker && (
              <div
                style={{
                  background: tokens.colorNeutralBackground1,
                  border: `1px solid ${tokens.colorNeutralStroke1}`,
                  borderRadius: '6px',
                  padding: '8px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                  maxHeight: '240px',
                  overflowY: 'auto',
                }}
              >
                <PickerRow
                  title="Let routing decide"
                  subtitle="Server picks the best peer reviewer."
                  onClick={() => onPickReviewer(null)}
                  disabled={requestPeerReview.isPending}
                />
                {agents.length === 0 && (
                  <p
                    style={{
                      margin: 0,
                      fontSize: '11px',
                      color: tokens.colorNeutralForeground3,
                      padding: '6px 8px',
                    }}
                  >
                    No other agents in this project.
                  </p>
                )}
                {agents.map((a) => (
                  <PickerRow
                    key={a.id}
                    title={`@${a.name}`}
                    subtitle={a.role}
                    onClick={() => onPickReviewer(a)}
                    disabled={requestPeerReview.isPending}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function buildSyntheticReviewGroup(
  deliverable: Deliverable,
  reviews: DeliverableReview[],
): WorkflowRunReviews {
  const decision: ReviewDecision =
    deliverable.status === 'approved'
      ? 'approved'
      : deliverable.status === 'changes_requested'
        ? 'changes_requested'
        : 'pending'

  const events: ReviewEvent[] = reviews.map((r) => ({
    id: r.id,
    agentId: r.reviewerAgentId ?? '',
    agentName: r.reviewerName ?? 'Unknown reviewer',
    verb: r.verb,
    comment: r.body ?? undefined,
    suggestions: r.suggestions ?? undefined,
    createdAt: r.createdAt,
  }))

  return {
    stepRunId: deliverable.id, // unused in deliverable mode but required by shape
    stepLabel: 'Reviews',
    decision,
    events,
  }
}

function renderKindViewer(deliverable: Deliverable) {
  switch (deliverable.kind) {
    case 'text':
      return <TextDeliverable payload={deliverable.payload} />
    case 'files':
      return <FilesDeliverable payload={deliverable.payload} />
    case 'links':
      return <LinksDeliverable payload={deliverable.payload} />
    case 'structured':
      return <StructuredDeliverable payload={deliverable.payload} />
    default:
      return <StructuredDeliverable payload={deliverable.payload} />
  }
}

function Badge({
  bg,
  fg,
  border,
  text,
}: {
  bg: string
  fg: string
  border: string
  text: string
}) {
  return (
    <span
      style={{
        background: bg,
        color: fg,
        border: `1px solid ${border}`,
        fontSize: '10px',
        padding: '1px 8px',
        borderRadius: '999px',
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        fontWeight: 600,
      }}
    >
      {text}
    </span>
  )
}

function PickerRow({
  title,
  subtitle,
  onClick,
  disabled,
}: {
  title: string
  subtitle?: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'block',
        textAlign: 'left',
        background: 'transparent',
        border: 'none',
        padding: '6px 8px',
        borderRadius: '4px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        color: tokens.colorNeutralForeground1,
        fontSize: '12px',
        opacity: disabled ? 0.6 : 1,
      }}
      onMouseEnter={(e) => {
        if (!disabled)
          (e.currentTarget as HTMLButtonElement).style.background =
            tokens.colorNeutralBackground1Hover
      }}
      onMouseLeave={(e) => {
        ;(e.currentTarget as HTMLButtonElement).style.background = 'transparent'
      }}
    >
      <div style={{ fontWeight: 600 }}>{title}</div>
      {subtitle && (
        <div style={{ fontSize: '11px', color: tokens.colorNeutralForeground3 }}>{subtitle}</div>
      )}
    </button>
  )
}
