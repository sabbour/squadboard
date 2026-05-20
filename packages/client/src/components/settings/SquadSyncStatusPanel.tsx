import { useState, type CSSProperties, type ReactNode } from 'react'
import {
  Body1,
  Button,
  Caption1,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
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
  type RepairSquadSyncResult,
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
  required: boolean
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
  manualBridge: boolean
  dryRunSupported: boolean
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
  'project-squad-to-fs': 'Export Squadboard state to .squad files',
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
  if (authority === 'squad_storage') return 'Squadboard'
  if (authority === 'filesystem') return 'Filesystem .squad'
  if (authority === 'mcp_broker') return 'Squadboard bridge'
  return 'Unknown'
}

function storageLabel(mode: string | undefined): string {
  if (mode === 'postgresql') return 'Squadboard-managed'
  if (mode === 'filesystem') return 'Filesystem .squad'
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
    ? serverArtifacts.map((artifact, index) => {
      const id = artifact.id ?? artifact.path ?? `projection-${index}`
      const path = artifact.path ?? id
      return {
        id,
        label: ARTIFACT_LABELS[id] ?? path,
        path,
        status: toCheckStatus(artifact.status),
        requirement: artifact.requirement ?? 'recommended',
        purpose: artifact.purpose,
      }
    })
    : governanceFiles.map((file, index) => {
      const path = file.path ?? `governance-${index}`
      const label = file.label ?? path
      return {
        id: label || path,
        label,
        path,
        status: toCheckStatus(file.status),
        requirement: file.requirement ?? (file.required ? 'required' : 'recommended'),
        purpose: file.message,
      }
    })

  const requiredArtifacts = artifacts.filter((artifact) => artifact.requirement === 'required')
  const recommendedArtifacts = artifacts.filter((artifact) => artifact.requirement === 'recommended')
  const requiredGaps = requiredArtifacts.filter((artifact) => artifact.status !== 'ok')
  const recommendedGaps = recommendedArtifacts.filter((artifact) => artifact.status !== 'ok')
  const source = status.authority?.sourceOfTruth ?? status.storage?.authority ?? status.sourceOfTruth ?? 'unknown'
  const mode = status.authority?.storageMode ?? status.storage?.mode ?? status.storageMode ?? 'unknown'

  const manualBridge = mode === 'postgresql' && status.authority?.continuousSync === false
  const storageDetail = manualBridge
    ? 'Squadboard manages this project. Export .squad files only for a filesystem handoff.'
    : status.authority?.runtime?.note
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
  const needsNonBlockingRepair = driftDetected || recommendedGaps.length > 0
  const compatibilityTone: Tone = blockingDrift || requiredGaps.length > 0
    ? 'danger'
    : needsNonBlockingRepair
      ? 'warning'
      : hasEvidence
        ? 'success'
        : 'neutral'
  const compatibilityTitle = compatibilityTone === 'success'
    ? manualBridge
      ? 'Ready through Squadboard'
      : 'Ready for Squadboard ↔ CLI/Copilot'
    : compatibilityTone === 'warning'
      ? needsNonBlockingRepair
        ? 'Usable, but CLI/Copilot needs repair'
        : 'Ready through Squadboard'
      : compatibilityTone === 'danger'
        ? 'Not ready for peer clients'
        : 'Sync status unknown'
  const compatibilityMessage = manualBridge
    ? 'This project lives in Squadboard. CLI/Copilot can keep working through Squadboard, and Preview Export writes .squad files only when you want a filesystem handoff.'
    : status.summary?.message
      ?? (mode === 'postgresql'
        ? 'Squadboard owns this project state; CLI/Copilot should keep working through Squadboard.'
      : mode === 'filesystem'
        ? 'Filesystem .squad is the authority; Squadboard and CLI/Copilot must both write through that filesystem state.'
        : 'The backend has not reported enough evidence to confirm cross-client compatibility.')

  const actions = new Map<string, NormalizedRepairAction>()
  for (const action of status.repair?.actions ?? []) {
    if (!action) continue
    const actionId = typeof action === 'string' ? action : action.id
    if (!actionId) continue
    const unavailable = typeof action === 'string' ? false : action.available === false
    actions.set(actionId, {
      id: actionId,
      requestId: repairRequestId(actionId),
      label: ACTION_LABELS[actionId] ?? actionId,
      reason: typeof action === 'string'
        ? 'Backend reported this repair as available.'
        : action.reason,
      required: typeof action === 'string' ? true : action.required !== false,
      disabledReason: browserDisabledRepairReason(actionId)
        ?? (unavailable
        ? 'Backend marked this repair unavailable.'
        : undefined),
    })
  }
  for (const action of status.repairActions ?? []) {
    if (!action?.id) continue
    actions.set(action.id, {
      id: action.id,
      requestId: repairRequestId(action.id),
      label: ACTION_LABELS[action.id] ?? action.id,
      reason: action.reason,
      required: action.mode !== 'manual',
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
    manualBridge,
    dryRunSupported: status.repair?.dryRunSupported !== false,
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

interface PreviewModal {
  action: NormalizedRepairAction
  summary: string
  changes: string[]
  hiddenNoopCount: number
  totalChangeCount: number
  noFileChangesNeeded: boolean
}

type RepairResultItem = NonNullable<RepairSquadSyncResult['results']>[number]
type RepairChange = NonNullable<RepairResultItem['changes']>[number]

function previewActionLabel(action: NormalizedRepairAction): 'Repair' | 'Export' {
  return action.required ? 'Repair' : 'Export'
}

function previewProgressLabel(action: NormalizedRepairAction): string {
  return action.required ? 'Repairing…' : 'Exporting…'
}

function completedActionLabel(action: NormalizedRepairAction): string {
  return action.required ? 'Repair applied' : 'Export completed'
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}

function isNoopPreviewChange(change: RepairChange): boolean {
  const status = (change.status ?? '').toLowerCase()
  const reason = (change.reason ?? change.message ?? '').toLowerCase()
  return status === 'unchanged'
    || reason.includes('already_up_to_date')
    || reason.includes('already up to date')
    || reason.includes('already_exists')
    || reason.includes('already exists')
    || reason.includes('no_changes')
    || reason.includes('no changes')
}

function isNoChangeResultItem(item: RepairResultItem): boolean {
  const status = (item.status ?? '').toLowerCase()
  const reason = (item.reason ?? '').toLowerCase()
  return status === 'skipped'
    && (reason.includes('already_up_to_date')
      || reason.includes('already up to date')
      || reason.includes('no_changes')
      || reason.includes('no changes'))
}

function formatPreviewChange(item: RepairResultItem, change: RepairChange): string {
  const target = change.path ? ` ${change.path}` : ''
  const reason = change.reason ?? change.message
  return `${ACTION_LABELS[item.action] ?? item.action}: ${change.operation}${target} — ${change.status}${reason ? ` (${reason})` : ''}`
}

function previewResultSummary(action: NormalizedRepairAction, result: RepairSquadSyncResult): string {
  if (result.repaired?.length) return result.repaired.join(', ')
  if (result.skipped?.length) {
    return result.skipped
      .map((item) => `${ACTION_LABELS[item.action] ?? item.action}: skipped`)
      .join(', ')
  }
  if (result.results?.length) {
    return result.results
      .map((item) => `${ACTION_LABELS[item.action] ?? item.action}: ${item.status}`)
      .join(', ')
  }
  return action.label
}

function buildPreviewModal(action: NormalizedRepairAction, result: RepairSquadSyncResult): PreviewModal {
  const changes: string[] = []
  let hiddenNoopCount = 0

  for (const item of result.results ?? []) {
    for (const change of item.changes ?? []) {
      if (isNoopPreviewChange(change)) {
        hiddenNoopCount += 1
      } else {
        changes.push(formatPreviewChange(item, change))
      }
    }
  }

  const totalChangeCount = hiddenNoopCount + changes.length
  const noFileChangesNeeded = changes.length === 0
    && (hiddenNoopCount > 0 || (result.results?.length ?? 0) > 0 && result.results!.every(isNoChangeResultItem))
  const actionLabel = previewActionLabel(action)
  const summary = noFileChangesNeeded
    ? `${actionLabel} preview complete: no file changes needed.`
    : `${actionLabel} preview requested: ${previewResultSummary(action, result)}. No changes were applied.`

  return {
    action,
    summary,
    changes,
    hiddenNoopCount,
    totalChangeCount,
    noFileChangesNeeded,
  }
}

export function SquadSyncStatusPanel({ projectId }: SquadSyncStatusPanelProps) {
  const statusQuery = useSquadSyncStatus(projectId)
  const repair = useRepairSquadSync(projectId)
  const [previewModal, setPreviewModal] = useState<PreviewModal | null>(null)
  const [applyMessage, setApplyMessage] = useState<string | null>(null)
  const [applyError, setApplyError] = useState<string | null>(null)
  const [isApplying, setIsApplying] = useState(false)

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
  const requiredRepairActions = status.repairActions.filter((action) => action.required)
  const manualExportActions = status.repairActions.filter((action) => !action.required)

  async function handlePreviewRepair(action: NormalizedRepairAction) {
    setApplyMessage(null)
    setApplyError(null)
    try {
      const result = await repair.mutateAsync({ actions: [action.requestId], dryRun: true })
      setPreviewModal(buildPreviewModal(action, result))
    } catch (error) {
      setApplyError(error instanceof Error ? error.message : `${previewActionLabel(action)} preview failed`)
    }
  }

  async function handleApplyRepair() {
    if (!previewModal) return
    setIsApplying(true)
    try {
      const result = await repair.mutateAsync({ actions: [previewModal.action.requestId], dryRun: false })
      const repaired = result.repaired?.length
        ? result.repaired.join(', ')
        : result.results?.length
          ? result.results.map((item) => `${ACTION_LABELS[item.action] ?? item.action}: ${item.status}`).join(', ')
          : previewModal.action.label
      setPreviewModal(null)
      setApplyMessage(`${completedActionLabel(previewModal.action)}: ${repaired}.`)
      void statusQuery.refetch()
    } catch (error) {
      setApplyError(error instanceof Error ? error.message : `${previewActionLabel(previewModal.action)} failed`)
      setPreviewModal(null)
    } finally {
      setIsApplying(false)
    }
  }

  const isPreviewPending = repair.isPending && !previewModal

  return (
    <>
      {previewModal && (
        <Dialog open onOpenChange={(_e, data) => { if (!data.open) setPreviewModal(null) }}>
          <DialogSurface>
            <DialogBody>
              <DialogTitle>
                {previewModal.action.required ? 'Preview Repair' : 'Preview Export'}
              </DialogTitle>
              <DialogContent>
                <Caption1 style={{ display: 'block', color: tokens.colorNeutralForeground3, marginBottom: '12px' }}>
                  {previewModal.summary}
                </Caption1>
                <div
                  data-testid="preview-modal-changes"
                  style={{
                    maxHeight: '320px',
                    overflowY: 'auto',
                    border: '1px solid var(--border)',
                    borderRadius: '6px',
                    padding: '10px 12px',
                    background: 'var(--bg)',
                  }}
                >
                  {previewModal.noFileChangesNeeded ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <Body1 style={{ display: 'block', fontWeight: tokens.fontWeightSemibold }}>
                        No file changes needed.
                      </Body1>
                      {previewModal.hiddenNoopCount > 0 && (
                        <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>
                          {pluralize(previewModal.hiddenNoopCount, 'unchanged file')} already up to date; hidden from this preview.
                        </Caption1>
                      )}
                    </div>
                  ) : previewModal.changes.length === 0 ? (
                    <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>No file changes reported.</Caption1>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {previewModal.hiddenNoopCount > 0 && (
                        <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>
                          Showing {pluralize(previewModal.changes.length, 'file change')}; {pluralize(previewModal.hiddenNoopCount, 'unchanged file')} hidden.
                        </Caption1>
                      )}
                      <ul style={{ margin: 0, paddingLeft: '18px' }}>
                        {previewModal.changes.map((change, index) => (
                          <li key={`${change}-${index}`}>
                            <Caption1 style={{ fontFamily: tokens.fontFamilyMonospace }}>{change}</Caption1>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </DialogContent>
              <DialogActions>
                <Button appearance="secondary" onClick={() => setPreviewModal(null)}>Cancel</Button>
                <Button
                  appearance="primary"
                  icon={isApplying ? <Spinner size="tiny" /> : <Wrench20Regular />}
                  disabled={isApplying}
                  onClick={() => void handleApplyRepair()}
                >
                  {isApplying ? previewProgressLabel(previewModal.action) : previewActionLabel(previewModal.action)}
                </Button>
              </DialogActions>
            </DialogBody>
          </DialogSurface>
        </Dialog>
      )}
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
          <Subtitle2 as="h3" style={{ display: 'block', marginBottom: '8px' }}>
            {requiredRepairActions.length > 0 ? 'Repair actions' : 'Manual export actions'}
          </Subtitle2>
          {requiredRepairActions.length === 0 && manualExportActions.length > 0 && (
            <Caption1 style={{ display: 'block', color: tokens.colorNeutralForeground3, marginBottom: '10px' }}>
              Use Preview Export only when you want CLI/Copilot file-based tools to receive a .squad handoff. It does not turn on automatic two-way sync.
            </Caption1>
          )}
          {status.repairActions.length > 0 && (
            <Caption1 style={{ display: 'block', color: tokens.colorNeutralForeground3, marginBottom: '10px' }}>
              Previews are safe: Preview Repair or Preview Export runs a dry run and opens a modal showing proposed file changes before anything is written.
            </Caption1>
          )}
          {status.repairActions.length === 0 ? (
            <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>
              No repair actions reported. Refresh after backend sync routes are available.
            </Caption1>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {[...requiredRepairActions, ...manualExportActions].map((action) => {
                const disabledReason = action.disabledReason
                  ?? (!status.dryRunSupported
                    ? 'Preview is not available for this backend response yet.'
                    : undefined)
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
                      icon={isPreviewPending ? <Spinner size="tiny" /> : <Wrench20Regular />}
                      disabled={isPreviewPending || Boolean(disabledReason)}
                      data-testid={`repair-action-${action.id}`}
                      onClick={() => void handlePreviewRepair(action)}
                    >
                      {isPreviewPending ? 'Previewing…' : action.required ? 'Preview Repair' : 'Preview Export'}
                    </Button>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {applyMessage && (
          <Caption1 style={{ color: tokens.colorPaletteGreenForeground1 }}>{applyMessage}</Caption1>
        )}
        {applyError && (
          <Caption1 style={{ color: tokens.colorPaletteRedForeground1 }}>{applyError}</Caption1>
        )}
      </div>
    </div>
    </>
  )
}
