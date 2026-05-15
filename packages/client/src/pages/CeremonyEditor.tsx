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
import { useParams, useNavigate, Navigate } from 'react-router'
import {
  useCeremony,
  useCreateCeremony,
  useUpdateCeremony,
  useRunCeremony,
  useValidateCeremony,
  usePreviewCron,
  useConvertCeremony,
  useCeremonySchedules,
  useCreateSchedule,
  useDeleteSchedule,
  type TriggerKind,
  type CeremonyKind,
} from '../api/ceremonies.ts'
import { useAgents } from '../api/agents.ts'
import {
  Subtitle1,
  Caption1,
  Badge,
  Button,
  Dropdown,
  Option,
  Input,
  Textarea,
  Spinner,
  MessageBar,
  MessageBarBody,
  Switch,
} from '@fluentui/react-components'
import {
  ArrowUp16Regular,
  ArrowDown16Regular,
  Delete16Regular,
  Add16Regular,
  Play16Regular,
  Checkmark16Regular,
  Warning16Regular,
} from '@fluentui/react-icons'

// ---------------------------------------------------------------------------
// Local step type — superset of WorkflowStepFlow.WorkflowStep so we can edit
// the richer schema (type, agent, prompt, kind variants).
// ---------------------------------------------------------------------------

type StepType = 'agent_run' | 'route' | 'approve' | 'fan_out' | 'handoff'

interface UIStep {
  type: StepType
  label?: string
  agent?: string
  prompt?: string
  // Approve advanced
  approvers?: string[]
  request_changes_policy?: 'first' | 'majority' | 'all'
  timeout?: string
  // Handoff
  to?: string
  message?: string
}

const STEP_TYPE_OPTIONS: { value: StepType; label: string }[] = [
  { value: 'agent_run', label: 'Agent run' },
  { value: 'route', label: 'Route' },
  { value: 'approve', label: 'Peer review' },
  { value: 'fan_out', label: 'Fan out' },
  { value: 'handoff', label: 'Handoff' },
]

const TRIGGER_KIND_OPTIONS: { value: TriggerKind; label: string }[] = [
  { value: 'on_issue_entry', label: 'On issue entry' },
  { value: 'on_schedule', label: 'On schedule (cron)' },
  { value: 'on_event', label: 'On event' },
  { value: 'manual', label: 'Manual (run on demand)' },
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
// Tiny YAML emitter (no runtime YAML lib on the client)
// ---------------------------------------------------------------------------

function emitYaml(name: string, description: string | undefined, steps: UIStep[]): string {
  const lines: string[] = []
  lines.push(`name: ${quoteIfNeeded(name)}`)
  if (description && description.trim()) {
    lines.push(`description: ${quoteIfNeeded(description)}`)
  }
  lines.push('steps:')
  for (const s of steps) {
    lines.push(`  - type: ${s.type}`)
    if (s.label) lines.push(`    label: ${quoteIfNeeded(s.label)}`)
    if (s.agent) lines.push(`    agent: ${quoteIfNeeded(s.agent)}`)
    if (s.prompt) {
      const promptLines = s.prompt.split('\n')
      if (promptLines.length === 1) {
        lines.push(`    prompt: ${quoteIfNeeded(s.prompt)}`)
      } else {
        lines.push('    prompt: |')
        for (const pl of promptLines) lines.push(`      ${pl}`)
      }
    }
    if (s.type === 'approve') {
      if (s.approvers && s.approvers.length > 0) {
        lines.push('    approvers:')
        for (const a of s.approvers) lines.push(`      - ${quoteIfNeeded(a)}`)
      }
      if (s.request_changes_policy) lines.push(`    request_changes_policy: ${s.request_changes_policy}`)
      if (s.timeout) lines.push(`    timeout: ${quoteIfNeeded(s.timeout)}`)
    }
    if (s.type === 'handoff') {
      if (s.to) lines.push(`    to: ${quoteIfNeeded(s.to)}`)
      if (s.message) lines.push(`    message: ${quoteIfNeeded(s.message)}`)
    }
  }
  return lines.join('\n') + '\n'
}

function quoteIfNeeded(v: string): string {
  if (/[:#\[\]&*!|>'"%@`]/.test(v) || v.includes('\n') || /^\s|\s$/.test(v)) {
    return JSON.stringify(v)
  }
  return v
}

// Naive YAML→UIStep parser sufficient for files we emit ourselves.
function parseSteps(yaml: string): UIStep[] {
  const out: UIStep[] = []
  const lines = yaml.split('\n')
  let inSteps = false
  let cur: Partial<UIStep> | null = null
  let inPromptBlock = false
  let promptBuf: string[] = []
  let inApproversBlock = false

  function commit() {
    if (cur && cur.type) {
      if (inPromptBlock) {
        cur.prompt = promptBuf.join('\n').replace(/\n+$/, '')
      }
      out.push(cur as UIStep)
    }
    cur = null
    inPromptBlock = false
    inApproversBlock = false
    promptBuf = []
  }

  for (const raw of lines) {
    const stripped = raw.trimStart()
    if (/^steps\s*:/.test(stripped)) {
      inSteps = true
      continue
    }
    if (!inSteps) continue
    if (/^- type\s*:\s*/.test(stripped)) {
      commit()
      const t = stripped.replace(/^- type\s*:\s*/, '').trim() as StepType
      cur = { type: t }
      continue
    }
    if (!cur) continue
    if (inPromptBlock) {
      // Prompt continuation: indented at >4 spaces
      if (raw.startsWith('      ')) {
        promptBuf.push(raw.slice(6))
        continue
      }
      cur.prompt = promptBuf.join('\n').replace(/\n+$/, '')
      inPromptBlock = false
      promptBuf = []
    }
    if (inApproversBlock) {
      const m = stripped.match(/^-\s+(.+)/)
      if (m) {
        cur.approvers = cur.approvers ?? []
        cur.approvers.push(unquote(m[1].trim()))
        continue
      }
      inApproversBlock = false
    }
    let m = stripped.match(/^label\s*:\s*(.+)/)
    if (m) { cur.label = unquote(m[1].trim()); continue }
    m = stripped.match(/^agent\s*:\s*(.+)/)
    if (m) { cur.agent = unquote(m[1].trim()); continue }
    m = stripped.match(/^prompt\s*:\s*(\|)?\s*(.*)?/)
    if (m) {
      if (m[1] === '|') {
        inPromptBlock = true
        promptBuf = []
      } else if (m[2]) {
        cur.prompt = unquote(m[2].trim())
      }
      continue
    }
    if (/^approvers\s*:\s*$/.test(stripped)) {
      inApproversBlock = true
      cur.approvers = []
      continue
    }
    m = stripped.match(/^request_changes_policy\s*:\s*(.+)/)
    if (m) { cur.request_changes_policy = unquote(m[1].trim()) as 'first' | 'majority' | 'all'; continue }
    m = stripped.match(/^timeout\s*:\s*(.+)/)
    if (m) { cur.timeout = unquote(m[1].trim()); continue }
    m = stripped.match(/^to\s*:\s*(.+)/)
    if (m) { cur.to = unquote(m[1].trim()); continue }
    m = stripped.match(/^message\s*:\s*(.+)/)
    if (m) { cur.message = unquote(m[1].trim()); continue }
    // Top-level field outside steps
    if (!raw.startsWith(' ') && stripped.length > 0) {
      commit()
      inSteps = false
    }
  }
  commit()
  return out
}

function unquote(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    try { return JSON.parse(s.replace(/^'/, '"').replace(/'$/, '"')) as string } catch { return s.slice(1, -1) }
  }
  return s
}

const DEFAULT_STEPS: UIStep[] = [
  { type: 'agent_run', label: 'Run primary agent', agent: '', prompt: '' },
  { type: 'approve', label: 'Human review', request_changes_policy: 'first', timeout: '24h' },
]

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CeremonyEditor() {
  const { id: projectId, ceremonyId } = useParams<{ id: string; ceremonyId?: string }>()
  const isNew = !ceremonyId || ceremonyId === 'new'
  const navigate = useNavigate()

  if (!projectId) return <Navigate to="/" replace />

  const { data: detail, isLoading } = useCeremony(projectId, isNew ? '' : ceremonyId!)
  const createCeremony = useCreateCeremony(projectId)
  const updateCeremony = useUpdateCeremony(projectId)
  const runCeremony = useRunCeremony(projectId)
  const validateCeremony = useValidateCeremony()
  const previewCron = usePreviewCron(projectId)
  const convertCeremony = useConvertCeremony(projectId)

  // Editor state (initialised from the loaded ceremony or defaults).
  const [name, setName] = useState('New Ceremony')
  const [description, setDescription] = useState<string>('')
  const [kind, setKind] = useState<CeremonyKind>('ceremony')
  const [triggerKind, setTriggerKind] = useState<TriggerKind>('manual')
  const [triggerConfig, setTriggerConfig] = useState<Record<string, unknown>>({})
  const [steps, setSteps] = useState<UIStep[]>(DEFAULT_STEPS)
  const [showAdvancedFor, setShowAdvancedFor] = useState<Set<number>>(new Set())

  const [saveErr, setSaveErr] = useState<string | null>(null)
  const [saveOk, setSaveOk] = useState(false)
  const [validationErrors, setValidationErrors] = useState<string[]>([])
  const [cronPreview, setCronPreview] = useState<string[] | null>(null)
  const [cronPreviewErr, setCronPreviewErr] = useState<string | null>(null)
  const [convertToast, setConvertToast] = useState<string | null>(null)

  const { data: agents } = useAgents(projectId)

  // Hydrate from server.
  useEffect(() => {
    if (isNew || !detail) return
    setName(detail.ceremony.name)
    setDescription(detail.ceremony.description ?? '')
    setKind(detail.ceremony.kind)
    setTriggerKind(detail.ceremony.triggerKind)
    setTriggerConfig(detail.ceremony.triggerConfig ?? {})
    if (detail.activeVersion?.yamlContent) {
      setSteps(parseSteps(detail.activeVersion.yamlContent))
    }
  }, [isNew, detail])

  const yaml = useMemo(() => emitYaml(name, description, steps), [name, description, steps])
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
    setSteps((prev) => [...prev, { type: 'agent_run', label: '', agent: '', prompt: '' }])
  }
  function updateStep(i: number, patch: Partial<UIStep>) {
    setSteps((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)))
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

  const handleConvert = useCallback(async () => {
    if (isNew) return
    try {
      await convertCeremony.mutateAsync(ceremonyId!)
      setConvertToast('Ceremony converted.')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // 501 surfaces as a fetch error containing the body
      if (/not yet implemented|Phase 11|501/i.test(msg)) {
        setConvertToast('Coming in Phase 11')
      } else {
        setConvertToast(msg)
      }
      setTimeout(() => setConvertToast(null), 4000)
    }
  }, [isNew, ceremonyId, convertCeremony])

  if (!isNew && isLoading) {
    return <div style={{ padding: 32 }}><Spinner label="Loading ceremony…" /></div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div
        style={{
          padding: '12px 20px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
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
          kind: {kind}
        </Badge>
        <Badge appearance="outline" color="informative">
          trigger: {triggerKind}
        </Badge>

        <div style={{ flex: 1 }} />

        {saveOk && (
          <Caption1 style={{ color: '#3fb950', display: 'flex', alignItems: 'center', gap: 4 }}>
            <Checkmark16Regular /> Saved
          </Caption1>
        )}
        {saveErr && (
          <Caption1 style={{ color: '#f85149', display: 'flex', alignItems: 'center', gap: 4 }} title={saveErr}>
            <Warning16Regular /> {saveErr.slice(0, 60)}
          </Caption1>
        )}
        <Button onClick={handleValidate} disabled={readOnly}>Validate</Button>
        <Button onClick={handleRunNow} icon={<Play16Regular />} disabled={readOnly || isNew}>
          Run now
        </Button>
        <Button appearance="primary" onClick={handleSave} disabled={readOnly}>
          {isNew ? 'Create' : 'Save'}
        </Button>
      </div>

      {/* Validation errors banner */}
      {validationErrors.length > 0 && (
        <MessageBar intent="error">
          <MessageBarBody>
            {validationErrors.length} validation error{validationErrors.length === 1 ? '' : 's'}:{' '}
            {validationErrors.join('; ')}
          </MessageBarBody>
        </MessageBar>
      )}
      {convertToast && (
        <MessageBar intent={convertToast === 'Coming in Phase 11' ? 'info' : 'warning'}>
          <MessageBarBody>{convertToast}</MessageBarBody>
        </MessageBar>
      )}

      {/* ── Body ───────────────────────────────────────────────────────── */}
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

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
            Trigger kind
            <Dropdown
              value={TRIGGER_KIND_OPTIONS.find((o) => o.value === triggerKind)?.label}
              selectedOptions={[triggerKind]}
              onOptionSelect={(_, d) => {
                setTriggerKind(d.optionValue as TriggerKind)
                setTriggerConfig({})
                setCronPreview(null)
              }}
              disabled={readOnly}
            >
              {TRIGGER_KIND_OPTIONS.map((o) => (
                <Option key={o.value} value={o.value}>{o.label}</Option>
              ))}
            </Dropdown>
          </label>

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
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
            Description
            <Textarea
              value={description}
              onChange={(_, d) => setDescription(d.value)}
              disabled={readOnly}
              rows={3}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
            Kind
            <Dropdown
              value={kind}
              selectedOptions={[kind]}
              onOptionSelect={(_, d) => setKind(d.optionValue as CeremonyKind)}
              disabled={readOnly}
            >
              {(['ceremony', 'workflow', 'review_policy', 'narrative'] as CeremonyKind[]).map((k) => (
                <Option key={k} value={k}>{k}</Option>
              ))}
            </Dropdown>
          </label>

          {/* Schedules side-pane (only meaningful for on_schedule). */}
          {triggerKind === 'on_schedule' && !isNew && (
            <SchedulesPanel projectId={projectId} ceremonyId={ceremonyId!} />
          )}

          {kind === 'narrative' && (
            <div
              style={{
                marginTop: 12,
                padding: 12,
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                fontSize: 12,
                color: 'var(--text-muted)',
              }}
            >
              This ceremony is documentation only — convert to executable to enable scheduling/runs.
              <div style={{ marginTop: 8 }}>
                <Button onClick={handleConvert} disabled={isNew}>Convert to executable</Button>
              </div>
            </div>
          )}

          {triggerKind === 'manual' && (
            <Caption1 style={{ color: 'var(--text-muted)' }}>
              This ceremony is run on-demand via the “Run now” button or the API.
            </Caption1>
          )}
        </div>

        {/* Right: Steps */}
        <div style={{ flex: 1, padding: '16px 18px', overflow: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <Subtitle1>Steps ({steps.length})</Subtitle1>
            <Button icon={<Add16Regular />} onClick={addStep} disabled={readOnly}>
              Add step
            </Button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {steps.length === 0 && (
              <Caption1 style={{ color: 'var(--text-muted)' }}>
                No steps yet — click “Add step” to get started.
              </Caption1>
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
                    value={STEP_TYPE_OPTIONS.find((o) => o.value === step.type)?.label}
                    selectedOptions={[step.type]}
                    onOptionSelect={(_, d) => updateStep(i, { type: d.optionValue as StepType })}
                    disabled={readOnly}
                    style={{ minWidth: 140 }}
                  >
                    {STEP_TYPE_OPTIONS.map((o) => (
                      <Option key={o.value} value={o.value}>{o.label}</Option>
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
                {(step.type === 'agent_run' || step.type === 'route') && (
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

                {step.type === 'handoff' && (
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

                {/* Advanced toggle */}
                {step.type === 'approve' && (
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
      </div>
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
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <label style={{ fontSize: 12 }}>
          scope
          <Dropdown
            value={(triggerConfig.scope as string) ?? 'project'}
            selectedOptions={[(triggerConfig.scope as string) ?? 'project']}
            onOptionSelect={(_, d) => set('scope', d.optionValue)}
            disabled={disabled}
          >
            <Option value="project">project</Option>
            <Option value="board">board</Option>
            <Option value="task">task</Option>
          </Dropdown>
        </label>
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
        <label style={{ fontSize: 12 }}>
          cron expression
          <Input
            value={(triggerConfig.cronExpr as string) ?? ''}
            onChange={(_, d) => set('cronExpr', d.value)}
            placeholder="e.g. */5 * * * *"
            disabled={disabled}
          />
        </label>
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
            {cronPreview.map((t) => <li key={t}>{new Date(t).toLocaleString()}</li>)}
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
            next: {new Date(s.nextFireAt).toLocaleString()}
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
