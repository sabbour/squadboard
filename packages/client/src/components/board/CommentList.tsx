import { useComments, type Comment } from '../../api/comments.ts'
import { tokens } from '@fluentui/react-components'
import Avatar from '../Avatar.tsx'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { safeRelativeTime } from '../../utils/dates.ts'
import {
  PlayCircle20Regular,
  CheckmarkCircle20Regular,
  ArrowSync20Regular,
  Document20Regular,
  Chat20Regular,
  Person20Regular,
  PersonChat20Regular,
  Warning20Regular,
} from '@fluentui/react-icons'

interface CommentListProps {
  projectId: string
  issueId: string
}

const SYSTEM_EVENT_ICONS: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
  'run.started':                { icon: <PlayCircle20Regular />,    color: '#388bfd', label: 'Run started' },
  'run.completed':              { icon: <CheckmarkCircle20Regular />, color: '#3fb950', label: 'Run completed' },
  'run.failed':                 { icon: <Warning20Regular />,       color: '#f85149', label: 'Run failed' },
  'review.opened':              { icon: <PersonChat20Regular />,    color: '#388bfd', label: 'Review opened' },
  'review.approved':            { icon: <CheckmarkCircle20Regular />, color: '#3fb950', label: 'Review approved' },
  'review.requested_changes':   { icon: <ArrowSync20Regular />,     color: '#d29922', label: 'Changes requested' },
  'review.timeout.notify':      { icon: <Warning20Regular />,       color: '#d29922', label: 'Review timeout' },
  'review.timeout.auto_approve':{ icon: <CheckmarkCircle20Regular />, color: '#3fb950', label: 'Auto-approved' },
  'review.timeout.auto_reject': { icon: <Warning20Regular />,       color: '#f85149', label: 'Auto-rejected' },
  'review.timeout.escalate':    { icon: <Warning20Regular />,       color: '#d29922', label: 'Review escalated' },
  'deliverable.submitted':      { icon: <Document20Regular />,      color: '#388bfd', label: 'Output submitted' },
  'deliverable.approved':       { icon: <CheckmarkCircle20Regular />, color: '#3fb950', label: 'Output approved' },
  'deliverable.changes_requested':{ icon: <ArrowSync20Regular />,   color: '#d29922', label: 'Output changes requested' },
  'deliverable.peer_review_requested':{ icon: <PersonChat20Regular />, color: '#388bfd', label: 'Peer review requested' },
  'column.changed':             { icon: <ArrowSync20Regular />,     color: '#388bfd', label: 'Column changed' },
}

function getSystemConfig(eventKind: string | null | undefined) {
  const fallback = { icon: <Chat20Regular />, color: tokens.colorNeutralForeground2, label: eventKind ?? 'Event' }
  if (!eventKind) return fallback
  return SYSTEM_EVENT_ICONS[eventKind] ?? fallback
}

function MentionChips({ mentions }: { mentions: string[] }) {
  if (!mentions || mentions.length === 0) return null
  return (
    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '6px' }}>
      {mentions.map((m) => (
        <span
          key={m}
          style={{
            fontSize: '11px',
            background: 'rgba(56,139,253,0.12)',
            color: '#388bfd',
            border: '1px solid rgba(56,139,253,0.4)',
            borderRadius: '12px',
            padding: '1px 8px',
          }}
        >
          @{m.length > 36 ? m.slice(0, 8) : m}
        </span>
      ))}
    </div>
  )
}

function HumanComment({ comment }: { comment: Comment }) {
  return (
    <div style={{ display: 'flex', gap: '10px' }}>
      <Avatar name={comment.authorName ?? 'You'} avatarUrl={comment.authorAvatarUrl} size={28} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '4px' }}>
          <span style={{ fontSize: '13px', fontWeight: 600, color: tokens.colorNeutralForeground1 }}>
            {comment.authorName ?? 'Anonymous'}
          </span>
          <span style={{ fontSize: '11px', color: tokens.colorNeutralForeground2 }}>
            {safeRelativeTime(comment.createdAt)}
          </span>
        </div>
        <div
          style={{
            fontSize: '13px',
            color: tokens.colorNeutralForeground1,
            lineHeight: '1.5',
            background: tokens.colorNeutralBackground2,
            border: `1px solid ${tokens.colorNeutralStroke1}`,
            borderRadius: '6px',
            padding: '10px 12px',
          }}
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{comment.body}</ReactMarkdown>
          <MentionChips mentions={comment.mentions} />
        </div>
      </div>
    </div>
  )
}

function AgentComment({ comment }: { comment: Comment }) {
  const name = comment.authorName ?? comment.authorRef ?? 'Agent'
  const role = comment.authorRole ?? null
  return (
    <div style={{ display: 'flex', gap: '10px' }}>
      <div
        style={{
          width: '28px',
          height: '28px',
          borderRadius: '50%',
          background: 'rgba(56,139,253,0.18)',
          color: '#388bfd',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
        title={`Agent: ${name}`}
      >
        <Person20Regular />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '13px', fontWeight: 600, color: '#388bfd' }}>{name}</span>
          <span
            style={{
              fontSize: '10px',
              fontWeight: 600,
              color: '#388bfd',
              background: 'rgba(56,139,253,0.1)',
              border: '1px solid rgba(56,139,253,0.3)',
              borderRadius: '10px',
              padding: '0 6px',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            agent{role ? ` · ${role}` : ''}
          </span>
          <span style={{ fontSize: '11px', color: tokens.colorNeutralForeground2 }}>
            {safeRelativeTime(comment.createdAt)}
          </span>
        </div>
        <div
          style={{
            fontSize: '13px',
            color: tokens.colorNeutralForeground1,
            lineHeight: '1.5',
            background: 'rgba(56,139,253,0.05)',
            border: '1px solid rgba(56,139,253,0.2)',
            borderRadius: '6px',
            padding: '10px 12px',
          }}
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{comment.body}</ReactMarkdown>
          <MentionChips mentions={comment.mentions} />
        </div>
      </div>
    </div>
  )
}

function SystemEvent({ comment }: { comment: Comment }) {
  const cfg = getSystemConfig(comment.eventKind)
  return (
    <div
      style={{
        display: 'flex',
        gap: '10px',
        alignItems: 'center',
        padding: '6px 10px',
        background: tokens.colorNeutralBackground2,
        border: `1px dashed ${tokens.colorNeutralStroke2}`,
        borderRadius: '6px',
      }}
    >
      <span style={{ color: cfg.color, display: 'inline-flex' }}>{cfg.icon}</span>
      <div style={{ flex: 1, minWidth: 0, fontSize: '12px', color: tokens.colorNeutralForeground2 }}>
        <span style={{ fontWeight: 600, color: cfg.color, marginRight: '6px' }}>{cfg.label}</span>
        <span>{comment.body}</span>
      </div>
      <span style={{ fontSize: '11px', color: tokens.colorNeutralForeground3, flexShrink: 0 }}>
        {safeRelativeTime(comment.createdAt)}
      </span>
    </div>
  )
}

export default function CommentList({ projectId, issueId }: CommentListProps) {
  const { data: comments, isLoading } = useComments(projectId, issueId)

  if (isLoading) {
    return <p style={{ color: tokens.colorNeutralForeground2, fontSize: '12px' }}>Loading comments…</p>
  }

  if (!comments || comments.length === 0) {
    return <p style={{ color: tokens.colorNeutralForeground2, fontSize: '12px' }}>No comments yet.</p>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {comments.map((c) => {
        if (c.authorKind === 'system') return <SystemEvent key={c.id} comment={c} />
        if (c.authorKind === 'agent') return <AgentComment key={c.id} comment={c} />
        return <HumanComment key={c.id} comment={c} />
      })}
    </div>
  )
}
