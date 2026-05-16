import { useState, useMemo } from 'react'
import { useParams, useNavigate, Link } from 'react-router'
import {
  Button,
  Card,
  Dropdown,
  Field,
  Input,
  Option,
  Spinner,
  Textarea,
  tokens,
  Title2,
  Body1,
  Body1Strong,
  Caption1,
  Badge,
} from '@fluentui/react-components'
import {
  Add20Regular,
  Send20Regular,
  Stop20Regular,
  Warning20Regular,
} from '@fluentui/react-icons'
import {
  useLiveSessions,
  useLiveSession,
  useStartLiveSession,
  useEndLiveSession,
  useSessionStream,
  type LiveSession as LiveSessionRow,
} from '../api/sessions.ts'
import { useAgents, useActiveAgents, useModels } from '../api/agents.ts'
import AgentActivityFeed from '../components/sessions/AgentActivityFeed.tsx'
import SessionSteeringBar from '../components/sessions/SessionSteeringBar.tsx'

export default function LiveSession() {
  const { id: projectId, sessionId: routeSessionId } = useParams<{
    id: string
    sessionId?: string
  }>()
  const navigate = useNavigate()

  const sessionsQuery = useLiveSessions(projectId ?? '')
  const activeSessionId = routeSessionId ?? null

  if (!projectId) return null

  return (
    <div
      style={{
        display: 'flex',
        flex: 1,
        minHeight: 0,
        height: '100%',
        background: tokens.colorNeutralBackground1,
      }}
    >
      <SessionList
        projectId={projectId}
        sessions={sessionsQuery.data ?? []}
        loading={sessionsQuery.isLoading}
        activeSessionId={activeSessionId}
        onSelect={(id) => navigate(`/projects/${projectId}/live/${id}`)}
        onNew={() => navigate(`/projects/${projectId}/live`)}
      />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {activeSessionId ? (
          <SessionView projectId={projectId} sessionId={activeSessionId} />
        ) : (
          <NewSessionView projectId={projectId} />
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Session list (left rail)
// ---------------------------------------------------------------------------

function SessionList({
  projectId,
  sessions,
  loading,
  activeSessionId,
  onSelect,
  onNew,
}: {
  projectId: string
  sessions: LiveSessionRow[]
  loading: boolean
  activeSessionId: string | null
  onSelect: (id: string) => void
  onNew: () => void
}) {
  void projectId
  return (
    <div
      style={{
        width: '280px',
        flexShrink: 0,
        borderRight: `1px solid ${tokens.colorNeutralStroke1}`,
        display: 'flex',
        flexDirection: 'column',
        background: tokens.colorNeutralBackground2,
      }}
    >
      <div
        style={{
          padding: '12px 16px',
          borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <Body1Strong>Sessions</Body1Strong>
        <Button
          size="small"
          appearance="primary"
          icon={<Add20Regular />}
          onClick={onNew}
        >
          New
        </Button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading && (
          <div style={{ padding: '16px', display: 'flex', justifyContent: 'center' }}>
            <Spinner size="tiny" />
          </div>
        )}
        {!loading && sessions.length === 0 && (
          <Body1
            style={{
              padding: '16px',
              color: tokens.colorNeutralForeground3,
              fontSize: '12px',
              textAlign: 'center',
            }}
          >
            No sessions yet.
          </Body1>
        )}
        {sessions.map((s) => (
          <button
            key={s.id}
            onClick={() => onSelect(s.id)}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              border: 'none',
              background:
                s.id === activeSessionId
                  ? tokens.colorNeutralBackground1Selected
                  : 'transparent',
              padding: '10px 16px',
              borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
              cursor: 'pointer',
              color: tokens.colorNeutralForeground1,
            }}
          >
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '4px' }}>
              <StatusBadge status={s.status} />
              <span
                style={{
                  fontSize: '13px',
                  fontWeight: tokens.fontWeightSemibold,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  flex: 1,
                  minWidth: 0,
                }}
              >
                {s.title || s.agentName || 'Untitled session'}
              </span>
            </div>
            <Caption1 style={{ color: tokens.colorNeutralForeground3, fontSize: '11px' }}>
              {s.model ?? 'auto'} · ${Number(s.costUsd ?? 0).toFixed(4)}
            </Caption1>
          </button>
        ))}
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: LiveSessionRow['status'] }) {
  const map = {
    active:    { color: 'success' as const,  label: 'live' },
    idle:      { color: 'informative' as const, label: 'idle' },
    completed: { color: 'subtle' as const,  label: 'done' },
    failed:    { color: 'danger' as const,  label: 'fail' },
    cancelled: { color: 'subtle' as const,  label: 'end' },
  }
  const { color, label } = map[status]
  return (
    <Badge appearance="filled" color={color} size="small">
      {label}
    </Badge>
  )
}

// ---------------------------------------------------------------------------
// New session creation
// ---------------------------------------------------------------------------

function NewSessionView({ projectId }: { projectId: string }) {
  const navigate = useNavigate()
  // Wave 10 B9: only active agents are pickable for a new live session.
  const agentsQuery = useActiveAgents(projectId)
  const modelsQuery = useModels()

  const [agentId, setAgentId] = useState<string | null>(null)
  const [model, setModel] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [prompt, setPrompt] = useState('')

  const startMutation = useStartLiveSession(projectId)

  const agents = agentsQuery.data ?? []
  const models = useMemo(() => modelsQuery.data ?? [], [modelsQuery.data])

  const selectedAgent = agents.find((a) => a.id === agentId) ?? null

  const onStart = async () => {
    if (!prompt.trim()) return
    const result = await startMutation.mutateAsync({
      agentId: agentId ?? undefined,
      agentName: selectedAgent?.name,
      model: model ?? undefined,
      prompt: prompt.trim(),
      title: title.trim() || undefined,
    })
    navigate(`/projects/${projectId}/live/${result.id}`)
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '32px', display: 'flex', justifyContent: 'center' }}>
      <Card style={{ maxWidth: '720px', width: '100%', padding: '28px' }}>
        <Title2 block>Start a live session</Title2>
        <Body1 block style={{ color: tokens.colorNeutralForeground3, marginTop: '4px', marginBottom: '24px' }}>
          Run an agent end-to-end with streamed output. Tokens and cost roll up automatically.
        </Body1>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <Field label="Agent">
            <Dropdown
              value={selectedAgent?.name ?? 'auto (no agent persona)'}
              selectedOptions={agentId ? [agentId] : ['__auto__']}
              onOptionSelect={(_, data) =>
                setAgentId(data.optionValue === '__auto__' ? null : (data.optionValue ?? null))
              }
            >
              <Option value="__auto__">auto (no agent persona)</Option>
              {agents.map((a) => (
                <Option key={a.id} value={a.id} text={a.name}>
                  {a.name} · {a.role}
                </Option>
              ))}
            </Dropdown>
          </Field>

          <Field label="Model">
            <Dropdown
              value={model ?? 'auto'}
              selectedOptions={model ? [model] : ['auto']}
              onOptionSelect={(_, data) =>
                setModel(data.optionValue === 'auto' ? null : (data.optionValue ?? null))
              }
            >
              {models.map((m) => (
                <Option key={m.id} value={m.id} text={m.label}>
                  {m.label}
                </Option>
              ))}
            </Dropdown>
          </Field>

          <Field label="Title (optional)">
            <Input
              value={title}
              onChange={(_, d) => setTitle(d.value)}
              placeholder="e.g. Refactor auth flow"
            />
          </Field>

          <Field label="First prompt">
            <Textarea
              value={prompt}
              onChange={(_, d) => setPrompt(d.value)}
              rows={6}
              placeholder="What should the agent work on?"
            />
          </Field>

          {startMutation.isError && (
            <Body1 style={{ color: tokens.colorPaletteRedForeground1, fontSize: '13px' }}>
              {(startMutation.error as Error)?.message ?? 'Failed to start session'}
            </Body1>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <Button
              appearance="primary"
              icon={<Send20Regular />}
              disabled={!prompt.trim() || startMutation.isPending}
              onClick={onStart}
            >
              {startMutation.isPending ? 'Starting…' : 'Start session'}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Active session view (transcript + input)
// ---------------------------------------------------------------------------

function SessionView({
  projectId,
  sessionId,
}: {
  projectId: string
  sessionId: string
}) {
  const navigate = useNavigate()
  const sessionQuery = useLiveSession(projectId, sessionId)
  const liveEntries = useSessionStream(projectId, sessionId)
  const endMutation = useEndLiveSession(projectId)
  const agentsQuery = useAgents(projectId)

  const session = sessionQuery.data
  const events = session?.events ?? []
  const isRunning =
    session?.status === 'active' || session?.status === 'idle' || session?.isRunning === true

  const onEnd = async () => {
    if (!confirm('End this session? The agent will be stopped.')) return
    await endMutation.mutateAsync(sessionId)
    navigate(`/projects/${projectId}/live`)
  }

  if (sessionQuery.isLoading) {
    return (
      <div style={{ display: 'flex', flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <Spinner label="Loading session…" />
      </div>
    )
  }

  if (!session) {
    return (
      <div style={{ padding: '32px', textAlign: 'center' }}>
        <Body1>Session not found.</Body1>{' '}
        <Link to={`/projects/${projectId}/live`}>Start a new one</Link>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {/* Header */}
      <div
        style={{
          padding: '12px 20px',
          borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
        }}
      >
        <StatusBadge status={session.status} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: '14px',
              fontWeight: tokens.fontWeightSemibold,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {session.title || session.agentName || 'Untitled session'}
          </div>
          <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>
            {session.agentName ? `${session.agentName} · ` : ''}
            <span title="Resolved via: agent → project → fallback">
              {session.model ?? '(resolving…)'}
            </span>
            {' · '}{session.turnCount} turns ·{' '}
            {(session.inputTokens + session.outputTokens).toLocaleString()} tokens · $
            {Number(session.costUsd ?? 0).toFixed(4)}
          </Caption1>
        </div>
        {isRunning && (
          <Button
            size="small"
            appearance="secondary"
            icon={<Stop20Regular />}
            onClick={onEnd}
            disabled={endMutation.isPending}
          >
            End session
          </Button>
        )}
      </div>

      {/* Feed */}
      <AgentActivityFeed
        initialEvents={events}
        liveEntries={liveEntries}
        agentName={session.agentName}
        agents={agentsQuery.data}
      />

      {/* Steering bar (composer + interrupt/handoff/invite) */}
      <div>
        {session.errorMessage && (
          <Body1
            style={{
              color: tokens.colorPaletteRedForeground1,
              fontSize: '12px',
              padding: '8px 20px 0',
            }}
          >
            <Warning20Regular style={{ verticalAlign: 'middle', marginRight: '4px' }} />{session.errorMessage}
          </Body1>
        )}
        <SessionSteeringBar
          projectId={projectId}
          sessionId={sessionId}
          isRunning={isRunning}
        />
      </div>
    </div>
  )
}
