import { useState } from 'react'
import { useCreateAgent } from '../../api/agents.ts'
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
  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [model, setModel] = useState('auto')
  const [expertiseInput, setExpertiseInput] = useState('')
  const [nameError, setNameError] = useState('')
  const styles = useStyles()

  const createAgent = useCreateAgent(projectId)

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

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validateName(name)) return
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
      { onSuccess: onClose }
    )
  }

  const canSubmit = Boolean(name) && Boolean(role.trim()) && !nameError && !createAgent.isPending

  return (
    <Dialog open onOpenChange={(_, data) => { if (!data.open) onClose() }}>
      <DialogSurface style={{ maxWidth: '480px', width: '100%' }}>
        <DialogBody>
          <DialogTitle>Hire Agent</DialogTitle>
          <DialogContent>
            <form
              id="hire-agent-form"
              onSubmit={handleSubmit}
              style={{ display: 'flex', flexDirection: 'column', gap: '16px', paddingTop: '8px' }}
            >
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

              {createAgent.isError && (
                <p style={{ fontSize: '12px', color: tokens.colorPaletteRedForeground1, margin: 0 }}>
                  Failed to hire agent. Please try again.
                </p>
              )}
            </form>
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={onClose}>Cancel</Button>
            <Button
              appearance="primary"
              type="submit"
              form="hire-agent-form"
              disabled={!canSubmit}
            >
              {createAgent.isPending ? 'Hiring…' : 'Hire Agent'}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  )
}
