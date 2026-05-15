import { useState, useEffect, useMemo, useRef } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router'
import {
  Button,
  Card,
  Checkbox,
  Dropdown,
  Field,
  Input,
  Option,
  Spinner,
  Textarea,
  tokens,
  Title2,
  Body1,
  Body2,
  Caption1,
  Subtitle2,
  Badge,
  makeStyles,
  Tooltip,
} from '@fluentui/react-components'
import {
  Add20Regular,
  Send20Regular,
  Stop20Regular,
  Bot20Regular,
  Brain20Regular,
  Lightbulb20Regular,
  Checkmark20Regular,
  Dismiss20Regular,
  Edit20Regular,
  Delete20Regular,
  ArrowUpload20Regular,
} from '@fluentui/react-icons'
import {
  useConsultSessions,
  useConsultSession,
  useStartConsult,
  useSendConsultMessage,
  useEndConsult,
  useDeleteConsult,
  useRenameConsult,
  useAcceptProposal,
  useDiscardProposal,
  usePromoteConsult,
  useConsultStream,
  type ConsultSession,
  type ConsultMessage,
  type ConsultProposal,
  type ConsultMode,
  type ConsultProposalKind,
} from '../api/consult.ts'
import { useAgents, useModels } from '../api/agents.ts'
import { useProjects } from '../api/projects.ts'

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flex: 1,
    minHeight: 0,
    height: '100%',
    background: tokens.colorNeutralBackground2,
  },
  list: {
    width: '300px',
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    borderRight: `1px solid ${tokens.colorNeutralStroke1}`,
    background: tokens.colorNeutralBackground1,
  },
  listHeader: {
    padding: '12px 16px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  listScroll: {
    flex: 1,
    overflow: 'auto',
  },
  listItem: {
    padding: '10px 16px',
    cursor: 'pointer',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  listItemActive: {
    background: tokens.colorNeutralBackground1Selected,
    borderLeft: `3px solid ${tokens.colorBrandStroke1}`,
  },
  pane: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    background: tokens.colorNeutralBackground1,
  },
  paneHeader: {
    padding: '12px 24px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    background: tokens.colorNeutralBackground1,
  },
  scroll: {
    flex: 1,
    overflow: 'auto',
    padding: '24px',
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  composer: {
    padding: '16px 24px',
    borderTop: `1px solid ${tokens.colorNeutralStroke1}`,
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    background: tokens.colorNeutralBackground1,
  },
  msgUser: {
    alignSelf: 'flex-end',
    maxWidth: '70%',
    padding: '12px 16px',
    background: tokens.colorBrandBackground2,
    color: tokens.colorBrandForeground2,
    borderRadius: '12px',
    whiteSpace: 'pre-wrap',
    wordWrap: 'break-word',
  },
  msgAssistant: {
    alignSelf: 'flex-start',
    maxWidth: '85%',
    padding: '12px 16px',
    background: tokens.colorNeutralBackground3,
    borderRadius: '12px',
    whiteSpace: 'pre-wrap',
    wordWrap: 'break-word',
  },
  proposalCard: {
    alignSelf: 'flex-start',
    maxWidth: '85%',
    padding: '12px',
    border: `1px solid ${tokens.colorBrandStroke2}`,
    borderRadius: '12px',
    background: tokens.colorNeutralBackground1,
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  empty: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '12px',
    padding: '48px',
    color: tokens.colorNeutralForeground3,
  },
})

// =============================================================================
// PAGE
// =============================================================================

export default function Consult() {
  const { id: projectId, sessionId: routeSessionId } = useParams<{
    id?: string
    sessionId?: string
  }>()
  const navigate = useNavigate()
  const styles = useStyles()
  const [searchParams, setSearchParams] = useSearchParams()

  const sessionsQuery = useConsultSessions(
    projectId ? { projectId } : { global: true },
  )
  const activeSessionId = routeSessionId ?? null

  const handleSelect = (id: string) => {
    if (projectId) navigate(`/projects/${projectId}/consult/${id}`)
    else navigate(`/consult/${id}`)
  }

  const handleNew = () => {
    if (projectId) navigate(`/projects/${projectId}/consult/new`)
    else navigate('/consult/new')
  }

  // ----- Phase 17: context prefill from search params -----
  // Supported:
  //   ?prefill=issue:<issueId>           (requires :id in route)
  //   ?prefill=ceremony:<ceremonyId>     (requires :id in route)
  //   ?prefill=text:<urlencoded>
  //   ?name=<urlencoded>
  const prefillRaw = searchParams.get('prefill')
  const prefillNameParam = searchParams.get('name') ?? undefined
  const [prefill, setPrefill] = useState<{ content?: string; name?: string }>({})

  useEffect(() => {
    let cancelled = false
    async function resolve() {
      if (!prefillRaw) {
        setPrefill({ name: prefillNameParam })
        return
      }
      try {
        if (prefillRaw.startsWith('issue:') && projectId) {
          const issueId = prefillRaw.slice('issue:'.length)
          const res = await fetch(`/api/projects/${projectId}/issues/${issueId}`)
          const env = await res.json()
          const issue = env?.data
          if (!cancelled && issue) {
            const head = `Help me think through this issue.\n\n**${issue.title}**`
            const body = issue.body ? `\n\n${issue.body}` : ''
            setPrefill({
              content: `${head}${body}\n\nWhat's the best way to approach this?`,
              name: prefillNameParam ?? `Re: ${issue.title}`,
            })
          }
        } else if (prefillRaw.startsWith('ceremony:') && projectId) {
          const cid = prefillRaw.slice('ceremony:'.length)
          const res = await fetch(`/api/projects/${projectId}/ceremonies/${cid}`)
          const env = await res.json()
          const detail = env?.data
          const cer = detail?.ceremony ?? detail
          if (!cancelled && cer) {
            const desc = cer.description ? `\n\n${cer.description}` : ''
            setPrefill({
              content: `Help me think through this ceremony.\n\n**${cer.name}**${desc}\n\nIs this the right shape, and what should we tweak?`,
              name: prefillNameParam ?? `Re: ${cer.name}`,
            })
          }
        } else if (prefillRaw.startsWith('text:')) {
          const text = decodeURIComponent(prefillRaw.slice('text:'.length))
          if (!cancelled) setPrefill({ content: text, name: prefillNameParam })
        } else {
          if (!cancelled) setPrefill({ name: prefillNameParam })
        }
      } catch (err) {
        console.warn('consult prefill failed', err)
        if (!cancelled) setPrefill({ name: prefillNameParam })
      }
    }
    resolve()
    return () => {
      cancelled = true
    }
  }, [prefillRaw, prefillNameParam, projectId])

  const handleCreated = (id: string) => {
    // Strip prefill params off the URL once the session is live
    if (prefillRaw || prefillNameParam) {
      const next = new URLSearchParams(searchParams)
      next.delete('prefill')
      next.delete('name')
      setSearchParams(next, { replace: true })
    }
    handleSelect(id)
  }

  return (
    <div className={styles.root}>
      <SessionList
        sessions={sessionsQuery.data ?? []}
        loading={sessionsQuery.isLoading}
        activeSessionId={activeSessionId}
        onSelect={handleSelect}
        onNew={handleNew}
        scope={projectId ? 'project' : 'global'}
      />
      <div className={styles.pane}>
        {activeSessionId && activeSessionId !== 'new' ? (
          <SessionView sessionId={activeSessionId} projectId={projectId ?? null} />
        ) : (
          <NewSessionView
            projectId={projectId ?? null}
            onCreated={handleCreated}
            prefillContent={prefill.content}
            prefillName={prefill.name}
          />
        )}
      </div>
    </div>
  )
}

// =============================================================================
// SESSION LIST (left rail)
// =============================================================================

function SessionList({
  sessions,
  loading,
  activeSessionId,
  onSelect,
  onNew,
  scope,
}: {
  sessions: ConsultSession[]
  loading: boolean
  activeSessionId: string | null
  onSelect: (id: string) => void
  onNew: () => void
  scope: 'project' | 'global'
}) {
  const styles = useStyles()
  return (
    <div className={styles.list}>
      <div className={styles.listHeader}>
        <Subtitle2>{scope === 'global' ? 'Ask anything' : 'Project consults'}</Subtitle2>
        <Button appearance="primary" icon={<Add20Regular />} onClick={onNew}>
          New conversation
        </Button>
      </div>
      <div className={styles.listScroll}>
        {loading && (
          <div style={{ padding: '24px', display: 'flex', justifyContent: 'center' }}>
            <Spinner size="small" />
          </div>
        )}
        {!loading && sessions.length === 0 && (
          <div style={{ padding: '24px', color: tokens.colorNeutralForeground3, textAlign: 'center' }}>
            <Caption1>No conversations yet. Start one to brainstorm.</Caption1>
          </div>
        )}
        {sessions.map((s) => (
          <SessionListItem
            key={s.id}
            session={s}
            active={s.id === activeSessionId}
            onClick={() => onSelect(s.id)}
          />
        ))}
      </div>
    </div>
  )
}

function SessionListItem({
  session,
  active,
  onClick,
}: {
  session: ConsultSession
  active: boolean
  onClick: () => void
}) {
  const styles = useStyles()
  const className = active ? `${styles.listItem} ${styles.listItemActive}` : styles.listItem
  return (
    <div className={className} onClick={onClick}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        {session.mode === 'agent'
          ? <Bot20Regular style={{ color: tokens.colorBrandForeground1 }} />
          : <Brain20Regular style={{ color: tokens.colorPaletteLavenderBorderActive }} />}
        <span style={{ fontWeight: 600, fontSize: '13px', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {session.name ?? 'New consult'}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>
          {session.mode === 'agent' ? (session.agentName ?? 'agent') : 'model'} · {session.messageCount} msgs
        </Caption1>
        {session.status !== 'active' && session.status !== 'idle' && (
          <Badge size="small" appearance="outline">{session.status}</Badge>
        )}
      </div>
    </div>
  )
}

// =============================================================================
// NEW SESSION VIEW (creator)
// =============================================================================

function NewSessionView({
  projectId,
  onCreated,
  prefillContent,
  prefillName,
}: {
  projectId: string | null
  onCreated: (sessionId: string) => void
  prefillContent?: string
  prefillName?: string
}) {
  const styles = useStyles()
  const [mode, setMode] = useState<ConsultMode>('agent')
  const [agentId, setAgentId] = useState<string>('')
  const [model, setModel] = useState<string>('')
  const [name, setName] = useState<string>(prefillName ?? '')
  const [firstMessage, setFirstMessage] = useState<string>(prefillContent ?? '')

  const agentsQuery = useAgents(projectId ?? '')
  const modelsQuery = useModels()
  const startMut = useStartConsult()
  const sendMut = useSendConsultMessage('') // unused; we recreate after start
  void sendMut

  const agents = agentsQuery.data ?? []
  const models = modelsQuery.data ?? []

  // Auto-pick first agent for new project-scoped agent-mode consults.
  useEffect(() => {
    if (mode === 'agent' && !agentId && agents.length > 0) {
      setAgentId(agents[0].id)
    }
  }, [mode, agentId, agents])

  // If no agents and no project, fall back to model mode.
  useEffect(() => {
    if (!projectId && mode === 'agent') setMode('model')
  }, [projectId, mode])

  const handleStart = async () => {
    const session = await startMut.mutateAsync({
      projectId,
      mode,
      agentId: mode === 'agent' ? (agentId || null) : null,
      model: model || null,
      name: name || null,
    })
    if (firstMessage.trim()) {
      try {
        await fetch(`/api/consult/${session.id}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: firstMessage.trim() }),
        })
      } catch (err) {
        console.warn('failed to post first message', err)
      }
    }
    onCreated(session.id)
  }

  return (
    <div className={styles.scroll} style={{ maxWidth: '720px', alignSelf: 'center', width: '100%' }}>
      <Title2>New consult</Title2>
      <Body1 style={{ color: tokens.colorNeutralForeground3 }}>
        Brainstorm with an agent (charter-bound, propose-only) or with a raw model (thinking partner). Nothing
        you say here side-effects your project until you accept a proposal.
      </Body1>

      <Card style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <Field label="Mode">
          <div style={{ display: 'flex', gap: '8px' }}>
            <Button
              appearance={mode === 'agent' ? 'primary' : 'secondary'}
              icon={<Bot20Regular />}
              onClick={() => setMode('agent')}
              disabled={!projectId}
            >
              Agent
            </Button>
            <Button
              appearance={mode === 'model' ? 'primary' : 'secondary'}
              icon={<Brain20Regular />}
              onClick={() => setMode('model')}
            >
              Model
            </Button>
          </div>
        </Field>

        {mode === 'agent' && (
          <Field label="Agent" required>
            {agentsQuery.isLoading ? (
              <Spinner size="extra-small" />
            ) : agents.length === 0 ? (
              <Caption1>No agents in this project. Create one first or switch to Model mode.</Caption1>
            ) : (
              <Dropdown
                value={agents.find((a) => a.id === agentId)?.name ?? ''}
                selectedOptions={agentId ? [agentId] : []}
                onOptionSelect={(_, data) => setAgentId(data.optionValue ?? '')}
              >
                {agents.map((a) => (
                  <Option key={a.id} value={a.id} text={a.name}>
                    {a.name} ({a.role})
                  </Option>
                ))}
              </Dropdown>
            )}
          </Field>
        )}

        <Field label="Model (optional override)">
          <Dropdown
            value={model || 'auto (resolve from agent / project / default)'}
            selectedOptions={model ? [model] : []}
            onOptionSelect={(_, data) => setModel(data.optionValue === 'auto' ? '' : data.optionValue ?? '')}
          >
            <Option key="auto" value="auto" text="auto">auto (resolve from agent / project / default)</Option>
            {models.map((m) => (
              <Option key={m.id} value={m.id} text={m.id}>{m.id}</Option>
            ))}
          </Dropdown>
        </Field>

        <Field label="Name (optional)">
          <Input value={name} onChange={(_, d) => setName(d.value)} placeholder="auto-derived from first message" />
        </Field>

        <Field label="Open with…">
          <Textarea
            value={firstMessage}
            onChange={(_, d) => setFirstMessage(d.value)}
            placeholder="What's on your mind?"
            rows={4}
          />
        </Field>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <Button
            appearance="primary"
            icon={<Send20Regular />}
            onClick={handleStart}
            disabled={
              startMut.isPending ||
              (mode === 'agent' && !agentId)
            }
          >
            {startMut.isPending ? 'Starting…' : 'Start conversation'}
          </Button>
        </div>

        {startMut.error && (
          <Caption1 style={{ color: tokens.colorPaletteRedForeground1 }}>
            {startMut.error.message}
          </Caption1>
        )}
      </Card>
    </div>
  )
}

// =============================================================================
// SESSION VIEW (chat)
// =============================================================================

interface ChatRow {
  key: string
  kind: 'message' | 'proposal' | 'streaming'
  message?: ConsultMessage
  proposal?: ConsultProposal
  streamingText?: string
  streamingReasoning?: string
}

function SessionView({ sessionId, projectId }: { sessionId: string; projectId: string | null }) {
  const styles = useStyles()
  const detailQuery = useConsultSession(sessionId)
  const stream = useConsultStream(sessionId)
  const sendMut = useSendConsultMessage(sessionId)
  const endMut = useEndConsult()
  const deleteMut = useDeleteConsult()
  const renameMut = useRenameConsult(sessionId)
  const navigate = useNavigate()

  const [draft, setDraft] = useState<string>('')
  const [editingName, setEditingName] = useState<boolean>(false)
  const [nameDraft, setNameDraft] = useState<string>('')
  const [promoteOpen, setPromoteOpen] = useState<boolean>(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Build streaming buffer: any deltas after the most recent persisted
  // assistant message form a "streaming bubble" until message_complete
  // arrives and the query refetches.
  const streamingBuffer = useMemo(() => {
    let content = ''
    let reasoning = ''
    let reset = false
    for (const e of stream) {
      if (e.type === 'consult.message_delta') {
        if (reset) { content = ''; reset = false }
        content += (e.payload as { delta: string }).delta
      } else if (e.type === 'consult.reasoning_delta') {
        if (reset) { reasoning = ''; reset = false }
        reasoning += (e.payload as { delta: string }).delta
      } else if (e.type === 'consult.message_complete' || e.type === 'consult.error') {
        // Reset on next delta after the persisted message lands.
        reset = true
        content = ''
        reasoning = ''
      }
    }
    return { content, reasoning }
  }, [stream])

  // Auto-scroll to bottom on new content.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [detailQuery.data?.messages.length, streamingBuffer.content, streamingBuffer.reasoning])

  if (detailQuery.isLoading || !detailQuery.data) {
    return (
      <div className={styles.empty}>
        <Spinner /> Loading…
      </div>
    )
  }

  const session = detailQuery.data
  const rows: ChatRow[] = []
  const proposalsByMessage = new Map<string | null, ConsultProposal[]>()
  for (const p of session.proposals) {
    const key = p.messageId ?? null
    const list = proposalsByMessage.get(key) ?? []
    list.push(p)
    proposalsByMessage.set(key, list)
  }

  // Inline message + proposals after each.
  for (const m of session.messages) {
    rows.push({ key: `m:${m.id}`, kind: 'message', message: m })
    const ps = proposalsByMessage.get(m.id) ?? []
    for (const p of ps) {
      rows.push({ key: `p:${p.id}`, kind: 'proposal', proposal: p })
    }
  }
  // Append proposals not tied to a message at the end.
  for (const p of proposalsByMessage.get(null) ?? []) {
    rows.push({ key: `p:${p.id}`, kind: 'proposal', proposal: p })
  }
  if (streamingBuffer.content || streamingBuffer.reasoning) {
    rows.push({
      key: 'streaming',
      kind: 'streaming',
      streamingText: streamingBuffer.content,
      streamingReasoning: streamingBuffer.reasoning,
    })
  }

  const handleSend = async () => {
    const text = draft.trim()
    if (!text) return
    setDraft('')
    try {
      await sendMut.mutateAsync({ content: text })
    } catch (err) {
      console.error('send failed', err)
    }
  }

  const handleEnd = async () => {
    await endMut.mutateAsync({ sessionId, reason: 'completed' })
  }

  const handleDelete = async () => {
    if (!confirm('Delete this conversation? This cannot be undone.')) return
    await deleteMut.mutateAsync(sessionId)
    if (projectId) navigate(`/projects/${projectId}/consult/new`)
    else navigate('/consult/new')
  }

  const handleRename = async () => {
    if (!nameDraft.trim() || nameDraft === session.name) {
      setEditingName(false)
      return
    }
    await renameMut.mutateAsync({ name: nameDraft.trim() })
    setEditingName(false)
  }

  return (
    <>
      <div className={styles.paneHeader}>
        {editingName ? (
          <Input
            value={nameDraft}
            onChange={(_, d) => setNameDraft(d.value)}
            onBlur={handleRename}
            onKeyDown={(e) => { if (e.key === 'Enter') handleRename() }}
            autoFocus
            style={{ flex: 1 }}
          />
        ) : (
          <Title2
            style={{ flex: 1, cursor: 'pointer' }}
            onClick={() => { setEditingName(true); setNameDraft(session.name ?? '') }}
            title="Click to rename"
          >
            {session.name ?? 'New consult'}
          </Title2>
        )}
        <Badge appearance="outline">{session.mode}</Badge>
        {session.agentName && <Badge appearance="outline">{session.agentName}</Badge>}
        {session.model && <Badge appearance="outline">{session.model}</Badge>}
        <Tooltip content="Promote this conversation to an inbox item, issue, or ceremony" relationship="label">
          <Button appearance="subtle" icon={<ArrowUpload20Regular />} onClick={() => setPromoteOpen(true)}>
            Promote
          </Button>
        </Tooltip>
        <Tooltip content="End the SDK session (history is kept)" relationship="label">
          <Button appearance="subtle" icon={<Stop20Regular />} onClick={handleEnd} disabled={session.status !== 'active' && session.status !== 'idle'}>
            End
          </Button>
        </Tooltip>
        <Tooltip content="Delete this conversation" relationship="label">
          <Button appearance="subtle" icon={<Delete20Regular />} onClick={handleDelete}>
            Delete
          </Button>
        </Tooltip>
      </div>

      <div className={styles.scroll} ref={scrollRef}>
        {rows.length === 0 && (
          <Body2 style={{ color: tokens.colorNeutralForeground3, textAlign: 'center' }}>
            Start the conversation by typing below.
          </Body2>
        )}
        {rows.map((row) => (
          <ChatRowView key={row.key} row={row} sessionId={sessionId} />
        ))}
        <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', color: tokens.colorNeutralForeground3 }}>
          <Caption1>
            {session.messageCount} messages · {session.inputTokens.toLocaleString()} in / {session.outputTokens.toLocaleString()} out · ${parseFloat(session.costUsd).toFixed(4)}
          </Caption1>
        </div>
      </div>

      <div className={styles.composer}>
        <Textarea
          value={draft}
          onChange={(_, d) => setDraft(d.value)}
          placeholder={session.status === 'active' || session.status === 'idle' ? 'Reply…' : 'This conversation is closed.'}
          rows={3}
          disabled={sendMut.isPending || (session.status !== 'active' && session.status !== 'idle')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              void handleSend()
            }
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>
            ⌘/Ctrl+Enter to send
          </Caption1>
          <Button
            appearance="primary"
            icon={<Send20Regular />}
            onClick={() => void handleSend()}
            disabled={sendMut.isPending || !draft.trim() || (session.status !== 'active' && session.status !== 'idle')}
          >
            {sendMut.isPending ? 'Sending…' : 'Send'}
          </Button>
        </div>
      </div>

      {promoteOpen && (
        <PromoteDialog
          sessionId={sessionId}
          projectId={projectId}
          onClose={() => setPromoteOpen(false)}
        />
      )}
    </>
  )
}

// =============================================================================
// CHAT ROW
// =============================================================================

function ChatRowView({ row, sessionId }: { row: ChatRow; sessionId: string }) {
  const styles = useStyles()
  if (row.kind === 'message' && row.message) {
    const m = row.message
    if (m.role === 'tool') return null
    if (m.role === 'system') return null
    const isUser = m.role === 'user'
    return (
      <div className={isUser ? styles.msgUser : styles.msgAssistant}>
        {!isUser && m.reasoningContent && (
          <details style={{ marginBottom: '8px' }}>
            <summary style={{ cursor: 'pointer', fontSize: '11px', color: tokens.colorNeutralForeground3 }}>
              reasoning
            </summary>
            <Caption1 style={{ whiteSpace: 'pre-wrap', color: tokens.colorNeutralForeground3 }}>
              {m.reasoningContent}
            </Caption1>
          </details>
        )}
        <div>{m.content}</div>
      </div>
    )
  }
  if (row.kind === 'streaming') {
    return (
      <div className={styles.msgAssistant}>
        {row.streamingReasoning && (
          <details>
            <summary style={{ cursor: 'pointer', fontSize: '11px', color: tokens.colorNeutralForeground3 }}>
              reasoning…
            </summary>
            <Caption1 style={{ whiteSpace: 'pre-wrap', color: tokens.colorNeutralForeground3 }}>
              {row.streamingReasoning}
            </Caption1>
          </details>
        )}
        <div>
          {row.streamingText}
          <span style={{ opacity: 0.5 }}> ▍</span>
        </div>
      </div>
    )
  }
  if (row.kind === 'proposal' && row.proposal) {
    return <ProposalCard proposal={row.proposal} sessionId={sessionId} />
  }
  return null
}

// =============================================================================
// PROPOSAL CARD
// =============================================================================

const PROPOSAL_LABELS: Record<ConsultProposalKind, string> = {
  issue: 'New issue',
  ceremony: 'New ceremony',
  inbox_item: 'Inbox item',
  capture_to_decision: 'Capture decision',
  assign_agent_to_issue: 'Assign agent',
}

function ProposalCard({ proposal, sessionId }: { proposal: ConsultProposal; sessionId: string }) {
  const styles = useStyles()
  const acceptMut = useAcceptProposal(sessionId)
  const discardMut = useDiscardProposal(sessionId)
  const [editing, setEditing] = useState<boolean>(false)
  const [editedJson, setEditedJson] = useState<string>(() => JSON.stringify(proposal.payload, null, 2))
  const [error, setError] = useState<string | null>(null)

  const isPending = proposal.status === 'pending'
  const summary = renderProposalSummary(proposal)

  const handleAccept = async () => {
    setError(null)
    try {
      let editedPayload: Record<string, unknown> | undefined
      if (editing) {
        const parsed = JSON.parse(editedJson)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('payload must be a JSON object')
        }
        editedPayload = parsed as Record<string, unknown>
      }
      await acceptMut.mutateAsync({ proposalId: proposal.id, editedPayload })
      setEditing(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleDiscard = async () => {
    await discardMut.mutateAsync(proposal.id)
  }

  return (
    <div className={styles.proposalCard}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <Lightbulb20Regular style={{ color: tokens.colorBrandForeground1 }} />
        <Subtitle2 style={{ flex: 1 }}>
          Proposal — {PROPOSAL_LABELS[proposal.kind] ?? proposal.kind}
        </Subtitle2>
        <Badge appearance={proposal.status === 'pending' ? 'tint' : 'outline'}>{proposal.status}</Badge>
      </div>
      <Body2 style={{ color: tokens.colorNeutralForeground2 }}>{summary}</Body2>
      {editing ? (
        <Textarea
          value={editedJson}
          onChange={(_, d) => setEditedJson(d.value)}
          rows={Math.min(20, Math.max(6, editedJson.split('\n').length))}
          style={{ fontFamily: 'monospace', fontSize: '12px' }}
        />
      ) : (
        <details>
          <summary style={{ cursor: 'pointer', fontSize: '12px', color: tokens.colorNeutralForeground3 }}>
            payload
          </summary>
          <pre style={{
            margin: 0,
            padding: '8px',
            background: tokens.colorNeutralBackground3,
            fontSize: '11px',
            overflow: 'auto',
            borderRadius: '4px',
          }}>
            {JSON.stringify(proposal.payload, null, 2)}
          </pre>
        </details>
      )}
      {proposal.errorMessage && (
        <Caption1 style={{ color: tokens.colorPaletteRedForeground1 }}>
          ⚠ {proposal.errorMessage}
        </Caption1>
      )}
      {proposal.result && proposal.status !== 'pending' && (
        <Caption1 style={{ color: tokens.colorPaletteGreenForeground1 }}>
          ✓ {renderArtifactLink(proposal.result)}
        </Caption1>
      )}
      {error && (
        <Caption1 style={{ color: tokens.colorPaletteRedForeground1 }}>{error}</Caption1>
      )}
      {isPending && (
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <Button appearance="subtle" icon={<Edit20Regular />} onClick={() => setEditing(!editing)}>
            {editing ? 'Cancel edit' : 'Edit'}
          </Button>
          <Button appearance="subtle" icon={<Dismiss20Regular />} onClick={handleDiscard} disabled={discardMut.isPending}>
            Discard
          </Button>
          <Button
            appearance="primary"
            icon={<Checkmark20Regular />}
            onClick={handleAccept}
            disabled={acceptMut.isPending}
          >
            {acceptMut.isPending ? 'Accepting…' : (editing ? 'Accept edit' : 'Accept')}
          </Button>
        </div>
      )}
    </div>
  )
}

function renderProposalSummary(p: ConsultProposal): string {
  const payload = (p.editedPayload ?? p.payload) as Record<string, unknown>
  switch (p.kind) {
    case 'issue': return String(payload.title ?? '(untitled issue)')
    case 'ceremony': return String(payload.name ?? '(untitled ceremony)')
    case 'inbox_item': {
      const s = String(payload.summary ?? '')
      return s.length > 120 ? `${s.slice(0, 117)}…` : s
    }
    case 'capture_to_decision': return `${String(payload.key ?? '(untitled)')} — ${String(payload.value ?? '').slice(0, 80)}`
    case 'assign_agent_to_issue': return `Assign ${String(payload.agentName ?? '?')} to issue ${String(payload.issueId ?? '?')}`
    default: return JSON.stringify(payload).slice(0, 200)
  }
}

function renderArtifactLink(artifact: Record<string, unknown>): string {
  const kind = artifact.kind as string | undefined
  if (kind === 'issue' && artifact.issueId) return `Created issue ${artifact.issueId}`
  if (kind === 'inbox_item' && artifact.inboxItemId) return `Captured to inbox (${artifact.inboxItemId})`
  if (kind === 'ceremony' && artifact.ceremonyId) return `Created ceremony ${artifact.ceremonyId}`
  if (kind === 'capture_to_decision' && artifact.filePath) return `Wrote ${String(artifact.filePath)}`
  if (kind === 'assign_agent_to_issue' && artifact.runId) return `Created run ${artifact.runId}`
  return 'Done'
}

// =============================================================================
// PROMOTE DIALOG
// =============================================================================

function PromoteDialog({
  sessionId,
  projectId,
  onClose,
}: {
  sessionId: string
  projectId: string | null
  onClose: () => void
}) {
  const promoteMut = usePromoteConsult(sessionId)
  const projectsQuery = useProjects()
  const navigate = useNavigate()
  const [kind, setKind] = useState<'inbox' | 'issue' | 'ceremony'>('inbox')
  const [targetProjectId, setTargetProjectId] = useState<string>(projectId ?? '')
  const [columnSlug, setColumnSlug] = useState<string>('backlog')
  const [rawTranscript, setRawTranscript] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)

  const projects = projectsQuery.data ?? []
  const targetProject = projects.find((p) => p.id === targetProjectId)

  const handlePromote = async () => {
    setError(null)
    try {
      const r = await promoteMut.mutateAsync({
        kind,
        projectId: kind === 'inbox' ? (targetProjectId || undefined) : targetProjectId,
        columnSlug: kind === 'issue' ? columnSlug : undefined,
        rawTranscript,
      })
      const a = r.artifact
      if (kind === 'issue' && a.url) navigate(String(a.url))
      else if (kind === 'ceremony' && a.url) navigate(String(a.url))
      else if (kind === 'inbox') navigate('/inbox')
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <Card
        style={{ padding: '24px', minWidth: '480px', display: 'flex', flexDirection: 'column', gap: '16px' }}
        onClick={(e) => e.stopPropagation()}
      >
        <Title2>Promote conversation</Title2>
        <Body1>Turn the whole transcript into an artefact.</Body1>
        <Field label="As">
          <div style={{ display: 'flex', gap: '8px' }}>
            <Button appearance={kind === 'inbox' ? 'primary' : 'secondary'} onClick={() => setKind('inbox')}>Inbox item</Button>
            <Button appearance={kind === 'issue' ? 'primary' : 'secondary'} onClick={() => setKind('issue')}>Issue</Button>
            <Button appearance={kind === 'ceremony' ? 'primary' : 'secondary'} onClick={() => setKind('ceremony')}>Ceremony</Button>
          </div>
        </Field>
        {(kind === 'issue' || kind === 'ceremony') && (
          <Field label="Project" required>
            <Dropdown
              value={targetProject?.name ?? '(select)'}
              selectedOptions={targetProjectId ? [targetProjectId] : []}
              onOptionSelect={(_, d) => setTargetProjectId(d.optionValue ?? '')}
            >
              {projects.map((p) => (
                <Option key={p.id} value={p.id} text={p.name}>{p.name}</Option>
              ))}
            </Dropdown>
          </Field>
        )}
        {kind === 'issue' && (
          <Field label="Column">
            <Dropdown
              value={columnSlug}
              selectedOptions={[columnSlug]}
              onOptionSelect={(_, d) => setColumnSlug(d.optionValue ?? 'backlog')}
            >
              {['backlog', 'todo', 'in_progress', 'in_review', 'done'].map((c) => (
                <Option key={c} value={c} text={c}>{c}</Option>
              ))}
            </Dropdown>
          </Field>
        )}
        <Field>
          <Checkbox
            checked={rawTranscript}
            onChange={(_, d) => setRawTranscript(Boolean(d.checked))}
            label={
              <span>
                Skip LLM summarisation — promote raw transcript only.{' '}
                <span style={{ color: tokens.colorNeutralForeground3 }}>
                  By default, an LLM extracts a clean title and body from the conversation
                  before promoting; use this if the model is unavailable or you only want
                  a paper trail.
                </span>
              </span>
            }
          />
        </Field>
        {error && <Caption1 style={{ color: tokens.colorPaletteRedForeground1 }}>{error}</Caption1>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <Button appearance="subtle" onClick={onClose}>Cancel</Button>
          <Button
            appearance="primary"
            icon={<ArrowUpload20Regular />}
            onClick={handlePromote}
            disabled={promoteMut.isPending || ((kind === 'issue' || kind === 'ceremony') && !targetProjectId)}
          >
            {promoteMut.isPending ? 'Promoting…' : 'Promote'}
          </Button>
        </div>
      </Card>
    </div>
  )
}
