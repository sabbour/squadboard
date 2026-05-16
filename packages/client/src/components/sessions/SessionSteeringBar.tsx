import { useState } from 'react'
import { Body1, Button, Caption1, Textarea, tokens } from '@fluentui/react-components'
import {
  Send20Regular,
  Stop20Regular,
  ArrowSwap20Regular,
  PersonAdd20Regular,
  Warning20Regular,
  Dismiss20Regular,
} from '@fluentui/react-icons'
import { useActiveAgents, type Agent } from '../../api/agents.ts'
import {
  useInjectMessage,
  useInterruptSession,
  useHandoffSession,
  useInviteAgent,
} from '../../api/session-steering.ts'

interface SessionSteeringBarProps {
  projectId: string
  sessionId: string
  isRunning: boolean
}

type PickerMode = null | 'handoff' | 'invite'

export default function SessionSteeringBar({
  projectId,
  sessionId,
  isRunning,
}: SessionSteeringBarProps) {
  const [draft, setDraft] = useState('')
  const [picker, setPicker] = useState<PickerMode>(null)
  const [interruptResult, setInterruptResult] = useState<{
    honoured: boolean
    reason?: string
  } | null>(null)
  const [steerError, setSteerError] = useState<string | null>(null)

  // Wave 10 B9: handoff / invite pickers must surface only active agents.
  const { data: agents = [] } = useActiveAgents(projectId)
  const inject = useInjectMessage(projectId, sessionId)
  const interrupt = useInterruptSession(projectId, sessionId)
  const handoff = useHandoffSession(projectId, sessionId)
  const invite = useInviteAgent(projectId, sessionId)

  const sendDisabled = !isRunning || !draft.trim() || inject.isPending
  const steerDisabled = !isRunning

  async function onSend() {
    const txt = draft.trim()
    if (!txt) return
    setDraft('')
    setSteerError(null)
    try {
      await inject.mutateAsync({ prompt: txt })
    } catch (e) {
      setSteerError((e as Error)?.message ?? 'Failed to send message')
    }
  }

  async function onInterrupt() {
    setSteerError(null)
    setInterruptResult(null)
    try {
      const result = await interrupt.mutateAsync(undefined)
      setInterruptResult({ honoured: result.honoured, reason: result.reason })
    } catch (e) {
      setSteerError((e as Error)?.message ?? 'Failed to interrupt')
    }
  }

  async function onHandoff(agent: Agent) {
    setSteerError(null)
    setPicker(null)
    try {
      await handoff.mutateAsync({ toAgentId: agent.id })
    } catch (e) {
      setSteerError((e as Error)?.message ?? 'Failed to hand off')
    }
  }

  async function onInvite(agent: Agent) {
    setSteerError(null)
    setPicker(null)
    try {
      await invite.mutateAsync({ agentId: agent.id })
    } catch (e) {
      setSteerError((e as Error)?.message ?? 'Failed to invite')
    }
  }

  function togglePicker(mode: 'handoff' | 'invite') {
    setSteerError(null)
    setPicker((p) => (p === mode ? null : mode))
  }

  return (
    <div
      style={{
        padding: '12px 20px',
        borderTop: `1px solid ${tokens.colorNeutralStroke1}`,
        background: tokens.colorNeutralBackground1,
        position: 'relative',
      }}
    >
      {/* Steering result banner */}
      {(interruptResult || steerError) && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '8px',
            marginBottom: '8px',
            padding: '6px 10px',
            background: steerError
              ? tokens.colorPaletteRedBackground1
              : interruptResult?.honoured
                ? tokens.colorPaletteGreenBackground1
                : tokens.colorPaletteYellowBackground1,
            border: `1px solid ${
              steerError
                ? tokens.colorPaletteRedBorder1
                : interruptResult?.honoured
                  ? tokens.colorPaletteGreenBorder1
                  : tokens.colorPaletteYellowBorder1
            }`,
            borderRadius: '6px',
            fontSize: '12px',
            color: steerError
              ? tokens.colorPaletteRedForeground1
              : interruptResult?.honoured
                ? tokens.colorPaletteGreenForeground1
                : tokens.colorPaletteYellowForeground1,
          }}
        >
          <span>
            {steerError
              ? <><Warning20Regular style={{ verticalAlign: 'middle', marginRight: '4px' }} />{steerError}</>
              : interruptResult?.honoured
                ? `⏹ Interrupt honoured${interruptResult.reason ? ` — ${interruptResult.reason}` : ''}`
                : `⏹ Interrupt requested but not honoured${interruptResult?.reason ? ` — ${interruptResult.reason}` : ''}`}
          </span>
          <button
            type="button"
            onClick={() => {
              setInterruptResult(null)
              setSteerError(null)
            }}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'inherit',
              cursor: 'pointer',
              fontSize: '12px',
              opacity: 0.7,
            }}
          >
            <Dismiss20Regular />
          </button>
        </div>
      )}

      {/* Composer + Send */}
      <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
        <Textarea
          value={draft}
          onChange={(_, d) => setDraft(d.value)}
          rows={2}
          disabled={!isRunning || inject.isPending}
          placeholder={isRunning ? 'Send another prompt…' : 'Session is no longer active.'}
          style={{ flex: 1 }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              void onSend()
            }
          }}
        />
        <Button
          appearance="primary"
          icon={<Send20Regular />}
          disabled={sendDisabled}
          onClick={onSend}
        >
          Send
        </Button>
      </div>

      {/* Steering action row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          marginTop: '8px',
          flexWrap: 'wrap',
        }}
      >
        <Button
          size="small"
          appearance="secondary"
          icon={<Stop20Regular />}
          disabled={!isRunning || interrupt.isPending}
          onClick={onInterrupt}
        >
          Interrupt
        </Button>
        <Button
          size="small"
          appearance="secondary"
          icon={<ArrowSwap20Regular />}
          disabled={steerDisabled || handoff.isPending}
          onClick={() => togglePicker('handoff')}
        >
          Hand off
        </Button>
        <Button
          size="small"
          appearance="secondary"
          icon={<PersonAdd20Regular />}
          disabled={steerDisabled || invite.isPending}
          onClick={() => togglePicker('invite')}
        >
          Invite
        </Button>
        <Caption1 style={{ color: tokens.colorNeutralForeground3, marginLeft: 'auto' }}>
          Cmd/Ctrl+Enter to send.
        </Caption1>
      </div>

      {/* Picker dropdown */}
      {picker && (
        <div
          style={{
            position: 'absolute',
            bottom: '100%',
            left: '20px',
            right: '20px',
            zIndex: 12,
            background: tokens.colorNeutralBackground1,
            border: `1px solid ${tokens.colorNeutralStroke1}`,
            borderRadius: '6px',
            boxShadow: tokens.shadow28,
            marginBottom: '6px',
            maxHeight: '260px',
            overflowY: 'auto',
            padding: '6px',
          }}
        >
          <div
            style={{
              fontSize: '11px',
              color: tokens.colorNeutralForeground3,
              padding: '4px 8px 6px',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              fontWeight: 600,
            }}
          >
            {picker === 'handoff' ? 'Hand off to…' : 'Invite agent…'}
          </div>
          {agents.length === 0 && (
            <Body1
              style={{
                fontSize: '12px',
                color: tokens.colorNeutralForeground3,
                padding: '8px 10px',
              }}
            >
              No agents available in this project.
            </Body1>
          )}
          {agents.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => (picker === 'handoff' ? onHandoff(a) : onInvite(a))}
              disabled={
                (picker === 'handoff' ? handoff.isPending : invite.isPending) || !isRunning
              }
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                background: 'transparent',
                border: 'none',
                padding: '8px 10px',
                borderRadius: '4px',
                color: tokens.colorNeutralForeground1,
                fontSize: '13px',
                cursor: 'pointer',
              }}
              onMouseEnter={(e) => {
                ;(e.currentTarget as HTMLButtonElement).style.background =
                  tokens.colorNeutralBackground1Hover
              }}
              onMouseLeave={(e) => {
                ;(e.currentTarget as HTMLButtonElement).style.background = 'transparent'
              }}
            >
              <div style={{ fontWeight: 600 }}>@{a.name}</div>
              <div style={{ fontSize: '11px', color: tokens.colorNeutralForeground3 }}>{a.role}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
