/**
 * CeremoniesReview.tsx — Phase 11 review queue for translated ceremonies.
 *
 * Lists every workflow row in this project with status='draft' (i.e. the
 * translator has produced an executable ceremony, but a human has not yet
 * approved it) plus any kind='narrative' rows whose translation failed.
 *
 * For each row, the user can:
 *   - View the source narrative markdown side-by-side with the generated
 *     YAML.
 *   - Activate the draft (lifts status='draft' → 'active').
 *   - Edit the draft (jump to CeremonyEditor).
 *   - Discard the draft (DELETE; hard-delete since status='draft').
 *   - Retry translation when an error is recorded on the parent narrative.
 */

import { useState, useMemo } from 'react'
import { useParams, useNavigate, Link } from 'react-router'
import {
  Caption1,
  Body1,
  Button,
  Badge,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Card,
  CardHeader,
} from '@fluentui/react-components'
import { SectionLoading } from '../components/loading/index.tsx'
import {
  CheckmarkCircle20Regular,
  Edit20Regular,
  Delete20Regular,
  ArrowSync20Regular,
  Checkmark20Regular,
} from '@fluentui/react-icons'
import { useProject } from '../api/projects.ts'
import {
  useDraftCeremonies,
  useCeremony,
  useActivateCeremony,
  useDeleteCeremony,
  useTranslateCeremony,
  type Ceremony,
} from '../api/ceremonies.ts'
import PageHeader from '../components/layout/PageHeader.tsx'
import { safeAbsoluteTime } from '../utils/dates.ts'

export default function CeremoniesReview() {
  const { id } = useParams<{ id: string }>()
  const projectId = id ?? ''
  const navigate = useNavigate()

  const { data: project, isLoading: projectLoading } = useProject(projectId)
  const { data: drafts, isLoading: draftsLoading, isError } = useDraftCeremonies(projectId)

  const [selectedId, setSelectedId] = useState<string | null>(null)

  // Default to first draft when the list loads.
  const effectiveSelected = useMemo(() => {
    if (selectedId && drafts?.some((d) => d.id === selectedId)) return selectedId
    return drafts?.[0]?.id ?? null
  }, [selectedId, drafts])

  if (projectLoading) {
    return <div style={{ padding: 32, color: 'var(--text-muted)' }}>Loading project…</div>
  }
  if (!project) {
    return <div style={{ padding: 32, color: 'var(--danger)' }}>Project not found.</div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <PageHeader
        eyebrow={project.name}
        title="Ceremonies Review"
        description="Drafts produced by translating narrative ceremonies. Review and activate, edit, or discard."
        actions={
          <Button appearance="subtle" onClick={() => navigate(`/projects/${projectId}/ceremonies`)}>
            ← All Ceremonies
          </Button>
        }
      />

      {draftsLoading ? (
        <SectionLoading label="Loading drafts…" />
      ) : isError ? (
        <div style={{ padding: 32, color: 'var(--danger)' }}>Failed to load drafts.</div>
      ) : !drafts || drafts.length === 0 ? (
        <EmptyState projectId={projectId} />
      ) : (
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          {/* Left rail — draft list */}
          <aside
            style={{
              width: 320,
              borderRight: '1px solid var(--border)',
              overflowY: 'auto',
              padding: '12px 0',
              flexShrink: 0,
            }}
          >
            {drafts.map((d) => (
              <DraftRow
                key={d.id}
                draft={d}
                selected={d.id === effectiveSelected}
                onSelect={() => setSelectedId(d.id)}
              />
            ))}
          </aside>

          {/* Right pane — diff + actions */}
          <main style={{ flex: 1, overflow: 'auto', padding: 24 }}>
            {effectiveSelected ? (
              <DraftReview
                projectId={projectId}
                ceremonyId={effectiveSelected}
                onActivated={() => setSelectedId(null)}
                onDiscarded={() => setSelectedId(null)}
              />
            ) : (
              <div style={{ color: 'var(--text-muted)' }}>Select a draft.</div>
            )}
          </main>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState({ projectId }: { projectId: string }) {
  return (
    <div
      style={{
        padding: 64,
        textAlign: 'center',
        color: 'var(--text-muted)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <Checkmark20Regular style={{ width: 32, height: 32 }} />
      <Body1>No ceremonies awaiting review.</Body1>
      <Caption1>
        When a narrative ceremony is translated, the draft will appear here for approval.
      </Caption1>
      <Link to={`/projects/${projectId}/ceremonies`} style={{ marginTop: 8 }}>
        ← Back to ceremonies
      </Link>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Draft list row
// ---------------------------------------------------------------------------

function DraftRow({
  draft,
  selected,
  onSelect,
}: {
  draft: Ceremony
  selected: boolean
  onSelect: () => void
}) {
  const isNarrative = draft.kind === 'narrative'
  const hasError = Boolean(draft.lastTranslationError)

  return (
    <button
      type="button"
      onClick={onSelect}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        padding: '10px 16px',
        border: 'none',
        background: selected ? 'var(--surface-selected, rgba(0,120,212,0.1))' : 'transparent',
        cursor: 'pointer',
        borderLeft: selected ? '3px solid var(--brand)' : '3px solid transparent',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={{ fontWeight: 500, fontSize: 13, flex: 1 }}>{draft.name}</span>
        {hasError ? (
          <Badge appearance="filled" color="danger" size="small">error</Badge>
        ) : isNarrative ? (
          <Badge appearance="outline" size="small">narrative</Badge>
        ) : (
          <Badge appearance="outline" color="brand" size="small">draft</Badge>
        )}
      </div>
      <Caption1 style={{ color: 'var(--text-muted)', display: 'block' }}>
        {safeAbsoluteTime(draft.updatedAt)}
      </Caption1>
    </button>
  )
}

// ---------------------------------------------------------------------------
// Draft review pane (side-by-side narrative vs YAML)
// ---------------------------------------------------------------------------

function DraftReview({
  projectId,
  ceremonyId,
  onActivated,
  onDiscarded,
}: {
  projectId: string
  ceremonyId: string
  onActivated: () => void
  onDiscarded: () => void
}) {
  const navigate = useNavigate()
  const { data: detail, isLoading } = useCeremony(projectId, ceremonyId)
  const activate = useActivateCeremony(projectId)
  const remove = useDeleteCeremony(projectId)
  const translate = useTranslateCeremony(projectId)

  // For a draft kind='ceremony' row, parentNarrativeId points to its source.
  // For a kind='narrative' row (failed translation), the row IS the narrative.
  const parentNarrativeId = detail?.ceremony.parentNarrativeId ?? null
  const narrativeQuery = useCeremony(projectId, parentNarrativeId ?? '')

  if (isLoading || !detail) {
    return <SectionLoading label="Loading draft…" />
  }

  const isNarrative = detail.ceremony.kind === 'narrative'
  const generatedYaml = detail.activeVersion?.yamlContent ?? ''
  const narrativeMarkdown = isNarrative
    ? detail.activeVersion?.yamlContent ?? ''
    : narrativeQuery.data?.activeVersion?.yamlContent ?? ''

  const lastError =
    detail.ceremony.lastTranslationError ??
    narrativeQuery.data?.ceremony.lastTranslationError ??
    null

  const targetNarrativeIdForRetry = isNarrative ? detail.ceremony.id : parentNarrativeId

  const handleActivate = async () => {
    if (isNarrative) return
    try {
      await activate.mutateAsync(ceremonyId)
      onActivated()
    } catch {
      /* surfaced via mutation.error below */
    }
  }

  const handleDiscard = async () => {
    if (!confirm(`Discard draft "${detail.ceremony.name}"? This cannot be undone.`)) return
    try {
      await remove.mutateAsync(ceremonyId)
      onDiscarded()
    } catch {
      /* surfaced via mutation.error below */
    }
  }

  const handleRetry = async () => {
    if (!targetNarrativeIdForRetry) return
    try {
      await translate.mutateAsync(targetNarrativeIdForRetry)
    } catch {
      /* surfaced via mutation.error below */
    }
  }

  const handleEdit = () => {
    navigate(`/projects/${projectId}/ceremonies/${ceremonyId}`)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card>
        <CardHeader
          header={<Body1 style={{ fontWeight: 600 }}>{detail.ceremony.name}</Body1>}
          description={
            <Caption1 style={{ color: 'var(--text-muted)' }}>
              {isNarrative ? 'narrative (translation failed)' : `${detail.ceremony.kind} draft`} ·
              trigger: {detail.ceremony.triggerKind}
            </Caption1>
          }
          action={
            <div style={{ display: 'flex', gap: 8 }}>
              {!isNarrative && (
                <Button
                  appearance="primary"
                  icon={<CheckmarkCircle20Regular />}
                  onClick={handleActivate}
                  disabled={activate.isPending}
                >
                  {activate.isPending ? 'Activating…' : 'Activate'}
                </Button>
              )}
              <Button icon={<Edit20Regular />} onClick={handleEdit}>
                Edit
              </Button>
              {targetNarrativeIdForRetry && (
                <Button
                  icon={<ArrowSync20Regular />}
                  onClick={handleRetry}
                  disabled={translate.isPending}
                >
                  {translate.isPending ? 'Retrying…' : 'Retry translate'}
                </Button>
              )}
              <Button
                icon={<Delete20Regular />}
                onClick={handleDiscard}
                disabled={remove.isPending}
              >
                Discard
              </Button>
            </div>
          }
        />
      </Card>

      {lastError && (
        <MessageBar intent="error">
          <MessageBarBody>
            <MessageBarTitle>Last translation failed</MessageBarTitle>
            {lastError}
          </MessageBarBody>
        </MessageBar>
      )}

      {activate.error && (
        <MessageBar intent="error">
          <MessageBarBody>{activate.error.message}</MessageBarBody>
        </MessageBar>
      )}
      {remove.error && (
        <MessageBar intent="error">
          <MessageBarBody>{remove.error.message}</MessageBarBody>
        </MessageBar>
      )}
      {translate.error && (
        <MessageBar intent="error">
          <MessageBarBody>{translate.error.message}</MessageBarBody>
        </MessageBar>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 16,
          minHeight: 320,
        }}
      >
        <Card>
          <CardHeader header={<Body1 style={{ fontWeight: 600 }}>Source narrative</Body1>} />
          <pre
            style={{
              margin: 0,
              padding: 16,
              fontSize: 12,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              maxHeight: 480,
              overflow: 'auto',
              background: 'var(--surface-subtle, rgba(0,0,0,0.03))',
            }}
          >
            {narrativeMarkdown || (isNarrative ? '(empty)' : '(narrative unavailable)')}
          </pre>
        </Card>
        <Card>
          <CardHeader header={<Body1 style={{ fontWeight: 600 }}>Generated YAML</Body1>} />
          <pre
            style={{
              margin: 0,
              padding: 16,
              fontSize: 12,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              maxHeight: 480,
              overflow: 'auto',
              background: 'var(--surface-subtle, rgba(0,0,0,0.03))',
            }}
          >
            {generatedYaml || '(no YAML — translation pending or failed)'}
          </pre>
        </Card>
      </div>
    </div>
  )
}
