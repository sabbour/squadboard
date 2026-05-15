import { useState } from 'react'
import {
  useHireTeamPropose,
  useHireTeamConfirm,
  useFormulateTeam,
  type CastedMember,
  type CastingUniverseId,
  type CastingAgentRole,
  type FormulateModelInfo,
} from '../../api/agents.ts'
import { useCastingUniverses } from '../../api/roles.ts'
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

/**
 * The 9 SDK base roles + 7 Squadboard-extended non-tech roles (Wave 10 D1).
 *
 * Extended roles are mapped server-side to a base SDK role via
 * `EXTENDED_ROLE_TO_BASE_ROLE` in `casting-engine.ts` so the SDK pipeline
 * still produces a complete team. Emoji are sourced from
 * `.github/agents/squad.agent.md` (Standard role emoji mapping table).
 */
const ROLE_OPTIONS: { id: CastingAgentRole; label: string; group: 'tech' | 'non-tech' }[] = [
  { id: 'lead', label: '🏗️ Lead', group: 'tech' },
  { id: 'developer', label: '🔧 Developer', group: 'tech' },
  { id: 'tester', label: '🧪 Tester', group: 'tech' },
  { id: 'reviewer', label: '👁️ Reviewer', group: 'tech' },
  { id: 'devops', label: '⚙️ DevOps', group: 'tech' },
  { id: 'security', label: '🔒 Security', group: 'tech' },
  { id: 'designer', label: '⚛️ Designer (Frontend)', group: 'tech' },
  { id: 'prompt-engineer', label: '🎭 Prompt Engineer', group: 'tech' },
  { id: 'scribe', label: '📋 Scribe', group: 'tech' },
  { id: 'pm', label: '🎯 PM', group: 'non-tech' },
  { id: 'designer-nontech', label: '🎨 Designer (Brand/UX)', group: 'non-tech' },
  { id: 'founder', label: '👔 Founder', group: 'non-tech' },
  { id: 'sales', label: '💼 Sales', group: 'non-tech' },
  { id: 'marketing', label: '📣 Marketing', group: 'non-tech' },
  { id: 'customer-success', label: '🎧 Customer Success', group: 'non-tech' },
  { id: 'research', label: '🔬 Research', group: 'non-tech' },
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
  pm: 'brand',
  'designer-nontech': 'brand',
  founder: 'brand',
  sales: 'success',
  marketing: 'warning',
  'customer-success': 'severe',
  research: 'subtle',
}

export default function HireTeamModal({ projectId, onClose }: HireTeamModalProps) {
  const [step, setStep] = useState<Step>('configure')
  const [universe, setUniverse] = useState<CastingUniverseId>('usual-suspects')
  const [teamSize, setTeamSize] = useState<number>(5)
  const [requiredRoles, setRequiredRoles] = useState<Set<CastingAgentRole>>(new Set(['lead']))
  const [proposed, setProposed] = useState<CastedMember[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [results, setResults] = useState<{ created: number; errors: string[] } | null>(null)
  const [formulateModel, setFormulateModel] = useState<FormulateModelInfo | null>(null)
  const [formulateRationale, setFormulateRationale] = useState<string | null>(null)

  const { data: universes, isLoading: universesLoading } = useCastingUniverses()
  const propose = useHireTeamPropose(projectId)
  const confirm = useHireTeamConfirm(projectId)
  const formulate = useFormulateTeam(projectId)

  function handleFormulate(draft: string) {
    formulate.mutate(draft, {
      onSuccess: ({ team, modelUsed }) => {
        if (universes?.some((u) => u.id === team.universe)) {
          setUniverse(team.universe as CastingUniverseId)
        }
        setTeamSize(team.teamSize)
        setRequiredRoles(new Set(team.requiredRoles as CastingAgentRole[]))
        setFormulateModel(modelUsed)
        setFormulateRationale(team.rationale ?? null)
      },
    })
  }

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
                <FormulatePanel
                  placeholder="e.g. a small team of 3 to ship a SaaS MVP fast — pick a famous heist crew"
                  hint="Sketch the team in plain language; AI picks a universe, team size, and required roles."
                  isPending={formulate.isPending}
                  errorMessage={formulate.error?.message ?? null}
                  modelUsed={formulateModel}
                  onFormulate={handleFormulate}
                  compact
                />
                {formulateRationale && (
                  <div
                    style={{
                      fontSize: '12px',
                      color: tokens.colorNeutralForeground2,
                      background: tokens.colorNeutralBackground2,
                      borderLeft: `3px solid ${tokens.colorBrandBackground}`,
                      padding: '8px 12px',
                      borderRadius: '4px',
                    }}
                  >
                    <strong>Why this team:</strong> {formulateRationale}
                  </div>
                )}
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
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div>
                      <div style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: tokens.colorNeutralForeground3, marginBottom: '6px' }}>
                        Tech (SDK)
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 12px' }}>
                        {ROLE_OPTIONS.filter((r) => r.group === 'tech').map((r) => (
                          <Checkbox
                            key={r.id}
                            label={r.label}
                            checked={requiredRoles.has(r.id)}
                            onChange={() => toggleRole(r.id)}
                          />
                        ))}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: tokens.colorNeutralForeground3, marginBottom: '6px' }}>
                        Non-tech
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 12px' }}>
                        {ROLE_OPTIONS.filter((r) => r.group === 'non-tech').map((r) => (
                          <Checkbox
                            key={r.id}
                            label={r.label}
                            checked={requiredRoles.has(r.id)}
                            onChange={() => toggleRole(r.id)}
                          />
                        ))}
                      </div>
                    </div>
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
                          <Badge appearance="tint" color={ROLE_BADGE_COLOR[member.extendedRole ?? member.role]} size="small">
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
