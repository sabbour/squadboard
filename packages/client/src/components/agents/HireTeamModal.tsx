import { useState } from 'react'
import {
  useHireTeamPropose,
  useHireTeamConfirm,
  type CastedMember,
  type CastingUniverseId,
  type CastingAgentRole,
} from '../../api/agents.ts'
import { useCastingUniverses } from '../../api/roles.ts'
import {
  Dialog,
  DialogSurface,
  DialogTitle,
  DialogBody,
  DialogContent,
  DialogActions,
  Button,
  Field,
  Spinner,
  Badge,
  Slider,
  Checkbox,
  tokens,
} from '@fluentui/react-components'
import {
  People24Regular,
  Checkmark20Regular,
  Dismiss20Regular,
  PersonCircle24Regular,
} from '@fluentui/react-icons'

interface HireTeamModalProps {
  projectId: string
  onClose: () => void
}

type Step = 'configure' | 'review' | 'done'

const ROLE_OPTIONS: { id: CastingAgentRole; label: string }[] = [
  { id: 'lead', label: 'Lead' },
  { id: 'developer', label: 'Developer' },
  { id: 'tester', label: 'Tester' },
  { id: 'reviewer', label: 'Reviewer' },
  { id: 'devops', label: 'DevOps' },
  { id: 'security', label: 'Security' },
  { id: 'designer', label: 'Designer' },
  { id: 'prompt-engineer', label: 'Prompt Engineer' },
  { id: 'scribe', label: 'Scribe' },
]

const ROLE_BADGE_COLOR: Record<
  CastingAgentRole,
  'brand' | 'success' | 'warning' | 'danger' | 'severe' | 'subtle'
> = {
  lead: 'brand',
  developer: 'success',
  tester: 'warning',
  reviewer: 'severe',
  devops: 'danger',
  security: 'danger',
  designer: 'brand',
  'prompt-engineer': 'brand',
  scribe: 'subtle',
}

export default function HireTeamModal({ projectId, onClose }: HireTeamModalProps) {
  const [step, setStep] = useState<Step>('configure')
  const [universe, setUniverse] = useState<CastingUniverseId>('usual-suspects')
  const [teamSize, setTeamSize] = useState<number>(5)
  const [requiredRoles, setRequiredRoles] = useState<Set<CastingAgentRole>>(new Set(['lead']))
  const [proposed, setProposed] = useState<CastedMember[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [results, setResults] = useState<{ created: number; errors: string[] } | null>(null)

  const { data: universes, isLoading: universesLoading } = useCastingUniverses()
  const propose = useHireTeamPropose(projectId)
  const confirm = useHireTeamConfirm(projectId)

  function toggleRole(role: CastingAgentRole) {
    setRequiredRoles((prev) => {
      const next = new Set(prev)
      if (next.has(role)) next.delete(role)
      else next.add(role)
      return next
    })
  }

  function toggleMember(agentName: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(agentName)) next.delete(agentName)
      else next.add(agentName)
      return next
    })
  }

  async function handlePropose() {
    const result = await propose.mutateAsync({
      universe,
      teamSize,
      requiredRoles: requiredRoles.size > 0 ? Array.from(requiredRoles) : undefined,
    })
    setProposed(result.members)
    setSelected(new Set(result.members.map((m) => m.agentName)))
    setStep('review')
  }

  async function handleConfirm() {
    const toHire = proposed.filter((m) => selected.has(m.agentName))
    const result = await confirm.mutateAsync({ members: toHire })
    setResults({
      created: result.created.length,
      errors: result.errors.map((e) => `${e.agentName}: ${e.error}`),
    })
    setStep('done')
  }

  return (
    <Dialog open onOpenChange={(_, data) => { if (!data.open) onClose() }}>
      <DialogSurface style={{ maxWidth: '640px', width: '100%' }}>
        <DialogBody>
          <DialogTitle>Cast a team</DialogTitle>
          <DialogContent>
            {step === 'configure' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', paddingTop: '8px' }}>
                <p style={{ margin: 0, fontSize: '13px', color: tokens.colorNeutralForeground2 }}>
                  Pick a universe of characters and Squadboard's casting engine will assemble a themed team
                  with personalities, backstories, and matching base roles.
                </p>

                <Field label="Universe">
                  {universesLoading && <Spinner size="tiny" label="Loading universes…" />}
                  {!universesLoading && universes && (
                    <div style={{ display: 'grid', gap: '8px', gridTemplateColumns: '1fr 1fr' }}>
                      {universes.map((u) => {
                        const isSelected = universe === u.id
                        return (
                          <button
                            key={u.id}
                            onClick={() => setUniverse(u.id)}
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '4px',
                              padding: '12px 14px',
                              border: `2px solid ${isSelected ? tokens.colorBrandStroke1 : tokens.colorNeutralStroke2}`,
                              borderRadius: '8px',
                              background: isSelected ? tokens.colorBrandBackground2 : tokens.colorNeutralBackground1,
                              cursor: 'pointer',
                              textAlign: 'left',
                              transition: 'border-color 0.15s, background 0.15s',
                            }}
                          >
                            <span style={{ fontWeight: 600, fontSize: '13px' }}>{u.label}</span>
                            <span style={{ fontSize: '11px', color: tokens.colorNeutralForeground3 }}>
                              {u.characterCount} characters available
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </Field>

                <Field label={`Team size: ${teamSize}`}>
                  <Slider
                    min={3}
                    max={9}
                    step={1}
                    value={teamSize}
                    onChange={(_, data) => setTeamSize(data.value)}
                  />
                </Field>

                <Field label="Required roles (optional)" hint="Casting will guarantee these roles are present.">
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 12px' }}>
                    {ROLE_OPTIONS.map((r) => (
                      <Checkbox
                        key={r.id}
                        label={r.label}
                        checked={requiredRoles.has(r.id)}
                        onChange={() => toggleRole(r.id)}
                      />
                    ))}
                  </div>
                </Field>

                {propose.isError && (
                  <p style={{ fontSize: '12px', color: tokens.colorPaletteRedForeground1, margin: 0 }}>
                    {propose.error?.message ?? 'Failed to cast team. Please try again.'}
                  </p>
                )}
              </div>
            )}

            {step === 'review' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', paddingTop: '8px' }}>
                <p style={{ margin: 0, fontSize: '13px', color: tokens.colorNeutralForeground2 }}>
                  Cast complete. Deselect anyone you don't want to hire.
                </p>
                {proposed.map((member) => {
                  const isSelected = selected.has(member.agentName)
                  return (
                    <button
                      key={member.agentName}
                      onClick={() => toggleMember(member.agentName)}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '12px',
                        padding: '12px 14px',
                        border: `2px solid ${isSelected ? tokens.colorBrandStroke1 : tokens.colorNeutralStroke2}`,
                        borderRadius: '8px',
                        background: isSelected ? tokens.colorBrandBackground2 : tokens.colorNeutralBackground1,
                        cursor: 'pointer',
                        textAlign: 'left',
                        width: '100%',
                        transition: 'border-color 0.15s, background 0.15s',
                      }}
                    >
                      <div style={{
                        width: '36px', height: '36px', borderRadius: '50%',
                        background: isSelected ? tokens.colorBrandBackground : tokens.colorNeutralBackground3,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        flexShrink: 0,
                        color: isSelected ? tokens.colorNeutralForegroundOnBrand : tokens.colorNeutralForeground2,
                      }}>
                        {isSelected ? <Checkmark20Regular /> : <PersonCircle24Regular />}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 600, fontSize: '14px' }}>{member.name}</span>
                          <Badge appearance="tint" color={ROLE_BADGE_COLOR[member.role]} size="small">
                            {member.suggestedRoleTitle}
                          </Badge>
                          <span style={{
                            fontSize: '11px',
                            color: tokens.colorNeutralForeground3,
                            marginLeft: 'auto',
                            fontFamily: 'monospace',
                          }}>
                            {member.agentName}
                          </span>
                        </div>
                        <p style={{
                          margin: '0 0 4px',
                          fontSize: '12px',
                          color: tokens.colorNeutralForeground2,
                          fontStyle: 'italic',
                        }}>
                          {member.personality}
                        </p>
                        <p style={{ margin: 0, fontSize: '12px', color: tokens.colorNeutralForeground3 }}>
                          {member.backstory}
                        </p>
                      </div>
                    </button>
                  )
                })}
                {confirm.isError && (
                  <p style={{ fontSize: '12px', color: tokens.colorPaletteRedForeground1, margin: 0 }}>
                    {confirm.error?.message ?? 'Failed to hire team. Please try again.'}
                  </p>
                )}
              </div>
            )}

            {step === 'done' && results && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', paddingTop: '8px' }}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '10px', padding: '14px',
                  borderRadius: '8px', background: tokens.colorStatusSuccessBackground1,
                  border: `1px solid ${tokens.colorStatusSuccessBorder1}`,
                }}>
                  <Checkmark20Regular style={{ color: tokens.colorStatusSuccessForeground1, flexShrink: 0 }} />
                  <span style={{ fontSize: '14px', color: tokens.colorStatusSuccessForeground1 }}>
                    {results.created} agent{results.created !== 1 ? 's' : ''} hired successfully!
                  </span>
                </div>
                {results.errors.length > 0 && (
                  <div style={{
                    padding: '10px 14px',
                    borderRadius: '8px',
                    background: tokens.colorStatusWarningBackground1,
                    border: `1px solid ${tokens.colorStatusWarningBorder1}`,
                  }}>
                    <p style={{ margin: '0 0 6px', fontSize: '12px', fontWeight: 600, color: tokens.colorStatusWarningForeground1 }}>
                      Some agents could not be created:
                    </p>
                    {results.errors.map((e) => (
                      <div key={e} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: tokens.colorStatusWarningForeground1 }}>
                        <Dismiss20Regular style={{ flexShrink: 0 }} /> {e}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </DialogContent>

          <DialogActions>
            {step === 'configure' && (
              <>
                <Button appearance="secondary" onClick={onClose}>Cancel</Button>
                <Button
                  appearance="primary"
                  onClick={handlePropose}
                  disabled={propose.isPending || universesLoading}
                  icon={propose.isPending ? <Spinner size="tiny" /> : <People24Regular />}
                >
                  {propose.isPending ? 'Casting…' : 'Cast Team'}
                </Button>
              </>
            )}
            {step === 'review' && (
              <>
                <Button appearance="secondary" onClick={() => setStep('configure')}>Back</Button>
                <Button
                  appearance="primary"
                  onClick={handleConfirm}
                  disabled={selected.size === 0 || confirm.isPending}
                  icon={confirm.isPending ? <Spinner size="tiny" /> : undefined}
                >
                  {confirm.isPending ? 'Hiring…' : `Hire ${selected.size} Agent${selected.size !== 1 ? 's' : ''}`}
                </Button>
              </>
            )}
            {step === 'done' && (
              <Button appearance="primary" onClick={onClose}>Done</Button>
            )}
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  )
}
