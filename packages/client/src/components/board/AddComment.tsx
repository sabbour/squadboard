import { useState } from 'react'
import { useAddComment } from '../../api/comments.ts'

interface AddCommentProps {
  projectId: string
  issueId: string
}

export default function AddComment({ projectId, issueId }: AddCommentProps) {
  const [body, setBody] = useState('')
  const addComment = useAddComment(projectId, issueId)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = body.trim()
    if (!trimmed) return
    addComment.mutate({ body: trimmed }, {
      onSuccess: () => setBody(''),
    })
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Add a comment… (Markdown supported)"
        rows={3}
        style={{
          width: '100%',
          background: '#0d1117',
          border: '1px solid #30363d',
          borderRadius: '6px',
          color: '#e6edf3',
          padding: '8px 10px',
          resize: 'vertical',
          fontSize: '13px',
          lineHeight: '1.5',
          outline: 'none',
        }}
        onFocus={(e) => { e.currentTarget.style.borderColor = '#388bfd' }}
        onBlur={(e) => { e.currentTarget.style.borderColor = '#30363d' }}
      />
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          type="submit"
          disabled={!body.trim() || addComment.isPending}
          style={{
            background: '#238636',
            border: '1px solid #2ea043',
            borderRadius: '6px',
            color: '#e6edf3',
            padding: '5px 16px',
            fontSize: '13px',
            fontWeight: 500,
            cursor: body.trim() ? 'pointer' : 'not-allowed',
            opacity: !body.trim() || addComment.isPending ? 0.6 : 1,
          }}
        >
          {addComment.isPending ? 'Posting…' : 'Comment'}
        </button>
      </div>
    </form>
  )
}
