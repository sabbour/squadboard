import { useState, type CSSProperties, type ReactNode } from 'react'
import {
  Body1,
  Button,
  Caption1,
  Spinner,
  Subtitle2,
  tokens,
} from '@fluentui/react-components'
import {
  ArrowSync20Regular,
  CheckmarkCircle20Regular,
  ErrorCircle20Regular,
  Warning20Regular,
  Wrench20Regular,
} from '@fluentui/react-icons'
import { SectionLoading } from '../loading/index.tsx'
import {
  useRepairSquadSync,
  useSquadSyncStatus,
  type SquadSyncArtifactRequirement,
  type SquadSyncCheckStatus,
  type SquadSyncRepairAction,
  type SquadSyncStatus,
} from '../../api/squad.ts'

type Tone = 'success' | 'warning' | 'danger' | 'neutral'

interface NormalizedArtifact {
  id: string
  label: string
  path: string
  status: SquadSyncCheckStatus
  requirement: SquadSyncArtifactRequirement
  purpose?: string
}

interface NormalizedRepairAction {
  id: SquadSyncRepairAction
  requestId: SquadSyncRepairAction
  label: string
  reason: string
  disabledReason?: string
}

interface NormalizedStatus {
  sourceOfTruth: string
  storageMode: string
  storageDetail: string
  compatibilityTone: Tone
  compatibilityTitle: string
  compatibilityMessage: string
  requiredArtifacts: NormalizedArtifact[]
  recommendedArtifacts: NormalizedArtifact[]
  ceremoniesTitle: string
  ceremoniesMessage: string
  ceremoniesTone: Tone
  driftTitle: string
  driftMessage: string
  driftTone: Tone
  repairAvailable: boolean
  repairDisabledReason?: string
  repairActions: NormalizedRepairAction[]
  checkedAt?: string
  contractVersion?: string
}

const ARTIFACT_LABELS: Record<string, string> = {
  squadDir: '.squad root',
  agentsDir: 'Agent charters',
  decisionsInboxDir: 'Decision inbox',
  teamMd: 'Team roster',
  routingMd: 'Routing rules',
  decisionsMd: 'Decision log',
  ceremoniesMd: 'Ceremony index',
  ceremoniesDefaultsPresent: 'Ceremony defaults',
  copilotAgentMd: 'CLI/Copilot agent file',
}

const ACTION_LABELS: Record<string, string> = {
  project_governance: 'Repair project governance',
  'repair-scaffold-squad': 'Repair .squad scaffold',
  ceremony_defaults: 'Seed ceremony defaults',
  'seed-ceremony-defaults': 'Seed ceremony defaults',
  agent_files: 'Generate CLI/Copilot agent file',
  'project-copilot-agent-file': 'Generate CLI/Copilot agent file',
  'generate-github-agent': 'Generate CLI/Copilot agent file',
  'generate-client-artifact': 'Generate CLI/Copilot agent file',
  'project-squad-to-fs': 'Push Squad state to filesystem',
  rescan_drift: 'Rescan drift',
  'rescan-drift': 'Rescan drift',
  'expose-sync-status-api': 'Backend status API work',
}

const TONE_STYLES: Record<Tone, { color: string; background: string; border: string }> = {
  success: {
    color: '#3fb950',
    background: 'rgba(63,185,80,0.12)',
    border: 'rgba(63,185,80,0.36)',
  },
  warning: {
    color: '#d29922',
    background: 'rgba(210,153,34,0.12)',
    border: 'rgba(210,153,34,0.36)',
  },
  danger: {
    color: '#f85149',
    background: 'rgba(248,81,73,0.12)',
    border: 'rgba(248,81,73,0.36)',
  },
  neutral: {
    color: 'var(--text-muted)',
    background: 'var(--bg)',
    border: 'var(--border)',
  },
}

const cardStyle: CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: '8px',
  padding: '14px 16px',
}

function toCheckStatus(status: string | undefined): SquadSyncCheckStatus {
  if (status === 'present' || status === 'ok' || status === 'ready') return 'ok'
  if (status === 'missing') return 'missing'
  if (status === 'partial') return 'partial'
  if (status === 'drifted') return 'drifted'
  return 'unknown'
}

function statusTone(status: SquadSyncCheckStatus): Tone {
  if (status === 'ok') return 'success'
  if (status === 'missing' || status === 'drifted') return 'danger'
  if (status === 'partial') return 'warning'
  return 'neutral'
}

function formatStatus(status: SquadSyncCheckStatus): string {
  if (status === 'ok') return 'Present'
  if (status === 'missing') return 'Missing'
  if (status === 'partial') return 'Partial'
  if (status === 'drifted') return 'Drifted'
  return 'Unknown'
}

function sourceLabel(authority: string | undefined): string {
  if (authority === 'squad_storage') return 'Squadboard database'
  if (authority === 'filesystem') return 'Filesystem .squad'
  if (authority === 'mcp_broker') return 'MCP broker'
  return 'Unknown'
}

function storageLabel(mode: string | undefined): string {
  if (mode === 'postgresql') return 'PostgreSQL-backed'
  if (mode === 'filesystem') return 'Filesystem-backed'
  return 'Unknown'
}

function repairRequestId(id: SquadSyncRepairAction): SquadSyncRepairAction {
  if (id === 'project_governance') return 'repair-scaffold-squad'
  if (id === 'ceremony_defaults') return 'seed-ceremony-defaults'
  if (id === 'agent_files') return 'generate-github-agent'
  if (id === 'generate-client-artifact') return 'generate-github-agent'
  return id
}

function browserDisabledRepairReason(id: SquadSyncRepairAction): string | undefined {
  if (id === 'expose-sync-status-api') {
    return 'This is backend implementation work, not a browser repair.'
  }
  if (id === 'rescan_drift' || id === 'rescan-drift') {
    return 'Use Refresh to rescan; no separate repair mutation is available yet.'
  }
  return undefined
}

export function normalizeSquadSyncStatus(status: SquadSyncStatus): NormalizedStatus {
  const serverArtifacts = status.projection?.artifacts ?? []
  const governanceFiles = status.governance?.files ?? []
  const artifacts: NormalizedArtifact[] = serverArtifacts.length > 0
    ? serverArtifacts.map((artifact) => ({
      id: artifact.id,
      label: ARTIFACT_LABELS[artifact.id] ?? artifact.path,
      path: artifact.path,
      status: toCheckStatus(artifact.status),
      requirement: artifact.requirement,
      purpose: artifact.purpose,
    }))
    : governanceFiles.map((file) => ({
      id: file.label || file.path,
      label: file.label,
      path: file.path,
      status: file.status,
      requirement: file.requirement ?? (file.required ? 'required' : 'recommended'),
      purpose: file.message,
    }))

  const requiredArtifacts = artifacts.filter((artifact) => artifact.requirement === 'required')
  const recommendedArtifacts = artifacts.filter((artifact) => artifact.requirement === 'recommended')
  const requiredGaps = requiredArtifacts.filter((artifact) => artifact.status !== 'ok')
  const recommendedGaps = recommendedArtifacts.filter((artifact) => artifact.status !== 'ok')
  const source = status.authority?.sourceOfTruth ?? status.storage?.authority ?? status.sourceOfTruth ?? 'unknown'
  const mode = status.authority?.storageMode ?? status.storage?.mode ?? status.storageMode ?? 'unknown'

  const storageDetail = status.authority?.runtime?.note
    ?? status.authority?.sharedExternalAccess
    ?? status.storage?.sharedExternalAccess
    ?? (status.databaseRuntime && status.databaseRuntime !== 'unknown'
      ? `Runtime: ${status.databaseRuntime}`
      : 'Runtime evidence not reported yet.')

  const ceremonyFile = artifacts.find((artifact) => artifact.id === 'ceremoniesMd')
  const ceremonyDefaults = artifacts.find((artifact) => artifact.id === 'ceremoniesDefaultsPresent')
  const ceremonyStatus = status.ceremonies?.status
    ?? toCheckStatus(ceremonyDefaults?.status ?? ceremonyFile?.status)
  const defaultsPresent = status.ceremonies?.defaultsPresent
    ?? (ceremonyDefaults ? ceremonyDefaults.status === 'ok' : null)
  const ceremonyCount = status.ceremonies?.count
  const ceremoniesTitle = defaultsPresent === true
    ? 'Ceremony defaults ready'
    : defaultsPresent === false
      ? 'Ceremony defaults need repair'
      : 'Ceremony defaults unknown'
  const ceremoniesMessage = [
    ceremonyCount != null ? `${ceremonyCount} ceremonies reported.` : null,
    status.ceremonies?.filePath ?? ceremonyFile?.path ?? null,
    defaultsPresent === false ? 'Seed non-placeholder defaults before cross-client handoff.' : null,
  ].filter(Boolean).join(' ')

  const driftDetected = status.drift?.detected === true
    || status.drift?.status === 'detected'
    || status.summary?.status === 'drifted'
  const blockingDrift = status.drift?.level === 'error' || status.summary?.status === 'drifted'
  const driftTone: Tone = status.drift?.level === 'error'
    ? 'danger'
    : status.drift?.level === 'warning'
      ? 'warning'
      : driftDetected
    ? 'danger'
    : requiredGaps.length > 0
      ? 'warning'
      : 'neutral'
  const driftTitle = driftDetected
    ? 'Drift detected'
    : requiredGaps.length > 0 || recommendedGaps.length > 0
      ? 'Projection gaps found'
      : 'No projection gaps reported'
  const driftMessage = status.drift?.message
    ?? status.drift?.summary
    ?? (requiredGaps.length > 0 || recommendedGaps.length > 0
      ? `${requiredGaps.length} required and ${recommendedGaps.length} recommended artifact gaps are reported. Drift hashes are not exposed yet.`
      : 'Required artifacts are present. Drift hashes are not exposed yet.')

  const hasEvidence = artifacts.length > 0 || Boolean(status.summary)
  const compatibilityTone: Tone = blockingDrift || requiredGaps.length > 0
    ? 'danger'
    : driftDetected || recommendedGaps.length > 0
      ? 'warning'
      : hasEvidence
        ? 'success'
        : 'neutral'
  const compatibilityTitle = compatibilityTone === 'success'
    ? 'Ready for Squadboard ↔ CLI/Copilot'
    : compatibilityTone === 'warning'
      ? 'Usable, but CLI/Copilot needs repair'
      : compatibilityTone === 'danger'
        ? 'Not ready for peer clients'
        : 'Sync status unknown'
  const compatibilityMessage = status.summary?.message
    ?? (mode === 'postgresql'
      ? 'Squadboard owns the database authority; CLI/Copilot should continue through the generated agent file and MCP/API broker.'
      : mode === 'filesystem'
        ? 'Filesystem .squad is the authority; Squadboard and CLI/Copilot must both write through that filesystem state.'
        : 'The backend has not reported enough evidence to confirm cross-client compatibility.')

  const actions = new Map<string, NormalizedRepairAction>()
  for (const action of status.repair?.actions ?? []) {
    const actionId = typeof action === 'string' ? action : action.id
    const unavailable = typeof action === 'string' ? false : action.available === false
    actions.set(actionId, {
      id: actionId,
      requestId: repairRequestId(actionId),
      label: ACTION_LABELS[actionId] ?? actionId,
      reason: typeof action === 'string'
        ? 'Backend reported this repair as available.'
        : action.reason,
      disabledReason: browserDisabledRepairReason(actionId)
        ?? (unavailable
        ? 'Backend marked this repair unavailable.'
        : undefined),
    })
  }
  for (const action of status.repairActions ?? []) {
    actions.set(action.id, {
      id: action.id,
      requestId: repairRequestId(action.id),
      label: ACTION_LABELS[action.id] ?? action.id,
      reason: action.reason,
      disabledReason: browserDisabledRepairReason(action.id),
    })
  }

  const repairActions = [...actions.values()]
  const repairAvailable = status.repair?.available ?? repairActions.some((action) => !action.disabledReason)

  return {
    sourceOfTruth: sourceLabel(source),
    storageMode: storageLabel(mode),
    storageDetail,
    compatibilityTone,
    compatibilityTitle,
    compatibilityMessage,
    requiredArtifacts,
    recommendedArtifacts,
    ceremoniesTitle,
    ceremoniesMessage: ceremoniesMessage || 'No ceremony detail reported.',
    ceremoniesTone: statusTone(ceremonyStatus),
    driftTitle,
    driftMessage,
    driftTone,
    repairAvailable,
    repairDisabledReason: status.repair?.disabledReason ?? undefined,
    repairActions,
    checkedAt: status.checkedAt,
    contractVersion: status.contractVersion,
  }
}

function ToneIcon({ tone }: { tone: Tone }) {
  const style = { color: TONE_STYLES[tone].color, flexShrink: 0 }
  if (tone === 'success') return <CheckmarkCircle20Regular style={style} />
  if (tone === 'danger') return <ErrorCircle20Regular style={style} />
  if (tone === 'warning') return <Warning20Regular style={style} />
  return <ArrowSync20Regular style={style} />
}

function StatusPill({ tone, children }: { tone: Tone; children: ReactNode }) {
  const toneStyle = TONE_STYLES[tone]
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        border: `1px solid ${toneStyle.border}`,
        background: toneStyle.background,
        color: toneStyle.color,
        borderRadius: '999px',
        padding: '3px 9px',
        fontSize: '12px',
        fontWeight: tokens.fontWeightSemibold,
        whiteSpace: 'nowrap',
      }}
    >
      <ToneIcon tone={tone} />
      {children}
    </span>
  )
}

function FactCard({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div style={{ ...cardStyle, minWidth: 220, flex: '1 1 220px' }}>
      <Caption1
        style={{
          display: 'block',
          color: tokens.colorNeutralForeground3,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          fontWeight: tokens.fontWeightSemibold,
        }}
      >
        {label}
      </Caption1>
      <Body1 style={{ display: 'block', marginTop: '4px', fontWeight: tokens.fontWeightSemibold }}>
        {value}
      </Body1>
      {detail && (
        <Caption1 style={{ display: 'block', color: tokens.colorNeutralForeground3, marginTop: '6px' }}>
          {detail}
        </Caption1>
      )}
    </div>
  )
}

function ArtifactList({ title, artifacts, empty }: {
  title: string
  artifacts: NormalizedArtifact[]
  empty: string
}) {
  return (
    <div style={{ ...cardStyle, flex: '1 1 320px' }}>
      <Subtitle2 as="h3" style={{ display: 'block', marginBottom: '10px' }}>{title}</Subtitle2>
      {artifacts.length === 0 ? (
        <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>{empty}</Caption1>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {artifacts.map((artifact) => (
            <div
              key={`${artifact.id}-${artifact.path}`}
              style={{
                display: 'flex',
                gap: '10px',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                borderBottom: '1px solid var(--border)',
                paddingBottom: '8px',
              }}
            >
              <div style={{ minWidth: 0 }}>
                <Body1 style={{ display: 'block', fontWeight: tokens.fontWeightSemibold }}>
                  {artifact.label}
                </Body1>
                <Caption1
                  style={{
                    display: 'block',
                    color: tokens.colorNeutralForeground3,
                    fontFamily: tokens.fontFamilyMonospace,
                    wordBreak: 'break-all',
                  }}
                >
                  {artifact.path}
                </Caption1>
                {artifact.purpose && (
                  <Caption1 style={{ display: 'block', color: tokens.colorNeutralForeground3, marginTop: '2px' }}>
                    {artifact.purpose}
                  </Caption1>
                )}
              </div>
              <StatusPill tone={statusTone(artifact.status)}>{formatStatus(artifact.status)}</StatusPill>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

interface SquadSyncStatusPanelProps {
  projectId: string
}

export function SquadSyncStatusPanel({ projectId }: SquadSyncStatusPanelProps) {
  const statusQuery = useSquadSyncStatus(projectId)
  const repair = useRepairSquadSync(projectId)
  const [repairMessage, setRepairMessage] = useState<string | null>(null)
  const [repairError, setRepairError] = useState<string | null>(null)

  if (statusQuery.isLoading) {
    return <SectionLoading label="Checking sync status…" />
  }

  if (statusQuery.isError || !statusQuery.data) {
    const message = statusQuery.error instanceof Error
      ? statusQuery.error.message
      : 'The sync status endpoint did not return data.'
    return (
      <div data-testid="squad-sync-status-panel" style={{ ...cardStyle, maxWidth: 760 }}>
        <StatusPill tone="warning">Status endpoint unavailable</StatusPill>
        <Subtitle2 as="h3" style={{ display: 'block', marginTop: '12px' }}>
          Cross-client compatibility cannot be verified yet.
        </Subtitle2>
        <Caption1 style={{ display: 'block', color: tokens.colorNeutralForeground3, marginTop: '6px' }}>
          {message}
        </Caption1>
        <Button
          appearance="secondary"
          icon={statusQuery.isFetching ? <Spinner size="tiny" /> : <ArrowSync20Regular />}
          style={{ marginTop: '14px' }}
          onClick={() => void statusQuery.refetch()}
        >
          Refresh
        </Button>
      </div>
    )
  }

  const status = normalizeSquadSyncStatus(statusQuery.data)

  async function handleRepair(action: NormalizedRepairAction) {
    setRepairMessage(null)
    setRepairError(null)
    try {
      const result = await repair.mutateAsync({ actions: [action.requestId], dryRun: false })
      const repaired = result.repaired?.length
        ? result.repaired.join(', ')
        : result.results?.length
          ? result.results.map((item) => `${ACTION_LABELS[item.action] ?? item.action}: ${item.status}`).join(', ')
          : action.label
      setRepairMessage(`Repair requested: ${repaired}. Status will refresh when the backend completes it.`)
    } catch (error) {
      setRepairError(error instanceof Error ? error.message : 'Repair failed')
    }
  }

  return (
    <div
      data-testid="squad-sync-status-panel"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
        maxWidth: 980,
      }}
    >
      <div style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
          <StatusPill tone={status.compatibilityTone}>{status.compatibilityTitle}</StatusPill>
          <Button
            appearance="secondary"
            icon={statusQuery.isFetching ? <Spinner size="tiny" /> : <ArrowSync20Regular />}
            disabled={statusQuery.isFetching}
            onClick={() => void statusQuery.refetch()}
          >
            Refresh
          </Button>
        </div>
        <Body1 style={{ display: 'block' }}>{status.compatibilityMessage}</Body1>
        {(status.checkedAt || status.contractVersion) && (
          <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>
            {status.checkedAt ? `Checked ${status.checkedAt}. ` : ''}
            {status.contractVersion ? `Contract ${status.contractVersion}.` : ''}
          </Caption1>
        )}
      </div>

      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
        <FactCard label="Source of truth" value={status.sourceOfTruth} />
        <FactCard label="Storage mode" value={status.storageMode} detail={status.storageDetail} />
        <FactCard label="Ceremonies" value={status.ceremoniesTitle} detail={status.ceremoniesMessage} />
      </div>

      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
        <ArtifactList
          title="Required artifacts"
          artifacts={status.requiredArtifacts}
          empty="No required artifacts reported by the endpoint."
        />
        <ArtifactList
          title="Recommended client artifacts"
          artifacts={status.recommendedArtifacts}
          empty="No recommended client artifacts reported by the endpoint."
        />
      </div>

      <div style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
          <ToneIcon tone={status.driftTone} />
          <div>
            <Subtitle2 as="h3" style={{ display: 'block' }}>{status.driftTitle}</Subtitle2>
            <Caption1 style={{ display: 'block', color: tokens.colorNeutralForeground3, marginTop: '4px' }}>
              {status.driftMessage}
            </Caption1>
          </div>
        </div>

        <div style={{ borderTop: '1px solid var(--border)', paddingTop: '12px' }}>
          <Subtitle2 as="h3" style={{ display: 'block', marginBottom: '8px' }}>Repair actions</Subtitle2>
          {status.repairActions.length === 0 ? (
            <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>
              No repair actions reported. Refresh after backend sync routes are available.
            </Caption1>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {status.repairActions.map((action) => {
                const disabledReason = action.disabledReason
                  ?? (!status.repairAvailable
                    ? status.repairDisabledReason ?? 'Automatic repair is not available for this status.'
                    : undefined)
                return (
                  <div
                    key={action.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: '12px',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                    }}
                  >
                    <div style={{ minWidth: 0, flex: '1 1 320px' }}>
                      <Body1 style={{ display: 'block', fontWeight: tokens.fontWeightSemibold }}>
                        {action.label}
                      </Body1>
                      <Caption1 style={{ display: 'block', color: tokens.colorNeutralForeground3 }}>
                        {disabledReason ?? action.reason}
                      </Caption1>
                    </div>
                    <Button
                      appearance="secondary"
                      icon={repair.isPending ? <Spinner size="tiny" /> : <Wrench20Regular />}
                      disabled={repair.isPending || Boolean(disabledReason)}
                      data-testid={`repair-action-${action.id}`}
                      onClick={() => void handleRepair(action)}
                    >
                      {repair.isPending ? 'Repairing…' : 'Repair'}
                    </Button>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {repairMessage && (
          <Caption1 style={{ color: tokens.colorPaletteGreenForeground1 }}>{repairMessage}</Caption1>
        )}
        {repairError && (
          <Caption1 style={{ color: tokens.colorPaletteRedForeground1 }}>{repairError}</Caption1>
        )}
      </div>
    </div>
  )
}
