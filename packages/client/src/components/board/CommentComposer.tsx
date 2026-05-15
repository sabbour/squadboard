import { useEffect, useMemo, useRef, useState } from 'react'
import { tokens } from '@fluentui/react-components'
import { useAddComment, useDispatchMention } from '../../api/comments.ts'
import { useAgents, type Agent } from '../../api/agents.ts'

interface CommentComposerProps {
  projectId: string
  issueId: string
  /** Pre-fill the textarea (e.g. when navigating from an @mention notification). */
  initialDraft?: string
  onPosted?: () => void
}

interface MentionState {
  open: boolean
  query: string
  /** Caret position when the `@` was typed (used to splice the autocomplete result back in). */
  anchorCaret: number
  highlightedIdx: number
}

const MENTION_REGEX = /(^|\s)@([\w.-]*)$/

/** Find every @name token in the body and return matching agent ids. */
function extractMentionedAgents(body: string, agents: Agent[]): { ids: string[]; names: string[] } {
  const names = new Set<string>()
  const re = /@([\w.-]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(body))) {
    names.add(m[1].toLowerCase())
  }
  const ids: string[] = []
  const matched: string[] = []
  for (const a of agents) {
    if (names.has(a.name.toLowerCase())) {
      ids.push(a.id)
      matched.push(a.name)
    }
  }
  return { ids, names: matched }
}

export default function CommentComposer({
  projectId,
  issueId,
  initialDraft = '',
  onPosted,
}: CommentComposerProps) {
  const [body, setBody] = useState(initialDraft)
  const [mention, setMention] = useState<MentionState>({
    open: false,
    query: '',
    anchorCaret: 0,
    highlightedIdx: 0,
  })
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const addComment = useAddComment(projectId, issueId)
  const dispatchMention = useDispatchMention(projectId, issueId)
  const { data: agents = [] } = useAgents(projectId)

  useEffect(() => {
    if (initialDraft) setBody(initialDraft)
  }, [initialDraft])

  const matches = useMemo<Agent[]>(() => {
    if (!mention.open) return []
    const q = mention.query.toLowerCase()
    return agents
      .filter((a) => a.name.toLowerCase().includes(q) || a.role.toLowerCase().includes(q))
      .slice(0, 6)
  }, [mention.open, mention.query, agents])

  function onChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const next = e.target.value
    setBody(next)
    const caret = e.target.selectionStart ?? next.length
    const upToCaret = next.slice(0, caret)
    const m = MENTION_REGEX.exec(upToCaret)
    if (m) {
      setMention({
        open: true,
        query: m[2] ?? '',
        anchorCaret: caret - (m[2]?.length ?? 0) - 1,
        highlightedIdx: 0,
      })
    } else {
      setMention((s) => (s.open ? { ...s, open: false } : s))
    }
  }

  function pickMention(agent: Agent) {
    if (!mention.open) return
    const before = body.slice(0, mention.anchorCaret)
    const afterStart = mention.anchorCaret + 1 + mention.query.length
    const after = body.slice(afterStart)
    const inserted = `@${agent.name} `
    const next = `${before}${inserted}${after}`
    setBody(next)
    setMention((s) => ({ ...s, open: false }))
    requestAnimationFrame(() => {
      const ta = textareaRef.current
      if (ta) {
        const pos = before.length + inserted.length
        ta.focus()
        ta.setSelectionRange(pos, pos)
      }
    })
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (mention.open && matches.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setMention((s) => ({ ...s, highlightedIdx: (s.highlightedIdx + 1) % matches.length }))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setMention((s) => ({
          ...s,
          highlightedIdx: (s.highlightedIdx - 1 + matches.length) % matches.length,
        }))
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        pickMention(matches[mention.highlightedIdx])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setMention((s) => ({ ...s, open: false }))
        return
      }
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      void handleSubmit()
    }
  }

  async function handleSubmit() {
    const trimmed = body.trim()
    if (!trimmed) return
    const { ids, names } = extractMentionedAgents(trimmed, agents)
    const created = await addComment.mutateAsync({
      body: trimmed,
      authorKind: 'human',
      mentions: ids,
    })
    if (names.length > 0) {
      // Best-effort dispatch — failures shouldn't roll back the comment.
      dispatchMention.mutate(
        { commentId: created.id, body: trimmed, mentions: names },
        {
          onError: (e) => console.warn('[comments] mention dispatch failed:', e),
        },
      )
    }
    setBody('')
    onPosted?.()
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void handleSubmit()
      }}
      style={{ display: 'flex', flexDirection: 'column', gap: '8px', position: 'relative' }}
    >
      <textarea
        ref={textareaRef}
        value={body}
        onChange={onChange}
        onKeyDown={onKeyDown}
        placeholder="Add a comment… type @ to mention an agent (Cmd/Ctrl+Enter to post)"
        rows={3}
        style={{
          width: '100%',
          background: tokens.colorNeutralBackground1,
          border: `1px solid ${tokens.colorNeutralStroke1}`,
          borderRadius: '6px',
          color: tokens.colorNeutralForeground1,
          padding: '8px 10px',
          resize: 'vertical',
          fontSize: '13px',
          lineHeight: '1.5',
          outline: 'none',
          fontFamily: 'inherit',
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = tokens.colorBrandBackground
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = tokens.colorNeutralStroke1
          // Defer close so a click on the autocomplete still fires
          setTimeout(() => setMention((s) => ({ ...s, open: false })), 150)
        }}
      />
      {mention.open && matches.length > 0 && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            zIndex: 10,
            background: tokens.colorNeutralBackground1,
            border: `1px solid ${tokens.colorNeutralStroke1}`,
            borderRadius: '6px',
            boxShadow: tokens.shadow16,
            minWidth: '240px',
            maxHeight: '240px',
            overflowY: 'auto',
            marginTop: '-4px',
          }}
        >
          {matches.map((a, idx) => (
            <button
              key={a.id}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault()
                pickMention(a)
              }}
              onMouseEnter={() => setMention((s) => ({ ...s, highlightedIdx: idx }))}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                background:
                  idx === mention.highlightedIdx
                    ? tokens.colorNeutralBackground1Hover
                    : 'transparent',
                border: 'none',
                color: tokens.colorNeutralForeground1,
                padding: '8px 12px',
                fontSize: '13px',
                cursor: 'pointer',
              }}
            >
              <div style={{ fontWeight: 600 }}>@{a.name}</div>
              <div style={{ fontSize: '11px', color: tokens.colorNeutralForeground3 }}>{a.role}</div>
            </button>
          ))}
        </div>
      )}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span style={{ fontSize: '11px', color: tokens.colorNeutralForeground3 }}>
          @-mention an agent to inject into a live session or spawn a new one.
        </span>
        <button
          type="submit"
          disabled={!body.trim() || addComment.isPending}
          style={{
            background: '#238636',
            border: '1px solid #2ea043',
            borderRadius: '6px',
            color: '#ffffff',
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
