/**
 * components/ceremony/ProseTab.tsx — Phase 16
 *
 * "Describe in prose" authoring panel.
 *
 *   - For a brand-new ceremony (no existing YAML): a single textarea +
 *     "Generate" button. The result is shown in a preview pane with the
 *     LLM's rationale; the user can Accept (commits to the in-memory
 *     step list, switching tabs back to Code/Visual is then save-only),
 *     Edit-then-accept (drops the result back into the YAML preview for
 *     manual tweaks), or Discard.
 *
 *   - For an existing ceremony: an "instruction" textarea + "Refine"
 *     button. The result is shown side-by-side against the current YAML
 *     with the LLM's diffSummary, and the same Accept / Edit / Discard
 *     controls.
 *
 * The tab never persists on its own — accepting just calls `onAccept`
 * with the new step list + header, and the parent editor's existing
 * Save button is what writes to the server.
 */

import { useState } from 'react'
import {
  Button,
  Caption1,
  MessageBar,
  MessageBarBody,
  Spinner,
  Subtitle1,
  Textarea,
} from '@fluentui/react-components'
import {
  Sparkle16Regular,
  Checkmark16Regular,
  Dismiss16Regular,
  Edit16Regular,
} from '@fluentui/react-icons'
import {
  useGenerateFromProse,
  useRefineWithProse,
  type GenerateFromProseResult,
  type RefineWithProseResult,
  type TriggerKind,
} from '../../api/ceremonies.ts'
import {
  ceremonyYamlToGraph,
  topLevelSteps,
  type CeremonyHeader,
  type CeremonyStep,
} from '../../services/ceremony-graph.ts'

export interface ProseTabProps {
  projectId: string
  ceremonyId?: string
  currentYaml: string
  currentName: string
  onAccept: (next: {
    header: CeremonyHeader
    steps: CeremonyStep[]
    triggerKind: TriggerKind
    triggerConfig: Record<string, unknown>
  }) => void
  disabled?: boolean
}

type Mode = 'generate' | 'refine'

export default function ProseTab({
  projectId,
  ceremonyId,
  currentYaml,
  currentName,
  onAccept,
  disabled,
}: ProseTabProps) {
  const isExisting = !!ceremonyId && ceremonyId !== 'new'
  const mode: Mode = isExisting ? 'refine' : 'generate'

  const [prose, setProse] = useState('')
  const [generated, setGenerated] = useState<GenerateFromProseResult | null>(null)
  const [refined, setRefined] = useState<RefineWithProseResult | null>(null)
  const [editableYaml, setEditableYaml] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const generateMut = useGenerateFromProse(projectId)
  const refineMut = useRefineWithProse(projectId, ceremonyId ?? '')

  const busy = generateMut.isPending || refineMut.isPending

  const reset = () => {
    setProse('')
    setGenerated(null)
    setRefined(null)
    setEditableYaml(null)
    setErr(null)
  }

  const handleGenerate = async () => {
    if (!prose.trim()) return
    setErr(null)
    try {
      const r = await generateMut.mutateAsync({
        prose,
        ceremonyName: currentName?.trim() ? currentName : undefined,
      })
      setGenerated(r)
      setEditableYaml(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  const handleRefine = async () => {
    if (!prose.trim() || !currentYaml.trim()) return
    setErr(null)
    try {
      const r = await refineMut.mutateAsync({
        instruction: prose,
        currentYaml,
      })
      setRefined(r)
      setEditableYaml(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  const handleAccept = () => {
    const yamlToAccept =
      editableYaml ?? generated?.yamlContent ?? refined?.yamlContent ?? null
    const triggerKind = (generated?.triggerKind ?? refined?.triggerKind) as
      | TriggerKind
      | undefined
    const triggerConfig =
      generated?.triggerConfig ?? refined?.triggerConfig ?? {}
    if (!yamlToAccept || !triggerKind) return
    try {
      const graph = ceremonyYamlToGraph(yamlToAccept)
      onAccept({
        header: graph.header,
        steps: topLevelSteps(graph),
        triggerKind,
        triggerConfig,
      })
      reset()
    } catch (e) {
      setErr(`Failed to parse generated YAML: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const handleEdit = () => {
    const baseline = generated?.yamlContent ?? refined?.yamlContent
    if (baseline) setEditableYaml(baseline)
  }

  const handleDiscard = () => {
    reset()
  }

  const result = generated ?? refined
  const showResult = !!result
  const rationale = generated?.rationale ?? refined?.rationale ?? ''
  const diffSummary = refined?.diffSummary
  const warnings = generated?.warnings ?? refined?.warnings ?? []

  return (
    <div
      style={{
        flex: 1,
        padding: '16px 18px',
        overflow: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <Subtitle1>
        {mode === 'generate' ? 'Describe a new ceremony' : 'Refine this ceremony'}
      </Subtitle1>
      <Caption1 style={{ color: 'var(--text-muted)' }}>
        {mode === 'generate'
          ? 'Write a plain-English description (e.g. "Daily standup at 9 AM where each engineer summarises what they shipped yesterday and the team lead approves the rollup."). The LLM will draft a ceremony YAML you can accept or edit.'
          : 'Describe the change you want (e.g. "Add an approval step from the team lead after the summary is written."). The current YAML is sent along; the LLM returns a diff with rationale.'}
      </Caption1>

      <Textarea
        value={prose}
        onChange={(_, d) => setProse(d.value)}
        placeholder={
          mode === 'generate'
            ? 'Describe the ceremony in plain English…'
            : 'Describe the change you want to make…'
        }
        disabled={disabled || busy}
        rows={6}
      />
      <div style={{ display: 'flex', gap: 8 }}>
        <Button
          appearance="primary"
          icon={<Sparkle16Regular />}
          onClick={mode === 'generate' ? handleGenerate : handleRefine}
          disabled={disabled || busy || !prose.trim() || (mode === 'refine' && !currentYaml.trim())}
        >
          {busy ? <Spinner size="tiny" /> : mode === 'generate' ? 'Generate' : 'Refine'}
        </Button>
        {showResult && (
          <Button appearance="subtle" icon={<Dismiss16Regular />} onClick={handleDiscard} disabled={busy}>
            Clear
          </Button>
        )}
      </div>

      {err && (
        <MessageBar intent="error">
          <MessageBarBody>{err}</MessageBarBody>
        </MessageBar>
      )}

      {showResult && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <MessageBar intent="success">
            <MessageBarBody>
              <strong>Rationale:</strong> {rationale || '(none)'}
              {diffSummary && (
                <div style={{ marginTop: 4 }}>
                  <strong>Diff:</strong> {diffSummary}
                </div>
              )}
            </MessageBarBody>
          </MessageBar>

          {warnings.length > 0 && (
            <MessageBar intent="warning">
              <MessageBarBody>
                <strong>Warnings:</strong>
                <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                  {warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </MessageBarBody>
            </MessageBar>
          )}

          {mode === 'refine' && refined ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <YamlPanel title="Current" yaml={currentYaml} />
              <YamlPanel
                title="Proposed"
                yaml={editableYaml ?? refined.yamlContent}
                editable={!!editableYaml}
                onEdit={(v) => setEditableYaml(v)}
              />
            </div>
          ) : (
            <YamlPanel
              title="Generated YAML"
              yaml={editableYaml ?? generated?.yamlContent ?? ''}
              editable={!!editableYaml}
              onEdit={(v) => setEditableYaml(v)}
            />
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <Button
              appearance="primary"
              icon={<Checkmark16Regular />}
              onClick={handleAccept}
              disabled={disabled}
            >
              Accept
            </Button>
            {!editableYaml && (
              <Button appearance="secondary" icon={<Edit16Regular />} onClick={handleEdit} disabled={disabled}>
                Edit before accepting
              </Button>
            )}
            <Button appearance="subtle" icon={<Dismiss16Regular />} onClick={handleDiscard} disabled={disabled}>
              Discard
            </Button>
          </div>
          <Caption1 style={{ color: 'var(--text-muted)' }}>
            Accepting drops the YAML into the in-memory step list. Click <strong>Save</strong> in
            the header to persist it; switching to Code or Visual lets you keep editing first.
          </Caption1>
        </div>
      )}
    </div>
  )
}

function YamlPanel({
  title,
  yaml,
  editable,
  onEdit,
}: {
  title: string
  yaml: string
  editable?: boolean
  onEdit?: (next: string) => void
}) {
  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 6,
        background: 'var(--surface)',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 200,
      }}
    >
      <div
        style={{
          padding: '6px 10px',
          borderBottom: '1px solid var(--border)',
          fontSize: 12,
          color: 'var(--text-muted)',
        }}
      >
        {title}
      </div>
      {editable && onEdit ? (
        <Textarea
          value={yaml}
          onChange={(_, d) => onEdit(d.value)}
          rows={14}
          style={{ width: '100%', fontFamily: 'monospace' }}
          textarea={{ style: { fontFamily: 'monospace', fontSize: 12 } }}
        />
      ) : (
        <pre
          style={{
            margin: 0,
            padding: 10,
            fontSize: 12,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            overflow: 'auto',
            flex: 1,
          }}
        >
          {yaml}
        </pre>
      )}
    </div>
  )
}
