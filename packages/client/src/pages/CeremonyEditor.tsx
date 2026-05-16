/**
 * CeremonyEditor.tsx — Phase 10 rich editor (replaces WorkflowEditor).
 *
 * Layout:
 *   ┌────────────────────────────────────────────────────────────────┐
 *   │ Header: name / kind badge / triggerKind picker / actions       │
 *   ├──────────────────────────────┬─────────────────────────────────┤
 *   │ Trigger config panel         │ Step list (rich editor)         │
 *   │ (per triggerKind form)       │ ↑↓ reorder, type/agent/prompt   │
 *   │                              │ collapsed advanced fields       │
 *   └──────────────────────────────┴─────────────────────────────────┘
 *
 * The editor stays YAML-source-of-truth: the structured step list edits
 * round-trip to YAML on save (we use a minimal JS-side YAML emitter so
 * we do not need a runtime YAML library on the client).
 *
 * Read-only mode for kind='narrative' (Phase 11 will add Convert).
 */

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useParams, useNavigate, Navigate, useSearchParams } from 'react-router'
import {
  useCeremony,
  useCreateCeremony,
  useUpdateCeremony,
  useRunCeremony,
  useValidateCeremony,
  usePreviewCron,
  useGenerateFromProse,
  useCeremonySchedules,
  useCreateSchedule,
  useDeleteSchedule,
  useCeremonyTemplates,
  type TriggerKind,
  type CeremonyKind,
} from '../api/ceremonies.ts'
import { useActiveAgents } from '../api/agents.ts'
import { useSaveWorkflowAsTemplate, triggerTextDownload } from '../api/templates.ts'
import {
  Subtitle1,
  Caption1,
  Body1,
  Badge,
  Button,
  Card,
  Dialog,
  DialogSurface,
  DialogBody,
  DialogTitle,
  DialogContent,
  DialogActions,
  Dropdown,
  Field,
  Label,
  Option,
  Radio,
  RadioGroup,
  Input,
  Textarea,
  MessageBar,
  MessageBarBody,
  Switch,
  TabList,
  Tab,
  Accordion,
  AccordionItem,
  AccordionHeader,
  AccordionPanel,
  tokens,
  type SelectTabData,
  type SelectTabEvent,
} from '@fluentui/react-components'
import {
  ArrowUp16Regular,
  ArrowDown16Regular,
  Delete16Regular,
  Add16Regular,
  Play16Regular,
  Checkmark16Regular,
  Warning16Regular,
  BookmarkAddRegular,
  ArrowDownloadRegular,
} from '@fluentui/react-icons'
import VisualCanvas from '../components/ceremony/VisualCanvas.tsx'
import { ScopeBadge } from '../components/ceremony/CeremonyBadges.tsx'
// Stream D — D5: ProseTab removed. The "Formulate" hero on the new-ceremony
// flow still exposes prose → YAML; the always-visible Prose tab inside the
// editor was a duplicate path (see plan.md D5). The component file
// components/ceremony/ProseTab.tsx is deleted.
import {
  blankStep,
  ceremonyYamlToGraph,
  graphToCeremonyYaml,
  rebuildGraph,
  topLevelSteps,
  type CeremonyHeader,
  type CeremonyStep,
  type StepKind,
} from '../services/ceremony-graph.ts'
import PageHeader from '../components/layout/PageHeader.tsx'
import FormulatePanel from '../components/formulate/FormulatePanel.tsx'
import { safeAbsoluteTime } from '../utils/dates.ts'
import { SectionLoading } from '../components/loading/index.tsx'

// ---------------------------------------------------------------------------
// Phase 16: the single source of truth for editor state is now the
// `CeremonyStep` discriminated union from services/ceremony-graph.ts. The
// Code, Visual, and Prose tabs all read/write the same in-memory list.
// ---------------------------------------------------------------------------

const STEP_TYPE_OPTIONS: { value: StepKind; label: string; description: string; advanced?: boolean }[] = [
  { value: 'agent_run', label: 'Agent run', description: 'Run an agent with a prompt. Most common.' },
  { value: 'route', label: 'Route', description: 'Pick a column / agent based on rules.' },
  { value: 'approve', label: 'Peer review', description: "Have another agent review the prior step's output." },
  { value: 'fan_out', label: 'Fan out', description: 'Spawn multiple parallel branches.' },
  { value: 'handoff', label: 'Handoff', description: 'Transfer context to another agent.', advanced: true },
]

const COMMON_STEP_OPTIONS = STEP_TYPE_OPTIONS.filter((o) => !o.advanced)
const ADVANCED_STEP_OPTIONS = STEP_TYPE_OPTIONS.filter((o) => o.advanced)

const TRIGGER_KIND_OPTIONS: { value: TriggerKind; label: string; description: string }[] = [
  { value: 'manual', label: 'Manual', description: 'Run on demand. You click a button to start it.' },
  { value: 'on_schedule', label: 'Schedule', description: 'Run on a recurring schedule (cron expression).' },
  { value: 'on_event', label: 'Event', description: 'Run when a specific event happens (e.g., issue created, deliverable submitted).' },
  { value: 'on_issue_entry', label: 'Issue entry', description: 'Run when an issue enters a board column.' },
]

/** Canonical kind options with human-readable labels and one-sentence descriptions. */
const CEREMONY_KIND_OPTIONS: { value: CeremonyKind; label: string; description: string; deprecated?: boolean }[] = [
  {
    value: 'workflow',
    label: 'Workflow',
    description: 'Execution graph — the ordered steps (route, agent_run, approve, …) that run inside a ceremony.',
  },
  {
    value: 'ceremony',
    label: 'Ceremony',
    description: 'Named triggered process — has a trigger (schedule, label, event) and runs a workflow graph.',
  },
  {
    value: 'review_policy',
    label: 'Review Policy',
    description: 'Defines who-can-approve rules applied to peer_review and approve steps.',
  },
  {
    value: 'narrative',
    label: 'Narrative (Phase 11 preview)',
    description: 'Documentation-only prose description of a process — not yet executable; convert to a ceremony in Phase 11.',
    deprecated: true,
  },
]

const EVENT_TYPE_OPTIONS = [
  'issue.created',
  'issue.updated',
  'issue.moved',
  'run.started',
  'run.completed',
  'workflow.advanced',
  'comment.created',
  'deliverable.created',
  'deliverable.updated',
  'deliverable.reviewed',
  'session.completed',
]

const TIMEZONE_OPTIONS = ['UTC', 'America/Los_Angeles', 'America/New_York', 'Europe/London', 'Europe/Berlin', 'Asia/Tokyo']

// ---------------------------------------------------------------------------
// YAML <-> step adapter (single source of truth in services/ceremony-graph.ts).
// ---------------------------------------------------------------------------

function emitYaml(header: CeremonyHeader, steps: CeremonyStep[]): string {
  return graphToCeremonyYaml(rebuildGraph(header, steps))
}

function parseSteps(yaml: string): { header: CeremonyHeader; steps: CeremonyStep[] } {
  const graph = ceremonyYamlToGraph(yaml)
  return { header: graph.header, steps: topLevelSteps(graph) }
}

const DEFAULT_STEPS: CeremonyStep[] = [
  { ...blankStep('agent_run'), label: 'Run primary agent' },
]

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CeremonyEditor() {
  const { id: projectId, ceremonyId } = useParams<{ id: string; ceremonyId?: string }>()
  const isNew = !ceremonyId || ceremonyId === 'new'
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  if (!projectId) return <Navigate to="/" replace />

  // Bug W15-1: read ?template=<slug> and pre-fill form from built-in ceremony template.
  const templateSlug = isNew ? searchParams.get('template') : null
  const { data: builtinTemplates } = useCeremonyTemplates()

  const { data: detail, isLoading } = useCeremony(projectId, isNew ? '' : ceremonyId!)
  const createCeremony = useCreateCeremony(projectId)
  const updateCeremony = useUpdateCeremony(projectId)
  const runCeremony = useRunCeremony(projectId)
  const validateCeremony = useValidateCeremony()
  const previewCron = usePreviewCron(projectId)
  const generateFromProse = useGenerateFromProse(projectId)

  // Editor state (initialised from the loaded ceremony or defaults).
  const [name, setName] = useState('New Ceremony')
  const [description, setDescription] = useState<string>('')
  const [headerExtras, setHeaderExtras] = useState<Record<string, unknown>>({})
  const [kind, setKind] = useState<CeremonyKind>('workflow')
  const [triggerKind, setTriggerKind] = useState<TriggerKind>('manual')
  const [triggerConfig, setTriggerConfig] = useState<Record<string, unknown>>({})
  const [steps, setSteps] = useState<CeremonyStep[]>(DEFAULT_STEPS)
  const [showAdvancedFor, setShowAdvancedFor] = useState<Set<number>>(new Set())
  const [activeTab, setActiveTab] = useState<'code' | 'visual'>('code')

  // Conjure/Formulate model badge.
  const [formulateModelUsed, setFormulateModelUsed] = useState<{ model: string; via: string } | null>(null)
  // Controls progressive reveal of the manual-build structured form in create mode.
  const [showManualForm, setShowManualForm] = useState(false)

  // Bug W15-1: template pre-fill state.
  const [templateNotFound, setTemplateNotFound] = useState(false)

  const [saveErr, setSaveErr] = useState<string | null>(null)
  const [saveOk, setSaveOk] = useState(false)
  const [validationErrors, setValidationErrors] = useState<string[]>([])
  const [cronPreview, setCronPreview] = useState<string[] | null>(null)
  const [cronPreviewErr, setCronPreviewErr] = useState<string | null>(null)

  // Wave 10 B9: only active agents are pickable for ceremony steps.
  const { data: agents } = useActiveAgents(projectId)
  const saveWorkflowAsTemplate = useSaveWorkflowAsTemplate(projectId)
  const [showSaveTemplateDialog, setShowSaveTemplateDialog] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const [templateDescription, setTemplateDescription] = useState('')
  const [saveTemplateError, setSaveTemplateError] = useState<string | null>(null)
  const [saveTemplateDone, setSaveTemplateDone] = useState(false)

  async function handleSaveAsTemplate() {
    if (!templateName.trim()) return
    setSaveTemplateError(null)
    try {
      await saveWorkflowAsTemplate.mutateAsync({
        ceremonyId: ceremonyId!,
        name: templateName.trim(),
        description: templateDescription.trim() || undefined,
      })
      setShowSaveTemplateDialog(false)
      setTemplateName('')
      setTemplateDescription('')
      setSaveTemplateDone(true)
      setTimeout(() => setSaveTemplateDone(false), 3000)
    } catch (e: unknown) {
      setSaveTemplateError(e instanceof Error ? e.message : 'Save failed')
    }
  }

  function handleExportYaml() {
    const filename = `${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'ceremony'}.yaml`
    triggerTextDownload(yaml, filename, 'text/yaml')
  }

  // Bug W15-1: pre-fill form from built-in ceremony template when ?template=<slug> is present.
  useEffect(() => {
    if (!templateSlug || !builtinTemplates) return
    const tpl = builtinTemplates.find((t) => t.slug === templateSlug)
    if (!tpl) {
      setTemplateNotFound(true)
      return
    }
    setTemplateNotFound(false)
    setName(tpl.name)
    if (tpl.description) setDescription(tpl.description)
    if (tpl.yamlContent) {
      try {
        const parsed = parseSteps(tpl.yamlContent)
        setSteps(parsed.steps)
        setHeaderExtras(parsed.header.extras)
      } catch {
        // Bad YAML in template — skip steps pre-fill, form remains partially filled.
      }
    }
    // Auto-expand the manual form so pre-filled fields are visible.
    setShowManualForm(true)
  }, [templateSlug, builtinTemplates])

  // Hydrate from server.
  useEffect(() => {
    if (isNew || !detail) return
    setName(detail.ceremony.name)
    setDescription(detail.ceremony.description ?? '')
    setKind(detail.ceremony.kind)
    setTriggerKind(detail.ceremony.triggerKind)
    setTriggerConfig(detail.ceremony.triggerConfig ?? {})
    if (detail.activeVersion?.yamlContent) {
      try {
        const parsed = parseSteps(detail.activeVersion.yamlContent)
        setSteps(parsed.steps)
        setHeaderExtras(parsed.header.extras)
        // Prefer the YAML's name/description if the metadata is missing them.
        if (!detail.ceremony.description && parsed.header.description) {
          setDescription(parsed.header.description)
        }
      } catch {
        // If YAML is malformed, leave the defaults so the user can still edit.
      }
    }
  }, [isNew, detail])

  const header = useMemo<CeremonyHeader>(
    () => ({
      name,
      description: description.trim() ? description : undefined,
      extras: headerExtras,
    }),
    [name, description, headerExtras],
  )
  const yaml = useMemo(() => emitYaml(header, steps), [header, steps])
  const readOnly = kind === 'narrative'

  // ---------- Step manipulation ----------
  function moveStep(i: number, dir: -1 | 1) {
    const j = i + dir
    if (j < 0 || j >= steps.length) return
    const next = [...steps]
    ;[next[i], next[j]] = [next[j], next[i]]
    setSteps(next)
  }
  function deleteStep(i: number) {
    setSteps((prev) => prev.filter((_, idx) => idx !== i))
  }
  function addStep() {
    setSteps((prev) => [...prev, blankStep('agent_run')])
  }
  function updateStep(i: number, patch: Partial<CeremonyStep>) {
    setSteps((prev) =>
      prev.map((s, idx) => (idx === i ? ({ ...s, ...patch } as CeremonyStep) : s)),
    )
  }
  function changeStepKind(i: number, nextKind: StepKind) {
    setSteps((prev) =>
      prev.map((s, idx) => {
        if (idx !== i) return s
        // Build a fresh step of the new kind, preserving label + extras.
        const fresh = blankStep(nextKind)
        return { ...fresh, label: s.label, extras: s.extras } as CeremonyStep
      }),
    )
  }
  function toggleAdvanced(i: number) {
    setShowAdvancedFor((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  // ---------- Actions ----------
  const handleSave = useCallback(async () => {
    setSaveErr(null)
    setSaveOk(false)
    try {
      if (isNew) {
        const created = await createCeremony.mutateAsync({
          yamlContent: yaml,
          triggerKind,
          triggerConfig,
          kind,
        })
        setSaveOk(true)
        navigate(`/projects/${projectId}/ceremonies/${created.ceremony.id}`, { replace: true })
      } else {
        await updateCeremony.mutateAsync({
          ceremonyId: ceremonyId!,
          name,
          description,
          triggerKind,
          triggerConfig,
          kind,
          yamlContent: yaml,
        })
        setSaveOk(true)
        setTimeout(() => setSaveOk(false), 2500)
      }
    } catch (err) {
      setSaveErr(err instanceof Error ? err.message : 'Save failed')
    }
  }, [isNew, yaml, triggerKind, triggerConfig, kind, name, description, ceremonyId, projectId, createCeremony, updateCeremony, navigate])

  const handleValidate = useCallback(async () => {
    try {
      const r = await validateCeremony.mutateAsync(yaml)
      setValidationErrors(r.errors ?? [])
    } catch (err) {
      setValidationErrors([err instanceof Error ? err.message : String(err)])
    }
  }, [yaml, validateCeremony])

  const handleRunNow = useCallback(async () => {
    if (isNew) {
      setSaveErr('Save the ceremony before running it.')
      return
    }
    try {
      await runCeremony.mutateAsync({ ceremonyId: ceremonyId! })
      setSaveOk(true)
      setTimeout(() => setSaveOk(false), 2500)
    } catch (err) {
      setSaveErr(err instanceof Error ? err.message : 'Run failed')
    }
  }, [isNew, ceremonyId, runCeremony])

  const handlePreviewCron = useCallback(async () => {
    setCronPreviewErr(null)
    setCronPreview(null)
    const cronExpr = (triggerConfig.cronExpr as string | undefined) ?? ''
    const tz = (triggerConfig.timezone as string | undefined) ?? 'UTC'
    if (!cronExpr) {
      setCronPreviewErr('Enter a cron expression first.')
      return
    }
    try {
      // The /preview-cron endpoint is project-scoped on a ceremony id; for a
      // brand-new ceremony we don't have an id yet, so use a sentinel — the
      // endpoint validates the cron string and never reads the ceremony row.
      const idForPreview = isNew ? '00000000-0000-0000-0000-000000000000' : ceremonyId!
      const r = await previewCron.mutateAsync({
        ceremonyId: idForPreview,
        cronExpr,
        timezone: tz,
        count: 3,
      })
      setCronPreview(r.next)
    } catch (err) {
      setCronPreviewErr(err instanceof Error ? err.message : String(err))
    }
  }, [triggerConfig, isNew, ceremonyId, previewCron])

  const handleFormulate = useCallback(async (prose: string) => {
    setFormulateModelUsed(null)
    try {
      const result = await generateFromProse.mutateAsync({ prose })
      const parsed = parseSteps(result.yamlContent)
      if (parsed.header.name?.trim()) setName(parsed.header.name)
      if (parsed.header.description) setDescription(parsed.header.description)
      setHeaderExtras(parsed.header.extras)
      setSteps(parsed.steps)
      setTriggerKind(result.triggerKind)
      setTriggerConfig(result.triggerConfig)
      setFormulateModelUsed({ model: 'AI', via: 'generate-from-prose' })
      setActiveTab('visual')
      setShowManualForm(true)
    } catch {
      // Error surfaced via generateFromProse.error in the FormulatePanel.
    }
  }, [generateFromProse])

  if (!isNew && isLoading) {
    return <SectionLoading label="Loading ceremony…" />
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* ── Header ──────────────────────────────────────────────────────── */}
      {isNew ? (
        <PageHeader
          title="New ceremony"
          actions={
            <>
              <Button appearance="subtle" onClick={() => navigate(`/projects/${projectId}/ceremonies`)}>
                ← Ceremonies
              </Button>
              {saveOk && (
                <Caption1 style={{ color: tokens.colorPaletteGreenForeground1, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Checkmark16Regular /> Saved
                </Caption1>
              )}
              {saveErr && (
                <Caption1 style={{ color: tokens.colorPaletteRedForeground1, display: 'flex', alignItems: 'center', gap: 4 }} title={saveErr}>
                  <Warning16Regular /> {saveErr.slice(0, 60)}
                </Caption1>
              )}
              <Button
                appearance="primary"
                onClick={handleSave}
                disabled={!name.trim() || name === 'New Ceremony'}
              >
                Create
              </Button>
            </>
          }
        />
      ) : (
        <div
          style={{
            padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalXL}`,
            borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
            display: 'flex',
            alignItems: 'center',
            gap: tokens.spacingHorizontalM,
            flexShrink: 0,
          }}
        >
          <Button appearance="subtle" onClick={() => navigate(`/projects/${projectId}/ceremonies`)}>
            ← Ceremonies
          </Button>
          <Input
            value={name}
            onChange={(_, d) => setName(d.value)}
            disabled={readOnly}
            placeholder="Ceremony name"
            style={{ minWidth: 220, fontWeight: 600 }}
          />
          <Badge appearance="filled" color={kind === 'narrative' ? 'warning' : kind === 'workflow' ? 'subtle' : 'brand'}>
            {CEREMONY_KIND_OPTIONS.find((o) => o.value === kind)?.label ?? kind}
          </Badge>
          <Badge appearance="outline" color="informative">
            trigger: {triggerKind}
          </Badge>
          <ScopeBadge triggerKind={triggerKind} triggerConfig={triggerConfig} />

          <div style={{ flex: 1 }} />

          {saveOk && (
            <Caption1 style={{ color: tokens.colorPaletteGreenForeground1, display: 'flex', alignItems: 'center', gap: 4 }}>
              <Checkmark16Regular /> Saved
            </Caption1>
          )}
          {saveErr && (
            <Caption1 style={{ color: tokens.colorPaletteRedForeground1, display: 'flex', alignItems: 'center', gap: 4 }} title={saveErr}>
              <Warning16Regular /> {saveErr.slice(0, 60)}
            </Caption1>
          )}
          <Button onClick={handleValidate} disabled={readOnly}>Validate</Button>
          <Button onClick={handleRunNow} icon={<Play16Regular />} disabled={readOnly}>
            Run now
          </Button>
          {!isNew && (
            <>
              {/* Wave 10 C7: Fluent2 secondary Button + BookmarkAdd icon. */}
              <Button
                appearance="secondary"
                icon={<BookmarkAddRegular />}
                onClick={() => { setSaveTemplateError(null); setTemplateName(name); setTemplateDescription(description); setShowSaveTemplateDialog(true) }}
                disabled={isNew || readOnly}
              >
                Save as template
              </Button>
              <Button
                appearance="secondary"
                icon={<ArrowDownloadRegular />}
                onClick={handleExportYaml}
              >
                Export YAML
              </Button>
              {saveTemplateDone && (
                <Caption1 style={{ color: tokens.colorPaletteGreenForeground1 }}>
                  ✓ Template saved
                </Caption1>
              )}
            </>
          )}
          <Button appearance="primary" onClick={handleSave} disabled={readOnly}>
            Save
          </Button>
        </div>
      )}

      {/* ── Create-mode: progressive Conjure-first layout ───────────────── */}
      {isNew && (
        <div
          style={{
            flex: 1,
            overflow: 'auto',
            padding: `${tokens.spacingVerticalXL} ${tokens.spacingHorizontalXXL}`,
            display: 'flex',
            flexDirection: 'column',
            gap: tokens.spacingVerticalXL,
          }}
        >
          {/* Bug W15-1: template-not-found banner */}
          {templateNotFound && (
            <MessageBar intent="warning">
              <MessageBarBody>
                Template not found — starting with a blank form.
              </MessageBarBody>
            </MessageBar>
          )}
          {/* Template pre-filled notice */}
          {templateSlug && !templateNotFound && builtinTemplates && (
            <MessageBar intent="info">
              <MessageBarBody>
                Pre-filled from template. Review the fields below and save when ready.
              </MessageBarBody>
            </MessageBar>
          )}

          {/* Hero: Formulate */}
          <Card style={{ background: tokens.colorNeutralBackground2 }}>
            <div
              style={{
                padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL}`,
                display: 'flex',
                flexDirection: 'column',
                gap: tokens.spacingVerticalS,
              }}
            >
              <Subtitle1>Describe your ceremony</Subtitle1>
              <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>
                Tell Conjure what it does and it will draft the steps, trigger, and YAML for you.
              </Caption1>
              <FormulatePanel
                placeholder="Describe your ceremony in plain language…"
                hint="e.g., 'Every Monday at 9 am, run a triage agent over open issues and post a digest to the team channel.'"
                isPending={generateFromProse.isPending}
                errorMessage={generateFromProse.error?.message ?? null}
                modelUsed={formulateModelUsed}
                onFormulate={(prose) => void handleFormulate(prose)}
              />
            </div>
          </Card>

          {/* "or build it manually" toggle */}
          <div>
            <Button appearance="subtle" onClick={() => setShowManualForm((v) => !v)}>
              {showManualForm ? '− Collapse manual form' : 'or build it manually →'}
            </Button>
          </div>

          {/* Structured form — revealed on toggle or auto-expanded after Formulate */}
          {showManualForm && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: tokens.spacingVerticalL,
              }}
            >
              {/* Name */}
              <Field label="Name" required hint="Give your ceremony a short, memorable name.">
                <Input
                  value={name}
                  onChange={(_, d) => setName(d.value)}
                  placeholder="e.g., Weekly triage sweep"
                  style={{ maxWidth: 480 }}
                />
              </Field>

              {/* Trigger — compact Dropdown instead of radio cards */}
              <Field
                label="Trigger"
                hint={TRIGGER_KIND_OPTIONS.find((o) => o.value === triggerKind)?.description ?? ''}
              >
                <Dropdown
                  value={TRIGGER_KIND_OPTIONS.find((o) => o.value === triggerKind)?.label ?? triggerKind}
                  selectedOptions={[triggerKind]}
                  onOptionSelect={(_, d) => {
                    setTriggerKind(d.optionValue as TriggerKind)
                    setTriggerConfig({})
                    setCronPreview(null)
                  }}
                  style={{ maxWidth: 320 }}
                >
                  {TRIGGER_KIND_OPTIONS.map((o) => (
                    <Option key={o.value} value={o.value}>{o.label}</Option>
                  ))}
                </Dropdown>
              </Field>

              <TriggerConfigForm
                triggerKind={triggerKind}
                triggerConfig={triggerConfig}
                onChange={setTriggerConfig}
                onPreviewCron={handlePreviewCron}
                cronPreview={cronPreview}
                cronPreviewErr={cronPreviewErr}
                previewLoading={previewCron.isPending}
                disabled={false}
              />

              {/* Advanced — description + kind collapsed by default */}
              <Accordion collapsible>
                <AccordionItem value="advanced">
                  <AccordionHeader expandIconPosition="end">Advanced</AccordionHeader>
                  <AccordionPanel>
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: tokens.spacingVerticalM,
                        paddingTop: tokens.spacingVerticalS,
                      }}
                    >
                      <Field label="Description">
                        <Textarea
                          value={description}
                          onChange={(_, d) => setDescription(d.value)}
                          rows={3}
                        />
                      </Field>
                      <Field
                        label="Kind"
                        hint={CEREMONY_KIND_OPTIONS.find((o) => o.value === kind)?.description ?? ''}
                      >
                        <Dropdown
                          value={CEREMONY_KIND_OPTIONS.find((o) => o.value === kind)?.label ?? kind}
                          selectedOptions={[kind]}
                          onOptionSelect={(_, d) => setKind(d.optionValue as CeremonyKind)}
                          style={{ maxWidth: 280 }}
                        >
                          {CEREMONY_KIND_OPTIONS.filter((o) => !o.deprecated).map((opt) => (
                            <Option key={opt.value} value={opt.value} text={opt.label}>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                <span style={{ fontWeight: 600, opacity: opt.deprecated ? 0.6 : 1 }}>
                                  {opt.label}
                                </span>
                                <span style={{ fontSize: 11, color: 'inherit', opacity: 0.7 }}>
                                  {opt.description}
                                </span>
                              </div>
                            </Option>
                          ))}
                        </Dropdown>
                      </Field>
                    </div>
                  </AccordionPanel>
                </AccordionItem>
              </Accordion>

              {/* Validation errors */}
              {validationErrors.length > 0 && (
                <MessageBar intent="error">
                  <MessageBarBody>
                    {validationErrors.length} validation error{validationErrors.length === 1 ? '' : 's'}:{' '}
                    {validationErrors.join('; ')}
                  </MessageBarBody>
                </MessageBar>
              )}

              {/* Tabs + Step editor */}
              <div
                style={{
                  border: `1px solid ${tokens.colorNeutralStroke1}`,
                  borderRadius: tokens.borderRadiusMedium,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalM}`,
                    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
                  }}
                >
                  <TabList
                    selectedValue={activeTab}
                    onTabSelect={(_e: SelectTabEvent, d: SelectTabData) =>
                      setActiveTab(d.value as 'code' | 'visual')
                    }
                  >
                    <Tab value="code">Code</Tab>
                    <Tab value="visual">Visual</Tab>
                  </TabList>
                </div>

                {activeTab === 'code' && (
                  <div style={{ padding: tokens.spacingVerticalM }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginBottom: tokens.spacingVerticalM,
                      }}
                    >
                      <Subtitle1>Steps ({steps.length})</Subtitle1>
                      <Button icon={<Add16Regular />} onClick={addStep}>
                        Add step
                      </Button>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {steps.length === 0 && (
                        <Card style={{ background: tokens.colorNeutralBackground2 }}>
                          <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                            <Body1 style={{ color: tokens.colorNeutralForeground2 }}>No steps yet.</Body1>
                            <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>
                              Click <strong>+ Add step</strong> to add a step manually, or use{' '}
                              <strong>Describe your ceremony</strong> above to draft from a description.
                            </Caption1>
                          </div>
                        </Card>
                      )}
                      {steps.map((step, i) => (
                        <div
                          key={i}
                          style={{
                            border: '1px solid var(--border)',
                            borderRadius: 6,
                            padding: 12,
                            background: 'var(--surface)',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 8,
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ minWidth: 22, color: 'var(--text-muted)', fontSize: 12 }}>{i + 1}.</span>
                            <Button
                              appearance="subtle"
                              icon={<ArrowUp16Regular />}
                              onClick={() => moveStep(i, -1)}
                              disabled={i === 0}
                              aria-label="Move up"
                            />
                            <Button
                              appearance="subtle"
                              icon={<ArrowDown16Regular />}
                              onClick={() => moveStep(i, 1)}
                              disabled={i === steps.length - 1}
                              aria-label="Move down"
                            />
                            <Dropdown
                              value={STEP_TYPE_OPTIONS.find((o) => o.value === step.kind)?.label ?? step.kind}
                              selectedOptions={[step.kind]}
                              onOptionSelect={(_, d) => changeStepKind(i, d.optionValue as StepKind)}
                              style={{ minWidth: 140 }}
                            >
                              {COMMON_STEP_OPTIONS.map((o) => (
                                <Option key={o.value} value={o.value}>{`${o.label} — ${o.description}`}</Option>
                              ))}
                              <Option disabled value="__advanced_divider__">── Advanced ──</Option>
                              {ADVANCED_STEP_OPTIONS.map((o) => (
                                <Option key={o.value} value={o.value}>{`${o.label} — ${o.description}`}</Option>
                              ))}
                            </Dropdown>
                            <Input
                              value={step.label ?? ''}
                              onChange={(_, d) => updateStep(i, { label: d.value })}
                              placeholder="label"
                              style={{ flex: 1 }}
                            />
                            <Button
                              appearance="subtle"
                              icon={<Delete16Regular />}
                              onClick={() => deleteStep(i)}
                              aria-label="Delete"
                            />
                          </div>
                          {(step.kind === 'agent_run' || step.kind === 'route') && (
                            <>
                              <div style={{ display: 'flex', gap: 8 }}>
                                <Dropdown
                                  placeholder="Pick an agent…"
                                  value={step.agent}
                                  selectedOptions={step.agent ? [step.agent] : []}
                                  onOptionSelect={(_, d) => updateStep(i, { agent: d.optionValue })}
                                  style={{ minWidth: 200 }}
                                >
                                  {(agents ?? []).map((a) => (
                                    <Option key={a.id} value={a.name}>{a.name}</Option>
                                  ))}
                                </Dropdown>
                                <Caption1 style={{ color: 'var(--text-muted)', alignSelf: 'center' }}>
                                  Templates: <code>{'${input.foo}'}</code>, <code>{'${event.payload}'}</code>
                                </Caption1>
                              </div>
                              <Textarea
                                value={step.prompt ?? ''}
                                onChange={(_, d) => updateStep(i, { prompt: d.value })}
                                placeholder="Prompt template (multi-line OK)"
                                rows={3}
                              />
                            </>
                          )}
                          {step.kind === 'handoff' && (
                            <div style={{ display: 'flex', gap: 8, flexDirection: 'column' }}>
                              <Input
                                value={step.to ?? ''}
                                onChange={(_, d) => updateStep(i, { to: d.value })}
                                placeholder="to: agent name"
                              />
                              <Textarea
                                value={step.message ?? ''}
                                onChange={(_, d) => updateStep(i, { message: d.value })}
                                placeholder="message (optional)"
                                rows={2}
                              />
                            </div>
                          )}
                          {step.kind === 'fan_out' && (
                            <div style={{ display: 'flex', gap: 8, flexDirection: 'column' }}>
                              <label style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
                                Spawn mode
                                <Dropdown
                                  value={step.mode === 'parallel' ? 'parallel — spawn all children at once (SDK)' : 'serial — let dispatcher claim children one tick at a time'}
                                  selectedOptions={[step.mode ?? 'serial']}
                                  onOptionSelect={(_, d) => updateStep(i, { mode: d.optionValue as 'serial' | 'parallel' })}
                                >
                                  <Option value="serial">serial — let dispatcher claim children one tick at a time</Option>
                                  <Option value="parallel">parallel — spawn all children at once (SDK)</Option>
                                </Dropdown>
                              </label>
                              <Caption1 style={{ color: 'var(--text-muted)' }}>
                                Other fan_out fields (<code>split_by</code>, <code>agents</code>, <code>merge_strategy</code>) are
                                authored in the YAML preview below and round-trip untouched.
                              </Caption1>
                            </div>
                          )}
                          {step.kind === 'approve' && (
                            <>
                              <Button appearance="transparent" size="small" onClick={() => toggleAdvanced(i)}>
                                {showAdvancedFor.has(i) ? '− Hide advanced' : '+ Show advanced'}
                              </Button>
                              {showAdvancedFor.has(i) && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                  <label style={{ fontSize: 12 }}>
                                    request_changes_policy
                                    <Dropdown
                                      value={step.request_changes_policy ?? 'first'}
                                      selectedOptions={[step.request_changes_policy ?? 'first']}
                                      onOptionSelect={(_, d) =>
                                        updateStep(i, {
                                          request_changes_policy: d.optionValue as 'first' | 'majority' | 'all',
                                        })
                                      }
                                    >
                                      <Option value="first">first</Option>
                                      <Option value="majority">majority</Option>
                                      <Option value="all">all</Option>
                                    </Dropdown>
                                  </label>
                                  <label style={{ fontSize: 12 }}>
                                    timeout
                                    <Input
                                      value={step.timeout ?? ''}
                                      onChange={(_, d) => updateStep(i, { timeout: d.value })}
                                      placeholder="e.g. 24h"
                                    />
                                  </label>
                                  <label style={{ fontSize: 12 }}>
                                    approvers (comma-separated)
                                    <Input
                                      value={(step.approvers ?? []).join(', ')}
                                      onChange={(_, d) =>
                                        updateStep(i, {
                                          approvers: d.value.split(',').map((s) => s.trim()).filter(Boolean),
                                        })
                                      }
                                      placeholder="lead, qa, security"
                                    />
                                  </label>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                    <details style={{ marginTop: 18 }}>
                      <summary style={{ cursor: 'pointer', color: 'var(--text-muted)', fontSize: 12 }}>
                        Preview YAML
                      </summary>
                      <pre
                        style={{
                          background: 'var(--surface)',
                          border: '1px solid var(--border)',
                          borderRadius: 6,
                          padding: 12,
                          fontSize: 12,
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-all',
                          marginTop: 8,
                        }}
                      >
                        {yaml}
                      </pre>
                    </details>
                  </div>
                )}

                {activeTab === 'visual' && (
                  <div style={{ minHeight: 400 }}>
                    <VisualCanvas
                      projectId={projectId}
                      header={header}
                      steps={steps}
                      onChange={(next) => setSteps(next)}
                      disabled={false}
                    />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Edit-mode body ──────────────────────────────────────────────── */}
      {!isNew && (
        <>
          {validationErrors.length > 0 && (
            <MessageBar intent="error">
              <MessageBarBody>
                {validationErrors.length} validation error{validationErrors.length === 1 ? '' : 's'}:{' '}
                {validationErrors.join('; ')}
              </MessageBarBody>
            </MessageBar>
          )}
          <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
            {/* Left: Trigger + meta */}
            <div
              style={{
            width: 380,
            borderRight: '1px solid var(--border)',
            padding: '16px 18px',
            overflow: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
          }}
        >
          <Subtitle1>Trigger</Subtitle1>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <Label weight="semibold">When should this ceremony fire?</Label>
            <RadioGroup
              value={triggerKind}
              onChange={(_, d) => {
                setTriggerKind(d.value as TriggerKind)
                setTriggerConfig({})
                setCronPreview(null)
              }}
              disabled={readOnly}
            >
              {TRIGGER_KIND_OPTIONS.map((o) => (
                <Radio
                  key={o.value}
                  value={o.value}
                  label={`${o.label} — ${o.description}`}
                />
              ))}
            </RadioGroup>
          </div>

          <TriggerConfigForm
            triggerKind={triggerKind}
            triggerConfig={triggerConfig}
            onChange={setTriggerConfig}
            onPreviewCron={handlePreviewCron}
            cronPreview={cronPreview}
            cronPreviewErr={cronPreviewErr}
            previewLoading={previewCron.isPending}
            disabled={readOnly}
          />

          <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '8px 0' }} />

          <Subtitle1>Metadata</Subtitle1>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <Label weight="semibold" htmlFor="ceremony-desc-side">Description</Label>
            <Textarea
              id="ceremony-desc-side"
              value={description}
              onChange={(_, d) => setDescription(d.value)}
              disabled={readOnly}
              rows={3}
            />
            <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>
              Optional — shown in the ceremony list.
            </Caption1>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <Label weight="semibold">Kind</Label>
            <Dropdown
              value={kind}
              selectedOptions={[kind]}
              onOptionSelect={(_, d) => setKind(d.optionValue as CeremonyKind)}
              disabled={readOnly}
            >
              {(['workflow', 'ceremony', 'review_policy'] as CeremonyKind[]).map((k) => (
                <Option key={k} value={k}>{k}</Option>
              ))}
            </Dropdown>
            <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>
              Use <strong>workflow</strong> for most automations.
            </Caption1>
          </div>

          {/* Schedules side-pane (only meaningful for on_schedule). */}
          {triggerKind === 'on_schedule' && !isNew && (
            <SchedulesPanel projectId={projectId} ceremonyId={ceremonyId!} />
          )}

          {triggerKind === 'manual' && (
            <Caption1 style={{ color: 'var(--text-muted)' }}>
              This ceremony is run on-demand via the “Run now” button or the API.
            </Caption1>
          )}
        </div>

        {/* Right: Code / Visual / Prose tabs */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div
            style={{
              padding: '6px 18px',
              borderBottom: '1px solid var(--border)',
              flexShrink: 0,
            }}
          >
            <TabList
              selectedValue={activeTab}
              onTabSelect={(_e: SelectTabEvent, d: SelectTabData) =>
                setActiveTab(d.value as 'code' | 'visual')
              }
            >
              <Tab value="code">Code</Tab>
              <Tab value="visual">Visual</Tab>
            </TabList>
          </div>

          {activeTab === 'code' && (
            <div style={{ flex: 1, padding: '16px 18px', overflow: 'auto' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <Subtitle1>Steps ({steps.length})</Subtitle1>
                <Button icon={<Add16Regular />} onClick={addStep} disabled={readOnly}>
                  Add step
                </Button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {steps.length === 0 && (
                  <Card style={{ background: tokens.colorNeutralBackground2 }}>
                    <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <Body1 style={{ color: tokens.colorNeutralForeground2 }}>No steps yet.</Body1>
                      <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>
                        Click <strong>+ Add step</strong> to add a step manually, or use{' '}
                        <strong>Formulate with AI</strong> above to draft a full ceremony from a description.
                      </Caption1>
                    </div>
                  </Card>
                )}

                {steps.map((step, i) => (
                  <div
                    key={i}
                    style={{
                      border: '1px solid var(--border)',
                      borderRadius: 6,
                      padding: 12,
                      background: 'var(--surface)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                    }}
                  >
                    {/* Row 1: reorder + type + delete */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ minWidth: 22, color: 'var(--text-muted)', fontSize: 12 }}>{i + 1}.</span>
                      <Button
                        appearance="subtle"
                        icon={<ArrowUp16Regular />}
                        onClick={() => moveStep(i, -1)}
                        disabled={readOnly || i === 0}
                        aria-label="Move up"
                      />
                      <Button
                        appearance="subtle"
                        icon={<ArrowDown16Regular />}
                        onClick={() => moveStep(i, 1)}
                        disabled={readOnly || i === steps.length - 1}
                        aria-label="Move down"
                      />
                      <Dropdown
                        value={STEP_TYPE_OPTIONS.find((o) => o.value === step.kind)?.label ?? step.kind}
                        selectedOptions={[step.kind]}
                        onOptionSelect={(_, d) => changeStepKind(i, d.optionValue as StepKind)}
                        disabled={readOnly}
                        style={{ minWidth: 140 }}
                      >
                        {COMMON_STEP_OPTIONS.map((o) => (
                          <Option key={o.value} value={o.value}>{`${o.label} — ${o.description}`}</Option>
                        ))}
                        <Option disabled value="__advanced_divider__">── Advanced ──</Option>
                        {ADVANCED_STEP_OPTIONS.map((o) => (
                          <Option key={o.value} value={o.value}>{`${o.label} — ${o.description}`}</Option>
                        ))}
                      </Dropdown>
                      <Input
                        value={step.label ?? ''}
                        onChange={(_, d) => updateStep(i, { label: d.value })}
                        placeholder="label"
                        disabled={readOnly}
                        style={{ flex: 1 }}
                      />
                      <Button
                        appearance="subtle"
                        icon={<Delete16Regular />}
                        onClick={() => deleteStep(i)}
                        disabled={readOnly}
                        aria-label="Delete"
                      />
                    </div>

                    {/* Row 2: agent + prompt (for agent_run/route) */}
                    {(step.kind === 'agent_run' || step.kind === 'route') && (
                      <>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <Dropdown
                            placeholder="Pick an agent…"
                            value={step.agent}
                            selectedOptions={step.agent ? [step.agent] : []}
                            onOptionSelect={(_, d) => updateStep(i, { agent: d.optionValue })}
                            disabled={readOnly}
                            style={{ minWidth: 200 }}
                          >
                            {(agents ?? []).map((a) => (
                              <Option key={a.id} value={a.name}>{a.name}</Option>
                            ))}
                          </Dropdown>
                          <Caption1 style={{ color: 'var(--text-muted)', alignSelf: 'center' }}>
                            Templates: <code>{'${input.foo}'}</code>, <code>{'${event.payload}'}</code>
                          </Caption1>
                        </div>
                        <Textarea
                          value={step.prompt ?? ''}
                          onChange={(_, d) => updateStep(i, { prompt: d.value })}
                          placeholder="Prompt template (multi-line OK)"
                          disabled={readOnly}
                          rows={3}
                        />
                      </>
                    )}

                    {step.kind === 'handoff' && (
                      <div style={{ display: 'flex', gap: 8, flexDirection: 'column' }}>
                        <Input
                          value={step.to ?? ''}
                          onChange={(_, d) => updateStep(i, { to: d.value })}
                          placeholder="to: agent name"
                          disabled={readOnly}
                        />
                        <Textarea
                          value={step.message ?? ''}
                          onChange={(_, d) => updateStep(i, { message: d.value })}
                          placeholder="message (optional)"
                          disabled={readOnly}
                          rows={2}
                        />
                      </div>
                    )}

                    {step.kind === 'fan_out' && (
                      <div style={{ display: 'flex', gap: 8, flexDirection: 'column' }}>
                        <label style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
                          Spawn mode
                          <Dropdown
                            value={step.mode === 'parallel' ? 'parallel — spawn all children at once (SDK)' : 'serial — let dispatcher claim children one tick at a time'}
                            selectedOptions={[step.mode ?? 'serial']}
                            onOptionSelect={(_, d) => updateStep(i, { mode: d.optionValue as 'serial' | 'parallel' })}
                            disabled={readOnly}
                          >
                            <Option value="serial">serial — let dispatcher claim children one tick at a time</Option>
                            <Option value="parallel">parallel — spawn all children at once (SDK)</Option>
                          </Dropdown>
                        </label>
                        <Caption1 style={{ color: 'var(--text-muted)' }}>
                          Phase 15: <code>parallel</code> calls the SDK's <code>spawnParallel()</code> immediately
                          after materialise so every child's first LLM session starts within ~1s instead of waiting
                          ~5s per child for the dispatcher to claim it. Failures are isolated per child;
                          on spawn error the dispatcher recovery path takes over.
                        </Caption1>
                        <Caption1 style={{ color: 'var(--text-muted)' }}>
                          Other fan_out fields (<code>split_by</code>, <code>agents</code>, <code>merge_strategy</code>) are
                          currently authored in the YAML preview below and round-trip untouched.
                        </Caption1>
                      </div>
                    )}

                    {/* Advanced toggle */}
                    {step.kind === 'approve' && (
                      <>
                        <Button appearance="transparent" size="small" onClick={() => toggleAdvanced(i)}>
                          {showAdvancedFor.has(i) ? '− Hide advanced' : '+ Show advanced'}
                        </Button>
                        {showAdvancedFor.has(i) && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            <label style={{ fontSize: 12 }}>
                              request_changes_policy
                              <Dropdown
                                value={step.request_changes_policy ?? 'first'}
                                selectedOptions={[step.request_changes_policy ?? 'first']}
                                onOptionSelect={(_, d) => updateStep(i, { request_changes_policy: d.optionValue as 'first' | 'majority' | 'all' })}
                                disabled={readOnly}
                              >
                                <Option value="first">first</Option>
                                <Option value="majority">majority</Option>
                                <Option value="all">all</Option>
                              </Dropdown>
                            </label>
                            <label style={{ fontSize: 12 }}>
                              timeout
                              <Input
                                value={step.timeout ?? ''}
                                onChange={(_, d) => updateStep(i, { timeout: d.value })}
                                placeholder="e.g. 24h"
                                disabled={readOnly}
                              />
                            </label>
                            <label style={{ fontSize: 12 }}>
                              approvers (comma-separated)
                              <Input
                                value={(step.approvers ?? []).join(', ')}
                                onChange={(_, d) =>
                                  updateStep(i, {
                                    approvers: d.value
                                      .split(',')
                                      .map((s) => s.trim())
                                      .filter(Boolean),
                                  })
                                }
                                placeholder="lead, qa, security"
                                disabled={readOnly}
                              />
                            </label>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ))}
              </div>

              {/* YAML preview */}
              <details style={{ marginTop: 18 }}>
                <summary style={{ cursor: 'pointer', color: 'var(--text-muted)', fontSize: 12 }}>
                  Preview YAML
                </summary>
                <pre
                  style={{
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    padding: 12,
                    fontSize: 12,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                    marginTop: 8,
                  }}
                >
                  {yaml}
                </pre>
              </details>
            </div>
          )}

          {activeTab === 'visual' && (
            <div style={{ flex: 1, minHeight: 0 }}>
              <VisualCanvas
                projectId={projectId}
                header={header}
                steps={steps}
                onChange={(next) => setSteps(next)}
                disabled={readOnly}
              />
            </div>
          )}
        </div>
      </div>

      {/* Save-as-template Dialog */}
      {showSaveTemplateDialog && (
        <Dialog open onOpenChange={(_, d) => { if (!d.open) setShowSaveTemplateDialog(false) }}>
          <DialogSurface style={{ maxWidth: 440 }}>
            <DialogBody>
              <DialogTitle>Save ceremony as template</DialogTitle>
              <DialogContent style={{ display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalM }}>
                <Field label="Template name" required>
                  <Input
                    value={templateName}
                    onChange={(_, d) => setTemplateName(d.value)}
                    placeholder="e.g., Weekly triage sweep"
                    autoFocus
                  />
                </Field>
                <Field label="Description">
                  <Textarea
                    value={templateDescription}
                    onChange={(_, d) => setTemplateDescription(d.value)}
                    placeholder="What does this ceremony do?"
                    rows={3}
                  />
                </Field>
                {saveTemplateError && (
                  <Caption1 style={{ color: tokens.colorPaletteRedForeground1 }}>{saveTemplateError}</Caption1>
                )}
              </DialogContent>
              <DialogActions>
                <Button appearance="secondary" onClick={() => setShowSaveTemplateDialog(false)}>Cancel</Button>
                <Button
                  appearance="primary"
                  disabled={!templateName.trim() || saveWorkflowAsTemplate.isPending}
                  onClick={() => void handleSaveAsTemplate()}
                >
                  {saveWorkflowAsTemplate.isPending ? 'Saving…' : 'Save template'}
                </Button>
              </DialogActions>
            </DialogBody>
          </DialogSurface>
        </Dialog>
      )}
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Trigger config form (per-triggerKind discriminated UI)
// ---------------------------------------------------------------------------

function TriggerConfigForm({
  triggerKind,
  triggerConfig,
  onChange,
  onPreviewCron,
  cronPreview,
  cronPreviewErr,
  previewLoading,
  disabled,
}: {
  triggerKind: TriggerKind
  triggerConfig: Record<string, unknown>
  onChange: (next: Record<string, unknown>) => void
  onPreviewCron: () => void
  cronPreview: string[] | null
  cronPreviewErr: string | null
  previewLoading: boolean
  disabled: boolean
}) {
  const set = (k: string, v: unknown) => onChange({ ...triggerConfig, [k]: v })

  if (triggerKind === 'on_issue_entry') {
    const currentScope = (triggerConfig.scope as string) ?? 'project'
    const SCOPE_HELP: Record<string, string> = {
      project: 'Trigger fires for ANY board in the project that matches column_slug + labels.',
      board: 'Trigger fires only for the specified board.',
      task: 'Trigger fires only for a specific issue/card.',
    }
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <Label weight="semibold">Scope</Label>
          <Dropdown
            value={currentScope}
            selectedOptions={[currentScope]}
            onOptionSelect={(_, d) => set('scope', d.optionValue)}
            disabled={disabled}
          >
            <Option value="project">project</Option>
            <Option value="board">board</Option>
            <Option value="task">task</Option>
          </Dropdown>
          <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>
            {SCOPE_HELP[currentScope] ?? ''}
          </Caption1>
          {(currentScope === 'board' || currentScope === 'task') && (
            <MessageBar intent="info" style={{ marginTop: 4 }}>
              <MessageBarBody>
                {currentScope === 'board'
                  ? 'Scope set to board — this trigger will only fire for the specified board; existing matches in other boards will stop firing.'
                  : 'Scope set to task — this trigger will only fire for a specific issue/card; existing matches in other tasks will stop firing.'}
              </MessageBarBody>
            </MessageBar>
          )}
        </div>
        <label style={{ fontSize: 12 }}>
          column slug (optional)
          <Input
            value={(triggerConfig.columnSlug as string) ?? ''}
            onChange={(_, d) => set('columnSlug', d.value)}
            placeholder="e.g. in_review"
            disabled={disabled}
          />
        </label>
        <label style={{ fontSize: 12 }}>
          labels (comma-separated, optional)
          <Input
            value={Array.isArray(triggerConfig.labelIds) ? (triggerConfig.labelIds as string[]).join(', ') : ''}
            onChange={(_, d) => set('labelIds', d.value.split(',').map((s) => s.trim()).filter(Boolean))}
            placeholder="bug, security"
            disabled={disabled}
          />
        </label>
      </div>
    )
  }

  if (triggerKind === 'on_schedule') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Label weight="semibold">Cron expression</Label>
          <Input
            value={(triggerConfig.cronExpr as string) ?? ''}
            onChange={(_, d) => set('cronExpr', d.value)}
            placeholder="0 9 * * 1"
            disabled={disabled}
          />
          <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>
            Standard 5-field cron, e.g. <code>0 9 * * 1</code> = every Monday at 9 am UTC.
          </Caption1>
        </div>
        <label style={{ fontSize: 12 }}>
          timezone
          <Dropdown
            value={(triggerConfig.timezone as string) ?? 'UTC'}
            selectedOptions={[(triggerConfig.timezone as string) ?? 'UTC']}
            onOptionSelect={(_, d) => set('timezone', d.optionValue)}
            disabled={disabled}
          >
            {TIMEZONE_OPTIONS.map((tz) => (
              <Option key={tz} value={tz}>{tz}</Option>
            ))}
          </Dropdown>
        </label>
        <Button onClick={onPreviewCron} disabled={disabled || previewLoading}>
          {previewLoading ? 'Computing…' : 'Preview next 3 fires'}
        </Button>
        {cronPreview && (
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
            {cronPreview.map((t) => <li key={t}>{safeAbsoluteTime(t)}</li>)}
          </ul>
        )}
        {cronPreviewErr && (
          <Caption1 style={{ color: '#f85149' }}>{cronPreviewErr}</Caption1>
        )}
        <Caption1 style={{ color: 'var(--text-muted)' }}>
          Save the ceremony, then create a schedule below to start firing.
        </Caption1>
      </div>
    )
  }

  if (triggerKind === 'on_event') {
    return (
      <label style={{ fontSize: 12 }}>
        event type
        <Dropdown
          value={(triggerConfig.eventType as string) ?? 'deliverable.created'}
          selectedOptions={[(triggerConfig.eventType as string) ?? 'deliverable.created']}
          onOptionSelect={(_, d) => set('eventType', d.optionValue)}
          disabled={disabled}
        >
          {EVENT_TYPE_OPTIONS.map((t) => (
            <Option key={t} value={t}>{t}</Option>
          ))}
        </Dropdown>
      </label>
    )
  }

  return null
}

// ---------------------------------------------------------------------------
// Schedules panel (visible for on_schedule, after the ceremony exists)
// ---------------------------------------------------------------------------

function SchedulesPanel({ projectId, ceremonyId }: { projectId: string; ceremonyId: string }) {
  const { data: schedules } = useCeremonySchedules(projectId, ceremonyId)
  const createSched = useCreateSchedule(projectId, ceremonyId)
  const deleteSched = useDeleteSchedule(projectId, ceremonyId)
  const [newCron, setNewCron] = useState('')
  const [newTz, setNewTz] = useState('UTC')
  const [enabled, setEnabled] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  async function handleAdd() {
    setErr(null)
    if (!newCron) {
      setErr('Cron expression required')
      return
    }
    try {
      await createSched.mutateAsync({ cronExpr: newCron, timezone: newTz, enabled })
      setNewCron('')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to create')
    }
  }

  return (
    <div
      style={{
        marginTop: 8,
        padding: 12,
        border: '1px solid var(--border)',
        borderRadius: 6,
        background: 'var(--surface)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <Subtitle1 style={{ fontSize: 14 }}>Schedules</Subtitle1>
      {(schedules ?? []).length === 0 && (
        <Caption1 style={{ color: 'var(--text-muted)' }}>No schedules yet.</Caption1>
      )}
      {(schedules ?? []).map((s) => (
        <div
          key={s.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 12,
            padding: '4px 0',
            borderBottom: '1px dashed var(--border)',
          }}
        >
          <code>{s.cronExpr}</code>
          <span style={{ color: 'var(--text-muted)' }}>{s.timezone}</span>
          <span style={{ color: s.enabled ? '#3fb950' : '#999' }}>{s.enabled ? 'on' : 'off'}</span>
          <span style={{ color: 'var(--text-muted)', flex: 1 }}>
            next: {safeAbsoluteTime(s.nextFireAt)}
          </span>
          <Button
            appearance="subtle"
            size="small"
            icon={<Delete16Regular />}
            onClick={() => deleteSched.mutate(s.id)}
          />
        </div>
      ))}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6 }}>
        <Input value={newCron} onChange={(_, d) => setNewCron(d.value)} placeholder="*/5 * * * *" style={{ flex: 1 }} />
        <Dropdown value={newTz} selectedOptions={[newTz]} onOptionSelect={(_, d) => setNewTz(d.optionValue!)}>
          {TIMEZONE_OPTIONS.map((t) => <Option key={t} value={t}>{t}</Option>)}
        </Dropdown>
        <Switch checked={enabled} onChange={(_, d) => setEnabled(d.checked)} />
        <Button icon={<Add16Regular />} onClick={handleAdd}>Add</Button>
      </div>
      {err && <Caption1 style={{ color: '#f85149' }}>{err}</Caption1>}
    </div>
  )
}
