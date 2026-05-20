import { useMemo } from 'react'
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router'
import {
  Badge,
  Body1,
  Button,
  Caption1,
  MessageBar,
  MessageBarBody,
  Subtitle1,
  Subtitle2,
  tokens,
  type BadgeProps,
} from '@fluentui/react-components'
import { ArrowClockwise20Regular, ArrowLeft20Regular, Open20Regular, Play16Regular } from '@fluentui/react-icons'
import { useProject } from '../api/projects.ts'
import { useCeremonyRuns, type CeremonyRunEvent, type CeremonyRunStep, type CeremonyRunSummary } from '../api/ceremonies.ts'
import PageHeader from '../components/layout/PageHeader.tsx'
import { PageLoading } from '../components/loading/index.tsx'
import { safeAbsoluteTime, safeRelativeTime } from '../utils/dates.ts'
import { issueRunLivePath } from '../utils/ceremonyRoutes.ts'

type BadgeColor = NonNullable<BadgeProps['color']>

function shortId(id: string): string {
  return id.slice(0, 8)
}

function statusColor(status: string | null | undefined): BadgeColor {
  switch (status) {
    case 'completed':
      return 'success'
    case 'failed':
      return 'danger'
    case 'cancelled':
      return 'subtle'
    case 'running':
    case 'splitting':
    case 'waiting_children':
      return 'informative'
    case 'pending':
      return 'warning'
    default:
      return 'subtle'
  }
}

function payloadPreview(payload: Record<string, unknown>): string {
  const text = JSON.stringify(payload)
  if (!text || text === '{}') return ''
  return text.length > 180 ? `${text.slice(0, 177)}...` : text
}

function eventSummary(event: CeremonyRunEvent): string {
  const p = event.payload ?? {}
  switch (event.eventType) {
    case 'issue.run.start':
      return `Started${typeof p.agentName === 'string' ? ` - ${p.agentName}` : ''}`
    case 'issue.run.turn':
      return `Agent turn${typeof p.role === 'string' ? ` - ${p.role}` : ''}`
    case 'issue.run.tool_call':
      return `Tool call${typeof p.toolName === 'string' ? ` - ${p.toolName}` : ''}`
    case 'issue.run.tool_result':
      return `Tool result${typeof p.toolName === 'string' ? ` - ${p.toolName}` : ''}`
    case 'issue.run.token':
      return `Tokens in ${String(p.inputTokens ?? 0)}, out ${String(p.outputTokens ?? 0)}`
    case 'issue.run.finish':
      return 'Finished'
    case 'issue.run.error':
      return `Error${typeof p.message === 'string' ? ` - ${p.message}` : ''}`
    case 'issue.run.steered':
      return `Steered${typeof p.actor === 'string' ? ` by ${p.actor}` : ''}`
    default:
      return event.eventType
  }
}

function triggerSourceLabel(source: Record<string, unknown> | null): string {
  if (!source) return 'Unknown trigger'
  const kind = typeof source.kind === 'string' ? source.kind : 'unknown'
  if (kind === 'manual') return 'Manual run'
  if (kind === 'schedule') return 'Scheduled run'
  if (kind === 'event') {
    return typeof source.eventType === 'string' ? `Event: ${source.eventType}` : 'Event run'
  }
  if (kind === 'agent-signal') {
    return typeof source.signalName === 'string' ? `Agent signal: ${source.signalName}` : 'Agent signal'
  }
  if (typeof source.detail === 'string') return `${kind}: ${source.detail}`
  return kind
}

export default function CeremonyRuns() {
  const { id: projectId = '', ceremonyId = '' } = useParams<{ id: string; ceremonyId: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { data: project } = useProject(projectId)
  const { data, isLoading, isError, refetch } = useCeremonyRuns(projectId, ceremonyId)
  const focusedRunId = searchParams.get('run')
  const ceremonyPath = `/projects/${projectId}/ceremonies/${ceremonyId}`

  const runs = useMemo(() => {
    if (!data?.runs || !focusedRunId) return data?.runs ?? []
    return [...data.runs].sort((a, b) => {
      if (a.id === focusedRunId) return -1
      if (b.id === focusedRunId) return 1
      return 0
    })
  }, [data?.runs, focusedRunId])

  if (!projectId || !ceremonyId) return <Navigate to="/" replace />

  const toolbar = (
    <div style={{ display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalS }}>
      <Button
        appearance="subtle"
        icon={<ArrowLeft20Regular />}
        onClick={() => navigate(ceremonyPath)}
      >
        Ceremony
      </Button>
      <Button
        appearance="secondary"
        icon={<ArrowClockwise20Regular />}
        onClick={() => void refetch()}
      >
        Refresh
      </Button>
    </div>
  )

  if (isLoading) {
    return (
      <PageLoading
        header={
          <PageHeader
            eyebrow={project?.name?.toUpperCase()}
            title="Ceremony runs"
            description="Execution history and logs for one ceremony."
            actions={toolbar}
          />
        }
        label="Loading ceremony runs..."
      />
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%', background: tokens.colorNeutralBackground1 }}>
      <PageHeader
        eyebrow={project?.name?.toUpperCase()}
        title={data?.ceremony.name ? `${data.ceremony.name} runs` : 'Ceremony runs'}
        description="Each execution is listed with its trigger, workflow steps, linked agent run events, output, and errors."
        actions={toolbar}
      />

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: tokens.spacingVerticalL,
          padding: `${tokens.spacingVerticalL} ${tokens.spacingHorizontalXXL} ${tokens.spacingVerticalXXL}`,
        }}
      >
        {isError && (
          <MessageBar intent="error">
            <MessageBarBody>Failed to load ceremony runs. Try refresh or check the server logs.</MessageBarBody>
          </MessageBar>
        )}

        {!isError && runs.length === 0 && (
          <div
            role="region"
            aria-labelledby="ceremony-runs-empty-heading"
            style={{
              alignSelf: 'center',
              width: '100%',
              maxWidth: 520,
              boxSizing: 'border-box',
              display: 'grid',
              justifyItems: 'center',
              gap: tokens.spacingVerticalM,
              border: `1px solid ${tokens.colorNeutralStroke2}`,
              borderRadius: tokens.borderRadiusXLarge,
              background: tokens.colorNeutralBackground2,
              boxShadow: tokens.shadow4,
              padding: `${tokens.spacingVerticalXXL} ${tokens.spacingHorizontalXXL}`,
              textAlign: 'center',
            }}
          >
            <Subtitle1
              as="h2"
              id="ceremony-runs-empty-heading"
              style={{ margin: 0, color: tokens.colorNeutralForeground1 }}
            >
              No runs yet
            </Subtitle1>
            <Body1
              as="p"
              style={{
                display: 'block',
                maxWidth: 460,
                margin: 0,
                color: tokens.colorNeutralForeground3,
              }}
            >
              Open the ceremony and choose Run now, or wait for a schedule, event, or agent signal.
              Once it starts, trigger details, step output, errors, and linked agent event logs will appear here.
            </Body1>
            <Button
              appearance="primary"
              icon={<Play16Regular />}
              onClick={() => navigate(ceremonyPath)}
            >
              Open ceremony to run
            </Button>
          </div>
        )}

        {runs.map((run) => (
          <RunCard
            key={run.id}
            projectId={projectId}
            run={run}
            highlighted={focusedRunId === run.id}
            onOpenLive={(issueRunId) => navigate(issueRunLivePath(projectId, run.issueId, issueRunId))}
          />
        ))}
      </div>
    </div>
  )
}

function RunCard({
  projectId,
  run,
  highlighted,
  onOpenLive,
}: {
  projectId: string
  run: CeremonyRunSummary
  highlighted: boolean
  onOpenLive: (issueRunId: string) => void
}) {
  return (
    <section
      style={{
        border: `1px solid ${highlighted ? tokens.colorBrandStroke1 : tokens.colorNeutralStroke2}`,
        borderRadius: tokens.borderRadiusLarge,
        background: tokens.colorNeutralBackground2,
        boxShadow: highlighted ? tokens.shadow8 : undefined,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: tokens.spacingHorizontalM,
          padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL}`,
          borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalS, flexWrap: 'wrap' }}>
            <Subtitle2>Run {shortId(run.id)}</Subtitle2>
            <Badge color={statusColor(run.status)} appearance="filled">{run.status}</Badge>
            {run.workflowVersionNumber != null && (
              <Badge appearance="outline" color="subtle">v{run.workflowVersionNumber}</Badge>
            )}
          </div>
          <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>
            {triggerSourceLabel(run.triggerSource)} - {safeRelativeTime(run.createdAt)}
            {' '}({safeAbsoluteTime(run.createdAt)})
          </Caption1>
        </div>
        <div style={{ textAlign: 'right', color: tokens.colorNeutralForeground3, fontSize: 12 }}>
          <div>{run.steps.length} step{run.steps.length === 1 ? '' : 's'}</div>
          <div>Project {shortId(projectId)}</div>
        </div>
      </div>

      <div style={{ padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL}`, display: 'grid', gap: tokens.spacingVerticalM }}>
        <div style={{ color: tokens.colorNeutralForeground2, fontSize: 13 }}>
          Anchor issue:{' '}
          <strong style={{ color: tokens.colorNeutralForeground1 }}>
            {run.issueTitle ?? shortId(run.issueId)}
          </strong>
          {run.issueStatus && <span style={{ color: tokens.colorNeutralForeground3 }}> - {run.issueStatus}</span>}
        </div>

        {run.steps.length === 0 ? (
          <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>
            No step records have been created for this run yet.
          </Caption1>
        ) : (
          run.steps.map((step) => (
            <StepLog key={step.id} step={step} onOpenLive={onOpenLive} />
          ))
        )}
      </div>
    </section>
  )
}

function StepLog({ step, onOpenLive }: { step: CeremonyRunStep; onOpenLive: (issueRunId: string) => void }) {
  const output = step.issueRunOutput || step.output

  return (
    <div
      style={{
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        borderRadius: tokens.borderRadiusMedium,
        background: tokens.colorNeutralBackground1,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: tokens.spacingHorizontalS,
          padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
          borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
        }}
      >
        <Badge color={statusColor(step.issueRunStatus ?? step.status)} appearance="filled">
          {step.issueRunStatus ?? step.status}
        </Badge>
        <Body1 style={{ fontWeight: tokens.fontWeightSemibold, flex: 1 }}>
          Step {step.stepIndex + 1}: {step.stepType}
        </Body1>
        {step.agentName && (
          <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>
            {step.agentName}
          </Caption1>
        )}
        {step.issueRunId && (
          <Button
            appearance="subtle"
            size="small"
            icon={<Open20Regular />}
            onClick={() => onOpenLive(step.issueRunId!)}
          >
            Open live log
          </Button>
        )}
      </div>

      <div style={{ padding: tokens.spacingHorizontalM, display: 'grid', gap: tokens.spacingVerticalS }}>
        {step.issueRunError && (
          <MessageBar intent="error">
            <MessageBarBody>{step.issueRunError}</MessageBarBody>
          </MessageBar>
        )}
        {step.reviewDecision && (
          <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>
            Review: {step.reviewDecision}{step.reviewComment ? ` - ${step.reviewComment}` : ''}
          </Caption1>
        )}
        {output && (
          <pre
            style={{
              margin: 0,
              padding: tokens.spacingHorizontalS,
              background: tokens.colorNeutralBackground3,
              borderRadius: tokens.borderRadiusMedium,
              color: tokens.colorNeutralForeground2,
              fontSize: 12,
              whiteSpace: 'pre-wrap',
              maxHeight: 180,
              overflow: 'auto',
            }}
          >
            {output}
          </pre>
        )}
        {step.events.length > 0 ? (
          <div role="log" aria-label={`Step ${step.stepIndex + 1} event log`} style={{ display: 'grid', gap: 4 }}>
            {step.events.map((event) => (
              <div
                key={`${event.runId}:${event.seq}`}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '88px 180px 1fr',
                  gap: tokens.spacingHorizontalS,
                  fontSize: 12,
                  color: tokens.colorNeutralForeground2,
                }}
              >
                <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>{safeRelativeTime(event.createdAt)}</Caption1>
                <span>{eventSummary(event)}</span>
                <span style={{ color: tokens.colorNeutralForeground3 }}>{payloadPreview(event.payload)}</span>
              </div>
            ))}
          </div>
        ) : (
          <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>
            No persisted agent events for this step yet.
          </Caption1>
        )}
      </div>
    </div>
  )
}
