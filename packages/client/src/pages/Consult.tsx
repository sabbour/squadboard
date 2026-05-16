import { useState, useEffect, useMemo, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
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
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
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
  Warning20Regular,
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
import { useActiveAgents, useModels } from '../api/agents.ts'
import { useProjects } from '../api/projects.ts'
import PageHeader from '../components/layout/PageHeader.tsx'
import { ChatBubble } from '../components/ChatBubble.tsx'
import { ContextPanel } from '../components/consult/ContextPanel.tsx'

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flex: 1,
    minHeight: 0,
    height: '100%',
    background: tokens.colorNeutralBackground2,
  },
  list: {
    width: '240px',
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    borderRight: `1px solid ${tokens.colorNeutralStroke1}`,
    background: tokens.colorNeutralBackground1,
  },
  listHeader: {
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalS,
    alignItems: 'flex-start',
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
          // Wave 10 B6: GET /api/projects/:id/issues/:id returns the issue
          // record directly (no `{ ok, data }` envelope); the previous
          // `env?.data` lookup silently returned undefined and the seed
          // message was never populated, so the Consult button on the issue
          // panel always opened an empty new session.
          const issueRes = await fetch(`/api/projects/${projectId}/issues/${issueId}`)
          const issueBody = (await issueRes.json()) as
            | { id?: string; title?: string; body?: string | null }
            | { data?: { id?: string; title?: string; body?: string | null } }
            | null
          const issue =
            issueBody && typeof issueBody === 'object' && 'data' in issueBody && issueBody.data
              ? issueBody.data
              : (issueBody as { id?: string; title?: string; body?: string | null } | null)
          if (cancelled || !issue || !issue.title) return

          // Pull recent runs so the agent has concrete context (latest output
          // tail). Best-effort — failure here just trims the seed payload.
          // Wave 10 B8: clamp the embedded runs block so a giant log can't
          // make the seed message blow past the server's 64 KiB cap.
          let runsBlock = ''
          try {
            const runsRes = await fetch(
              `/api/projects/${projectId}/issues/${issueId}/runs`,
            )
            if (runsRes.ok) {
              const runs = (await runsRes.json()) as Array<{
                id: string
                status?: string | null
                output?: string | null
                createdAt?: string | null
                agentId?: string | null
              }>
              const recent = runs.slice(-3).reverse() // newest first, max 3
              const formatted = recent
                .map((r) => {
                  const tail = r.output ? r.output.split('\n').slice(-12).join('\n') : ''
                  // Cap a single run tail to 4 KiB so 3 runs ≤ 12 KiB combined.
                  const trimmedTail = tail.length > 4096 ? `${tail.slice(-4096)}\n…(truncated)` : tail
                  const head = `Run ${r.id.slice(0, 8)} (${r.status ?? 'unknown'})`
                  return trimmedTail
                    ? `### ${head}\n\n\`\`\`\n${trimmedTail}\n\`\`\``
                    : `### ${head}\n_(no output)_`
                })
                .join('\n\n')
              if (formatted) runsBlock = `\n\n---\n\n**Recent runs:**\n\n${formatted}`
            }
          } catch {
            // ignore
          }

          const head = `Help me think through this issue.\n\n**${issue.title}**`
          const body = issue.body ? `\n\n${issue.body}` : ''
          const fullContent = `${head}${body}${runsBlock}\n\nWhat's the best way to approach this?`
          // Final defense — if the assembled seed is still oversized for any
          // reason (huge issue body, many runs), clamp it well under the
          // 64 KiB server cap so the first POST /messages succeeds.
          const SEED_CAP = 32 * 1024
          const clamped =
            fullContent.length > SEED_CAP
              ? `${fullContent.slice(0, SEED_CAP)}\n\n…(seed truncated to keep the request small)`
              : fullContent
          setPrefill({
            content: clamped,
            name: prefillNameParam ?? `Re: ${issue.title}`,
          })
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
        <Button appearance="primary" size="small" icon={<Add20Regular />} onClick={onNew}>
          New
        </Button>
      </div>
      <div className={styles.listScroll}>
        {loading && (
          <div style={{ padding: '24px', display: 'flex', justifyContent: 'center' }}>
            <Spinner size="small" />
          </div>
        )}
        {!loading && sessions.length === 0 && (
          <div style={{ padding: '24px', textAlign: 'center' }}>
            <Body1 style={{ color: tokens.colorNeutralForeground2 }}>No conversations yet. Start one to brainstorm.</Body1>
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
  const qc = useQueryClient()
  const [mode, setMode] = useState<ConsultMode>('agent')
  const [agentId, setAgentId] = useState<string>('')
  const [model, setModel] = useState<string>('')
  const [name, setName] = useState<string>(prefillName ?? '')
  const [firstMessage, setFirstMessage] = useState<string>(prefillContent ?? '')

  const agentsQuery = useActiveAgents(projectId ?? '')
  const modelsQuery = useModels()
  const startMut = useStartConsult()
  const sendMut = useSendConsultMessage('') // unused; we recreate after start
  void sendMut

  // Wave 10 B9: useActiveAgents already filters to status === 'active' so
  // disabled / retired agents never reach the picker dropdown.
  const agents = agentsQuery.data ?? []
  const models = modelsQuery.data ?? []

  // Wave 10 B8: surface failures in-place instead of letting them bubble to
  // the React error boundary. Both the create-session POST and the seed
  // first-message POST can return a structured error (400 oversized seed,
  // 5xx server) — show a MessageBar with retry instead of crashing.
  const [startError, setStartError] = useState<string | null>(null)

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
    setStartError(null)
    try {
      const session = await startMut.mutateAsync({
        projectId,
        mode,
        agentId: mode === 'agent' ? (agentId || null) : null,
        model: model || null,
        name: name || null,
      })
      if (firstMessage.trim()) {
        const seed = firstMessage.trim()
        const res = await fetch(`/api/consult/${session.id}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: seed }),
        })
        if (!res.ok) {
          // Server rejected the seed — keep the session, surface the message,
          // and let the user edit-and-retry rather than navigating away.
          let detail = ''
          try {
            const body = (await res.json()) as { error?: string }
            detail = body.error ?? ''
          } catch {
            // ignore
          }
          setStartError(
            detail
              ? `Couldn't send opening message (${res.status}): ${detail}`
              : `Couldn't send opening message (${res.status}). The conversation was created — you can try sending it again from the chat.`,
          )
          // Mark detail stale so the chat view rehydrates if user navigates in.
          void qc.invalidateQueries({ queryKey: ['consultSession', session.id] })
          onCreated(session.id)
          return
        }
        // Mark the detail query stale so SessionView refetches immediately on mount,
        // catching the case where the WS subscription isn't yet active when the
        // assistant message completes.
        void qc.invalidateQueries({ queryKey: ['consultSession', session.id] })
      }
      onCreated(session.id)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setStartError(`Couldn't start the conversation: ${msg}`)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <PageHeader
        title="New consult"
        description="Brainstorm with an agent (charter-bound, propose-only) or a raw model. Nothing you say here side-effects your project until you accept a proposal."
      />
      {/* Wave 10 C1: form card uses up to 1280px so it breathes on wider viewports
          and matches the Inbox/Board content rhythm, while still capping for
          readability on ultra-wide screens. */}
      <div className={styles.scroll} style={{ maxWidth: '1280px', width: '100%', margin: '0 auto' }}>
        <Card style={{ padding: tokens.spacingVerticalL, display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalM }}>

          {/* Mode toggle — segmented control sits at the top of the form */}
          <Field label="Mode">
            <div style={{ display: 'flex', gap: tokens.spacingHorizontalS }}>
              {/* appearance='subtle' when unselected keeps both options visually clickable */}
              <Button
                appearance={mode === 'agent' ? 'primary' : 'subtle'}
                icon={<Bot20Regular />}
                onClick={() => setMode('agent')}
                disabled={!projectId}
              >
                Agent
              </Button>
              <Button
                appearance={mode === 'model' ? 'primary' : 'subtle'}
                icon={<Brain20Regular />}
                onClick={() => setMode('model')}
              >
                Model
              </Button>
            </div>
          </Field>

          {/* Config grid: 2 balanced columns below the mode toggle */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: tokens.spacingHorizontalM }}>

            {/* Col 1: Agent picker (agent mode) or Model dropdown (model mode) */}
            {mode === 'agent' ? (
              <Field label="Agent" required>
                {agentsQuery.isLoading ? (
                  <Spinner size="extra-small" />
                ) : agents.length === 0 ? (
                  <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>
                    No agents in this project. Create one first or switch to Model mode.
                  </Caption1>
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
            ) : (
              <Field label="Model">
                <Dropdown
                  value={model || 'auto'}
                  selectedOptions={model ? [model] : []}
                  onOptionSelect={(_, data) => setModel(data.optionValue === 'auto' ? '' : data.optionValue ?? '')}
                >
                  <Option key="auto" value="auto" text="auto">auto (resolve from project / default)</Option>
                  {models.map((m) => (
                    <Option key={m.id} value={m.id} text={m.id}>{m.id}</Option>
                  ))}
                </Dropdown>
              </Field>
            )}

            {/* Col 2: Model override (agent mode) or Name (model mode) */}
            {mode === 'agent' ? (
              <Field label="Model override (optional)">
                <Dropdown
                  value={model || 'auto'}
                  selectedOptions={model ? [model] : []}
                  onOptionSelect={(_, data) => setModel(data.optionValue === 'auto' ? '' : data.optionValue ?? '')}
                >
                  <Option key="auto" value="auto" text="auto">auto (resolve from agent / project / default)</Option>
                  {models.map((m) => (
                    <Option key={m.id} value={m.id} text={m.id}>{m.id}</Option>
                  ))}
                </Dropdown>
              </Field>
            ) : (
              <Field label="Name (optional)">
                <Input
                  value={name}
                  onChange={(_, d) => setName(d.value)}
                  placeholder="auto-derived from first message"
                />
              </Field>
            )}

            {/* Name — full-width below the two-col row in agent mode */}
            {mode === 'agent' && (
              <Field label="Name (optional)" style={{ gridColumn: '1 / -1' }}>
                <Input
                  value={name}
                  onChange={(_, d) => setName(d.value)}
                  placeholder="auto-derived from first message"
                />
              </Field>
            )}
          </div>

          {/* Hero textarea — the focal point */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalXS, marginTop: tokens.spacingVerticalL }}>
            <Subtitle2>Open with…</Subtitle2>
            <Textarea
              value={firstMessage}
              onChange={(_, d) => setFirstMessage(d.value)}
              placeholder="What's on your mind? Paste a brief, ask a question, or describe a problem you want to think through together."
              rows={8}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: tokens.spacingHorizontalS }}>
            <Button
              appearance="primary"
              icon={<Send20Regular />}
              onClick={handleStart}
              disabled={
                startMut.isPending ||
                (!firstMessage.trim() && !(mode === 'agent' && Boolean(agentId)))
              }
            >
              {startMut.isPending ? 'Starting…' : 'Start conversation'}
            </Button>
          </div>

          {(startError || startMut.error) && (
            <MessageBar intent="error" politeness="assertive">
              <MessageBarBody>
                <MessageBarTitle>Couldn&apos;t start the conversation</MessageBarTitle>
                {startError ?? startMut.error?.message}
              </MessageBarBody>
            </MessageBar>
          )}
        </Card>
      </div>
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
  // Wave 10 B8: persist send failures inline so the user sees what went
  // wrong (oversized payload, transient 5xx, network drop) instead of the
  // page silently swallowing the error and stalling at "Sending…".
  const [sendError, setSendError] = useState<string | null>(null)
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

  // Thinking indicator: show when user has sent a message and no streaming content yet
  const isSessionActive = session.status === 'active' || session.status === 'idle'
  const lastMessage = session.messages[session.messages.length - 1]
  const showThinking =
    isSessionActive &&
    !streamingBuffer.content &&
    !streamingBuffer.reasoning &&
    lastMessage?.role === 'user'

  const handleSend = async () => {
    const text = draft.trim()
    if (!text) return
    setSendError(null)
    setDraft('')
    try {
      await sendMut.mutateAsync({ content: text })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // Restore the draft so the user doesn't lose what they typed.
      setDraft(text)
      setSendError(`Send failed: ${msg}`)
      console.error('send failed', err)
    }
  }

  const handleRetrySend = async () => {
    setSendError(null)
    if (!draft.trim()) return
    await handleSend()
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
          <ChatRowView
            key={row.key}
            row={row}
            sessionId={sessionId}
            agentName={session.agentName ?? (session.mode === 'agent' ? 'Agent' : 'Model')}
          />
        ))}
        {showThinking && (
          <ChatBubble
            role="agent"
            identity={{
              name: session.agentName ?? (session.mode === 'agent' ? 'Agent' : 'Model'),
              roleBadge: 'thinking',
            }}
            content=""
            streaming
          />
        )}
        <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', color: tokens.colorNeutralForeground3 }}>
          <Caption1>
            {session.messageCount} messages · {session.inputTokens.toLocaleString()} in / {session.outputTokens.toLocaleString()} out · ${parseFloat(session.costUsd).toFixed(4)}
          </Caption1>
        </div>
      </div>

      {/* W28 J5: collapsible "What context this agent has" panel */}
      <ContextPanel sessionId={sessionId} />

      <div className={styles.composer}>
        {sendError && (
          <MessageBar intent="error" politeness="assertive" style={{ marginBottom: '8px' }}>
            <MessageBarBody>
              <MessageBarTitle>Couldn&apos;t send your message</MessageBarTitle>
              {sendError}
            </MessageBarBody>
            <Button appearance="transparent" size="small" onClick={() => void handleRetrySend()}>
              Retry
            </Button>
            <Button appearance="transparent" size="small" onClick={() => setSendError(null)}>
              Dismiss
            </Button>
          </MessageBar>
        )}
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

function ChatRowView({ row, sessionId, agentName }: { row: ChatRow; sessionId: string; agentName: string }) {
  if (row.kind === 'message' && row.message) {
    const m = row.message
    if (m.role === 'tool') return null
    if (m.role === 'system') return null
    const isUser = m.role === 'user'
    return (
      <>
        {!isUser && m.reasoningContent && (
          <details style={{ alignSelf: 'flex-start', maxWidth: '85%', marginBottom: 0 }}>
            <summary style={{ cursor: 'pointer', fontSize: '11px', color: tokens.colorNeutralForeground3 }}>
              reasoning
            </summary>
            <Caption1 style={{ whiteSpace: 'pre-wrap', color: tokens.colorNeutralForeground3 }}>
              {m.reasoningContent}
            </Caption1>
          </details>
        )}
        <ChatBubble
          role={isUser ? 'user' : 'agent'}
          identity={{ name: isUser ? 'You' : agentName }}
          content={m.content}
        />
      </>
    )
  }
  if (row.kind === 'streaming') {
    return (
      <>
        {row.streamingReasoning && (
          <details style={{ alignSelf: 'flex-start', maxWidth: '85%' }}>
            <summary style={{ cursor: 'pointer', fontSize: '11px', color: tokens.colorNeutralForeground3 }}>
              reasoning…
            </summary>
            <Caption1 style={{ whiteSpace: 'pre-wrap', color: tokens.colorNeutralForeground3 }}>
              {row.streamingReasoning}
            </Caption1>
          </details>
        )}
        <ChatBubble
          role="agent"
          identity={{ name: agentName }}
          content={row.streamingText ?? ''}
          streaming
        />
      </>
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
          <Warning20Regular style={{ verticalAlign: 'middle', marginRight: '4px' }} />{proposal.errorMessage}
        </Caption1>
      )}
      {proposal.result && proposal.status !== 'pending' && (
        <Caption1 style={{ color: tokens.colorPaletteGreenForeground1 }}>
          <Checkmark20Regular style={{ verticalAlign: 'middle', marginRight: '4px' }} />{renderArtifactLink(proposal.result)}
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
