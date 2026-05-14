import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router'
import { useWorkflow, useCreateWorkflow, useUpdateWorkflow } from '../api/workflows.ts'
import WorkflowStepFlow, { type WorkflowStep } from '../components/workflows/WorkflowStepFlow.tsx'
import TemplatePicker from '../components/workflows/TemplatePicker.tsx'
import { ClipboardPaste20Regular, Warning20Regular, Checkmark20Regular } from '@fluentui/react-icons'

// ---------------------------------------------------------------------------
// Simple YAML → step parser (no external dependency)
// ---------------------------------------------------------------------------

function parseSteps(yaml: string): WorkflowStep[] {
  const steps: WorkflowStep[] = []
  const lines = yaml.split('\n')
  let inSteps = false
  let current: Partial<WorkflowStep> | null = null

  for (const line of lines) {
    const stripped = line.trimStart()

    if (/^steps\s*:/.test(stripped)) {
      inSteps = true
      continue
    }

    if (!inSteps) continue

    // New step entry
    if (/^- type\s*:\s*/.test(stripped)) {
      if (current?.type) steps.push(current as WorkflowStep)
      current = { type: stripped.replace(/^- type\s*:\s*/, '').trim() }
      continue
    }

    if (!current) continue

    const labelMatch = stripped.match(/^label\s*:\s*(.+)/)
    if (labelMatch) { current.label = labelMatch[1].trim(); continue }

    const agentMatch = stripped.match(/^agent\s*:\s*(.+)/)
    if (agentMatch) { current.agent = agentMatch[1].trim(); continue }

    // A new top-level key that isn't a step field signals end of step
    if (/^[a-zA-Z]/.test(stripped) && !stripped.startsWith('-')) {
      if (current?.type) { steps.push(current as WorkflowStep); current = null }
      inSteps = false
    }
  }

  if (current?.type) steps.push(current as WorkflowStep)
  return steps
}

function parseWorkflowName(yaml: string): string {
  const m = yaml.match(/^name\s*:\s*(.+)/m)
  return m ? m[1].trim() : ''
}

// ---------------------------------------------------------------------------
// Syntax-highlight keywords in a textarea overlay approach
// (using a pre/code overlay behind a transparent textarea)
// ---------------------------------------------------------------------------

function highlightYaml(raw: string): string {
  // Escape HTML first
  let s = raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  // Color specific keywords
  s = s.replace(/(^(\s*)-\s+type\s*:\s*)(route|agent_run|approve)/gm,
    (_, pre, _indent, kw) => {
      const colors: Record<string, string> = { route: '#388bfd', agent_run: '#3fb950', approve: '#f0883e' }
      return `<span style="color:#8b949e">${pre}</span><span style="color:${colors[kw] ?? '#1f2328'}">${kw}</span>`
    })
  s = s.replace(/(^\s*(?:name|steps|label|agent|description)\s*:)/gm,
    (m) => `<span style="color:#d29922">${m}</span>`)
  // Comments
  s = s.replace(/(#.*)$/gm,
    (m) => `<span style="color:#484f58;font-style:italic">${m}</span>`)

  return s
}

// ---------------------------------------------------------------------------
// Main editor
// ---------------------------------------------------------------------------

const DEFAULT_YAML = `name: My Workflow
steps:
  - type: route
    label: Route to agent
  - type: agent_run
    agent: ""
    label: Run agent
  - type: approve
    label: Human approval
`

export default function WorkflowEditor() {
  const { id: projectId, workflowId } = useParams<{ id: string; workflowId?: string }>()
  const isNew = !workflowId || workflowId === 'new'
  const navigate = useNavigate()

  const { data: existingWorkflow, isLoading } = useWorkflow(projectId ?? '', workflowId ?? '', )
  const createWorkflow = useCreateWorkflow(projectId ?? '')
  const updateWorkflow = useUpdateWorkflow(projectId ?? '')

  const [yaml, setYaml] = useState(DEFAULT_YAML)
  const [workflowName, setWorkflowName] = useState('My Workflow')
  const [steps, setSteps] = useState<WorkflowStep[]>([])
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveOk, setSaveOk] = useState(false)
  const [showTemplatePicker, setShowTemplatePicker] = useState(false)

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const highlightRef = useRef<HTMLPreElement>(null)
  const parseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Populate editor from existing workflow
  useEffect(() => {
    if (!isNew && existingWorkflow) {
      setYaml(existingWorkflow.yamlContent)
      setWorkflowName(existingWorkflow.name)
      setSteps(parseSteps(existingWorkflow.yamlContent))
    }
  }, [isNew, existingWorkflow])

  // Debounced step parse + highlight sync
  const handleYamlChange = useCallback((value: string) => {
    setYaml(value)
    setSaveOk(false)
    if (parseTimer.current) clearTimeout(parseTimer.current)
    parseTimer.current = setTimeout(() => {
      setSteps(parseSteps(value))
      const name = parseWorkflowName(value)
      if (name) setWorkflowName(name)
      if (highlightRef.current) {
        highlightRef.current.innerHTML = highlightYaml(value) + '\n'
      }
    }, 200)
  }, [])

  // Sync highlight overlay on mount
  useEffect(() => {
    if (highlightRef.current) {
      highlightRef.current.innerHTML = highlightYaml(yaml) + '\n'
    }
    setSteps(parseSteps(yaml))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Sync scroll between textarea and highlight overlay
  function handleScroll() {
    if (highlightRef.current && textareaRef.current) {
      highlightRef.current.scrollTop = textareaRef.current.scrollTop
      highlightRef.current.scrollLeft = textareaRef.current.scrollLeft
    }
  }

  async function handleSave() {
    setSaving(true)
    setSaveError(null)
    setSaveOk(false)
    try {
      if (isNew) {
        const wf = await createWorkflow.mutateAsync({ name: workflowName, yamlContent: yaml })
        navigate(`/projects/${projectId}/workflows/${wf.id}`, { replace: true })
      } else {
        await updateWorkflow.mutateAsync({ workflowId: workflowId!, name: workflowName, yamlContent: yaml })
      }
      setSaveOk(true)
      setTimeout(() => setSaveOk(false), 2000)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  function handleTemplateLoad(yamlContent: string, name: string) {
    setYaml(yamlContent)
    setWorkflowName(name)
    setSteps(parseSteps(yamlContent))
    if (highlightRef.current) {
      highlightRef.current.innerHTML = highlightYaml(yamlContent) + '\n'
    }
  }

  if (!isNew && isLoading) {
    return <div style={{ padding: '32px', color: 'var(--text-muted)' }}>Loading workflow…</div>
  }

  const monoFont = "'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'Menlo', monospace"

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          padding: '12px 20px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
          background: 'var(--bg)',
        }}
      >
        <button
          onClick={() => navigate(`/projects/${projectId}/workflows`)}
          style={{
            background: 'none',
            border: 'none',
            color: '#8b949e',
            fontSize: '18px',
            cursor: 'pointer',
            lineHeight: 1,
            padding: '0 4px',
          }}
          title="Back to workflows"
        >
          ←
        </button>

        <input
          value={workflowName}
          onChange={(e) => setWorkflowName(e.target.value)}
          placeholder="Workflow name"
          style={{
            background: 'none',
            border: 'none',
            borderBottom: '1px solid transparent',
            color: 'var(--text)',
            fontSize: '15px',
            fontWeight: 600,
            outline: 'none',
            minWidth: '180px',
            maxWidth: '300px',
            padding: '2px 4px',
          }}
          onFocus={(e) => (e.currentTarget.style.borderBottomColor = '#388bfd')}
          onBlur={(e) => (e.currentTarget.style.borderBottomColor = 'transparent')}
        />

        <span style={{ color: 'var(--border)', fontSize: '16px' }}>|</span>

        {/* Template picker */}
        <button
          onClick={() => setShowTemplatePicker(true)}
          style={{
            background: 'none',
            border: '1px solid var(--border)',
            borderRadius: '5px',
            color: '#8b949e',
            fontSize: '12px',
            padding: '4px 10px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
          }}
        >
          <ClipboardPaste20Regular /> Use template
        </button>

        <div style={{ flex: 1 }} />

        {/* Save feedback */}
        {saveOk && (
          <span style={{ fontSize: '12px', color: '#3fb950', display: 'flex', alignItems: 'center', gap: '4px' }}><Checkmark20Regular /> Saved</span>
        )}
        {saveError && (
          <span style={{ fontSize: '12px', color: '#f85149', display: 'flex', alignItems: 'center', gap: '4px' }} title={saveError}><Warning20Regular /> {saveError.slice(0, 40)}</span>
        )}

        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            background: saving ? 'rgba(0,0,0,0.05)' : '#388bfd',
            color: '#fff',
            border: 'none',
            borderRadius: '5px',
            padding: '6px 16px',
            fontSize: '13px',
            fontWeight: 500,
            cursor: saving ? 'default' : 'pointer',
            opacity: saving ? 0.7 : 1,
          }}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>

        <span
          style={{
          }}
        />
      </div>

      {/* Split pane body */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>

        {/* Left: YAML editor */}
        <div
          style={{
            width: '50%',
            borderRight: '1px solid var(--border)',
            display: 'flex',
            flexDirection: 'column',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              padding: '8px 12px',
              borderBottom: '1px solid var(--border)',
              fontSize: '11px',
              color: 'var(--text-muted)',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              background: 'var(--bg)',
              flexShrink: 0,
            }}
          >
            YAML
          </div>

          {/* Highlight overlay + transparent textarea stacked */}
          <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
            {/* Syntax-highlighted pre (non-interactive) */}
            <pre
              ref={highlightRef}
              aria-hidden
              style={{
                position: 'absolute',
                inset: 0,
                margin: 0,
                padding: '12px 12px 12px 48px',
                fontFamily: monoFont,
                fontSize: '13px',
                lineHeight: '1.6',
                color: 'var(--text)',
                background: 'var(--surface)',
                overflow: 'hidden',
                whiteSpace: 'pre',
                pointerEvents: 'none',
                counterReset: 'line',
              }}
            />

            {/* Line numbers */}
            <div
              aria-hidden
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                bottom: 0,
                width: '40px',
                background: 'var(--bg)',
                borderRight: '1px solid var(--border)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-end',
                padding: '12px 6px',
                overflow: 'hidden',
                pointerEvents: 'none',
                zIndex: 1,
              }}
            >
              {yaml.split('\n').map((_, i) => (
                <span
                  key={i}
                  style={{
                    fontSize: '11px',
                    lineHeight: '1.6',
                    color: 'var(--text-muted)',
                    fontFamily: monoFont,
                    userSelect: 'none',
                    height: '20.8px',
                    display: 'block',
                  }}
                >
                  {i + 1}
                </span>
              ))}
            </div>

            {/* Actual textarea — transparent so highlight shows through */}
            <textarea
              ref={textareaRef}
              value={yaml}
              onChange={(e) => handleYamlChange(e.target.value)}
              onScroll={handleScroll}
              spellCheck={false}
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                margin: 0,
                padding: '12px 12px 12px 48px',
                fontFamily: monoFont,
                fontSize: '13px',
                lineHeight: '1.6',
                color: 'transparent',
                caretColor: 'var(--text)',
                background: 'transparent',
                border: 'none',
                outline: 'none',
                resize: 'none',
                whiteSpace: 'pre',
                overflowWrap: 'normal',
                overflow: 'auto',
                zIndex: 2,
                tabSize: 2,
              }}
            />
          </div>
        </div>

        {/* Right: Step flow preview */}
        <div
          style={{
            width: '50%',
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--bg)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              padding: '8px 12px',
              borderBottom: '1px solid var(--border)',
              fontSize: '11px',
              color: 'var(--text-muted)',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              background: 'var(--bg)',
              flexShrink: 0,
            }}
          >
            Step preview
          </div>
          <div style={{ flex: 1, overflow: 'auto', padding: '24px 0' }}>
            <WorkflowStepFlow steps={steps} />
          </div>
        </div>
      </div>

      {/* Template picker modal */}
      {showTemplatePicker && (
        <TemplatePicker
          onSelect={handleTemplateLoad}
          onClose={() => setShowTemplatePicker(false)}
        />
      )}
    </div>
  )
}
