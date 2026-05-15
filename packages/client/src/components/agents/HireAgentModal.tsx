import { useState } from 'react'
import { useCreateAgent, useFormulateAgent, type FormulateModelInfo } from '../../api/agents.ts'
import { useSkills, useAssignSkillsToAgent, type Skill } from '../../api/skills.ts'
import { useTools, useAssignToolsToAgent, type Tool } from '../../api/tools.ts'
import { useMcpServers, useAssignMcpServersToAgent, type McpServer } from '../../api/mcp.ts'
import FormulatePanel from '../formulate/FormulatePanel.tsx'
import {
  Dialog,
  DialogSurface,
  DialogTitle,
  DialogBody,
  DialogContent,
  DialogActions,
  Button,
  Field,
  Input,
  Select,
  Caption1,
  makeStyles,
  tokens,
} from '@fluentui/react-components'

interface HireAgentModalProps {
  projectId: string
  onClose: () => void
}

const MODELS = [
  { value: 'auto', label: 'auto (let agent decide)' },
  { value: 'claude-sonnet-4.6', label: 'claude-sonnet-4.6' },
  { value: 'claude-haiku-4.5', label: 'claude-haiku-4.5' },
  { value: 'claude-opus-4.6', label: 'claude-opus-4.6' },
]

const KEBAB_RE = /^[a-z][a-z0-9-]*$/

const useStyles = makeStyles({
  tagList: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '4px',
    marginTop: tokens.spacingVerticalXS,
  },
  tag: {
    fontSize: '11px',
    padding: '2px 8px',
    borderRadius: '12px',
    background: tokens.colorBrandBackground2,
    color: tokens.colorBrandForeground1,
    border: `1px solid ${tokens.colorBrandStroke2}`,
  },
})

export default function HireAgentModal({ projectId, onClose }: HireAgentModalProps) {
  const [step, setStep] = useState<'role' | 'capabilities'>('role')
  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [model, setModel] = useState('auto')
  const [expertiseInput, setExpertiseInput] = useState('')
  const [nameError, setNameError] = useState('')
  const [pickedSkills, setPickedSkills] = useState<Set<string>>(new Set())
  const [pickedTools, setPickedTools] = useState<Set<string>>(new Set())
  const [pickedMcp, setPickedMcp] = useState<Set<string>>(new Set())
  const [postHireAgentId, setPostHireAgentId] = useState<string | null>(null)
  const [formulateModel, setFormulateModel] = useState<FormulateModelInfo | null>(null)
  const styles = useStyles()

  const createAgent = useCreateAgent(projectId)
  const formulate = useFormulateAgent(projectId)
  const { data: skills = [] } = useSkills(projectId)
  const { data: tools = [] } = useTools(projectId)
  const { data: mcpServers = [] } = useMcpServers(projectId)
  const assignSkills = useAssignSkillsToAgent(projectId, postHireAgentId ?? '')
  const assignTools = useAssignToolsToAgent(projectId, postHireAgentId ?? '')
  const assignMcp = useAssignMcpServersToAgent(projectId, postHireAgentId ?? '')

  function validateName(val: string): boolean {
    if (!val) {
      setNameError('Name is required')
      return false
    }
    if (!KEBAB_RE.test(val)) {
      setNameError('Must be kebab-case: lowercase letters, digits, hyphens; must start with a letter')
      return false
    }
    setNameError('')
    return true
  }

  function handleNameChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value
    setName(val)
    if (nameError) validateName(val)
  }

  function handleFormulate(draft: string) {
    formulate.mutate(draft, {
      onSuccess: ({ agent: drafted, modelUsed }) => {
        setName(drafted.name)
        setRole(drafted.role)
        setExpertiseInput(drafted.expertise.join(', '))
        if (drafted.model && MODELS.some((m) => m.value === drafted.model)) {
          setModel(drafted.model)
        }
        setNameError('')
        setFormulateModel(modelUsed)
      },
    })
  }

  function gotoCapabilities(e: React.FormEvent) {
    e.preventDefault()
    if (!validateName(name)) return
    if (!role.trim()) return
    setStep('capabilities')
  }

  async function handleSubmit() {
    const expertise = expertiseInput
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    createAgent.mutate(
      {
        name,
        role: role.trim(),
        model: model === 'auto' ? undefined : model,
        expertise: expertise.length > 0 ? expertise : undefined,
      },
      {
        onSuccess: async (created) => {
          setPostHireAgentId(created.id)
          // Fan out the three bulk-assigns in parallel; ignore individual failures
          // so the modal still closes and the agent still gets hired.
          const tasks: Promise<unknown>[] = []
          if (pickedSkills.size > 0) tasks.push(assignSkills.mutateAsync(Array.from(pickedSkills)).catch(() => null))
          if (pickedTools.size > 0) tasks.push(assignTools.mutateAsync(Array.from(pickedTools)).catch(() => null))
          if (pickedMcp.size > 0) tasks.push(assignMcp.mutateAsync(Array.from(pickedMcp)).catch(() => null))
          await Promise.allSettled(tasks)
          onClose()
        },
      },
    )
  }

  function toggle(set: Set<string>, setter: (s: Set<string>) => void) {
    return (id: string) => {
      const next = new Set(set)
      if (next.has(id)) next.delete(id); else next.add(id)
      setter(next)
    }
  }

  const canSubmit = Boolean(name) && Boolean(role.trim()) && !nameError && !createAgent.isPending

  return (
    <Dialog open onOpenChange={(_, data) => { if (!data.open) onClose() }}>
      <DialogSurface style={{ maxWidth: '560px', width: '100%' }}>
        <DialogBody>
          <DialogTitle>Hire Agent — {step === 'role' ? 'Step 1 of 2: Role' : 'Step 2 of 2: Capabilities'}</DialogTitle>
          <DialogContent>
            {step === 'role' ? (
              <form
                id="hire-agent-form"
                onSubmit={gotoCapabilities}
                style={{ display: 'flex', flexDirection: 'column', gap: '16px', paddingTop: '8px' }}
              >
                <FormulatePanel
                  placeholder="e.g. a frontend lead who's opinionated about accessibility, loves React 19, and writes detailed PR feedback"
                  hint="Sketch the agent in plain language; AI fills name, role, expertise, and model for you to review."
                  isPending={formulate.isPending}
                  errorMessage={formulate.error?.message ?? null}
                  modelUsed={formulateModel}
                  onFormulate={handleFormulate}
                  compact
                />

                <Field
                  label={<>Name <span style={{ color: tokens.colorPaletteRedForeground1 }}>*</span> <span style={{ fontWeight: 400, color: tokens.colorNeutralForeground4 }}>(kebab-case)</span></>}
                  validationMessage={nameError || undefined}
                  validationState={nameError ? 'error' : 'none'}
                >
                  <Input
                    autoFocus
                    value={name}
                    onChange={handleNameChange}
                    placeholder="e.g. design-lead"
                    onBlur={() => validateName(name)}
                  />
                </Field>

                <Field label={<>Role <span style={{ color: tokens.colorPaletteRedForeground1 }}>*</span></>}>
                  <Input
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    placeholder="e.g. Frontend Developer"
                  />
                </Field>

                <Field label="Model">
                  <Select value={model} onChange={(e) => setModel(e.target.value)}>
                    {MODELS.map((m) => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </Select>
                </Field>

                <Field label={<>Expertise <span style={{ fontWeight: 400, color: tokens.colorNeutralForeground4 }}>(comma-separated tags)</span></>}>
                  <Input
                    value={expertiseInput}
                    onChange={(e) => setExpertiseInput(e.target.value)}
                    placeholder="e.g. React, TypeScript, CSS"
                  />
                  {expertiseInput && (
                    <div className={styles.tagList}>
                      {expertiseInput.split(',').map((tag) => tag.trim()).filter(Boolean).map((tag) => (
                        <span key={tag} className={styles.tag}>{tag}</span>
                      ))}
                    </div>
                  )}
                </Field>
              </form>
            ) : (
              <CapabilitiesStep
                projectId={projectId}
                skills={skills}
                tools={tools}
                mcpServers={mcpServers}
                pickedSkills={pickedSkills}
                pickedTools={pickedTools}
                pickedMcp={pickedMcp}
                onToggleSkill={toggle(pickedSkills, setPickedSkills)}
                onToggleTool={toggle(pickedTools, setPickedTools)}
                onToggleMcp={toggle(pickedMcp, setPickedMcp)}
              />
            )}

            {createAgent.isError && (
              <p style={{ fontSize: '12px', color: tokens.colorPaletteRedForeground1, margin: 0 }}>
                Failed to hire agent. Please try again.
              </p>
            )}
          </DialogContent>
          <DialogActions>
            {step === 'role' ? (
              <>
                <Button appearance="secondary" onClick={onClose}>Cancel</Button>
                <Button
                  appearance="primary"
                  type="submit"
                  form="hire-agent-form"
                  disabled={!canSubmit}
                >
                  Next: Capabilities
                </Button>
              </>
            ) : (
              <>
                <Button appearance="secondary" onClick={() => setStep('role')}>Back</Button>
                <Button
                  appearance="primary"
                  onClick={handleSubmit}
                  disabled={createAgent.isPending}
                >
                  {createAgent.isPending ? 'Hiring…' : 'Hire Agent'}
                </Button>
              </>
            )}
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Capabilities step — multi-select chips for skills/tools/mcp, grouped by
// category. Empty registries get a friendly "skip" copy + a deep link to
// the relevant page so the user can come back after creating some.
// ---------------------------------------------------------------------------

function CapabilitiesStep({
  projectId,
  skills,
  tools,
  mcpServers,
  pickedSkills,
  pickedTools,
  pickedMcp,
  onToggleSkill,
  onToggleTool,
  onToggleMcp,
}: {
  projectId: string
  skills: Skill[]
  tools: Tool[]
  mcpServers: McpServer[]
  pickedSkills: Set<string>
  pickedTools: Set<string>
  pickedMcp: Set<string>
  onToggleSkill: (id: string) => void
  onToggleTool: (id: string) => void
  onToggleMcp: (id: string) => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', paddingTop: '8px' }}>
      <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>
        Optional — pick capabilities to assign now. You can manage these later from the Capabilities tab on the agent's detail panel.
      </Caption1>

      <ChipGroup
        title="Skills"
        items={skills.map((s) => ({ id: s.id, label: s.name, group: s.category ?? 'other' }))}
        picked={pickedSkills}
        onToggle={onToggleSkill}
        emptyHref={`/projects/${projectId}/skills`}
        emptyLabel="No skills in this project yet."
      />

      <ChipGroup
        title="Tools"
        items={tools.map((t) => ({ id: t.id, label: t.name, group: t.category ?? 'other' }))}
        picked={pickedTools}
        onToggle={onToggleTool}
        emptyHref={`/projects/${projectId}/tools`}
        emptyLabel="No tools in this project yet."
      />

      <ChipGroup
        title="MCP Servers"
        items={mcpServers.map((s) => ({ id: s.id, label: s.name, group: s.transport }))}
        picked={pickedMcp}
        onToggle={onToggleMcp}
        emptyHref={`/projects/${projectId}/mcp-servers`}
        emptyLabel="No MCP servers in this project yet."
      />
    </div>
  )
}

interface ChipItem { id: string; label: string; group: string }

function ChipGroup({
  title, items, picked, onToggle, emptyHref, emptyLabel,
}: {
  title: string
  items: ChipItem[]
  picked: Set<string>
  onToggle: (id: string) => void
  emptyHref: string
  emptyLabel: string
}) {
  const grouped = items.reduce<Map<string, ChipItem[]>>((acc, it) => {
    if (!acc.has(it.group)) acc.set(it.group, [])
    acc.get(it.group)!.push(it)
    return acc
  }, new Map())
  return (
    <div>
      <div style={{ fontSize: '12px', fontWeight: 600, color: tokens.colorNeutralForeground1, marginBottom: '6px' }}>
        {title} <span style={{ color: tokens.colorNeutralForeground3, fontWeight: 400 }}>{picked.size > 0 ? `(${picked.size} selected)` : ''}</span>
      </div>
      {items.length === 0 ? (
        <div style={{
          fontSize: '11px', color: tokens.colorNeutralForeground3,
          border: '1px dashed ' + tokens.colorNeutralStroke2, borderRadius: '6px',
          padding: '10px', textAlign: 'center',
        }}>
          {emptyLabel} <a href={emptyHref}>Manage →</a>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {Array.from(grouped.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([cat, chips]) => (
            <div key={cat}>
              <div style={{ fontSize: '10px', textTransform: 'uppercase', color: tokens.colorNeutralForeground3, marginBottom: '2px' }}>{cat}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                {chips.map((c) => {
                  const on = picked.has(c.id)
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => onToggle(c.id)}
                      style={{
                        fontSize: '12px',
                        padding: '4px 10px',
                        borderRadius: '12px',
                        border: '1px solid ' + (on ? tokens.colorBrandStroke1 : tokens.colorNeutralStroke2),
                        background: on ? tokens.colorBrandBackground2 : 'transparent',
                        color: on ? tokens.colorBrandForeground1 : tokens.colorNeutralForeground1,
                        cursor: 'pointer',
                      }}
                    >
                      {on ? '✓ ' : ''}{c.label}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
