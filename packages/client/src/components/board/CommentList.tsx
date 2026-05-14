import { useComments } from '../../api/comments.ts'
import { tokens } from '@fluentui/react-components'
import Avatar from '../Avatar.tsx'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { formatDistanceToNow } from 'date-fns'

interface CommentListProps {
  projectId: string
  issueId: string
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {comments.map((comment) => (
        <div key={comment.id} style={{ display: 'flex', gap: '10px' }}>
          <Avatar name={comment.authorName} avatarUrl={comment.authorAvatarUrl} size={28} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '4px' }}>
              <span style={{ fontSize: '13px', fontWeight: 600, color: tokens.colorNeutralForeground1 }}>
                {comment.authorName}
              </span>
              <span style={{ fontSize: '11px', color: tokens.colorNeutralForeground2 }}>
                {formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true })}
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
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
