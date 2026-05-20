import { useState } from 'react'
import { useCeremonies, useCeremonyTemplates, useAttachCeremony, useCreateCeremony } from '../../api/ceremonies.ts'
import {
  Dialog,
  DialogSurface,
  DialogTitle,
  DialogBody,
  DialogContent,
  DialogActions,
  Button,
  Caption1,
  makeStyles,
  tokens,
} from '@fluentui/react-components'

interface AttachWorkflowModalProps {
  projectId: string
  issueId: string
  onClose: () => void
}

const useStyles = makeStyles({
  sectionLabel: {
    fontSize: '11px',
    color: tokens.colorNeutralForeground3,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    marginBottom: tokens.spacingVerticalXS,
    display: 'block',
  },
  introText: {
    color: tokens.colorNeutralForeground2,
    fontSize: '13px',
    lineHeight: '1.45',
    margin: 0,
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalS,
  },
  sectionHelp: {
    color: tokens.colorNeutralForeground3,
    display: 'block',
    marginTop: '2px',
  },
  attachRow: {
    display: 'flex',
    gap: tokens.spacingHorizontalS,
    alignItems: 'center',
  },
  templateCard: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    background: tokens.colorNeutralBackground2,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    gap: tokens.spacingHorizontalM,
  },
  templateInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
})

/**
 * Modal that lets the user choose a run plan for an issue.
 */
export function AttachWorkflowModal({ projectId, issueId, onClose }: AttachWorkflowModalProps) {
  const { data: ceremonies } = useCeremonies(projectId)
  const { data: templates } = useCeremonyTemplates()
  const attachCeremony = useAttachCeremony(projectId, issueId)
  const createCeremony = useCreateCeremony(projectId)
  const styles = useStyles()

  const [selectedVersionId, setSelectedVersionId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleAttach() {
    if (!selectedVersionId) return
    setBusy(true)
    setError(null)
    try {
      await attachCeremony.mutateAsync({ workflowVersionId: selectedVersionId })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to choose run plan')
    } finally {
      setBusy(false)
    }
  }

  function templateActionLabel(name: string) {
    const trimmed = name.trim()
    if (!trimmed) return 'Create plan for this card'
    return `Create from ${trimmed}`
  }

  async function handleUseTemplate(slug: string) {
    const tpl = templates?.find((t) => t.slug === slug)
    if (!tpl) return
    if (!tpl.yamlContent) {
      setError('This template does not include a run-plan definition yet.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const created = await createCeremony.mutateAsync({
        yamlContent: tpl.yamlContent,
        triggerKind: 'manual',
        triggerConfig: {},
        kind: 'workflow',
      })
      await attachCeremony.mutateAsync({ workflowVersionId: created.version.id })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create run plan from template')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(_, data) => { if (!data.open) onClose() }}>
      <DialogSurface style={{ maxWidth: '440px', width: '100%' }}>
        <DialogBody>
          <DialogTitle>Override default Work Pickup</DialogTitle>
          <DialogContent>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', paddingTop: '8px' }}>
              <p className={styles.introText}>
                This card already uses Work Pickup when it enters Ready. Only choose another run plan if this card needs a different path.
              </p>

              {/* Existing project ceremonies/run plans */}
              {ceremonies && ceremonies.length > 0 && (
                <div className={styles.section}>
                  <div>
                    <span className={styles.sectionLabel}>Use an existing project plan</span>
                    <Caption1 className={styles.sectionHelp}>
                      Attach a saved project plan to this card instead of the default Work Pickup plan.
                    </Caption1>
                  </div>
                  <div className={styles.attachRow}>
                    <select
                      value={selectedVersionId}
                      onChange={(e) => setSelectedVersionId(e.target.value)}
                      style={{
                        flex: 1,
                        background: tokens.colorNeutralBackground1,
                        border: `1px solid ${tokens.colorNeutralStroke1}`,
                        borderRadius: tokens.borderRadiusMedium,
                        color: tokens.colorNeutralForeground1,
                        fontSize: '13px',
                        padding: '6px 10px',
                      }}
                    >
                      <option value="">Select a project plan override</option>
                      {ceremonies
                        .filter((ceremony) => Boolean(ceremony.activeVersionId))
                        .map((ceremony) => (
                          <option key={ceremony.id} value={ceremony.activeVersionId ?? ''}>
                            {ceremony.name}
                          </option>
                        ))}
                    </select>
                    <Button
                      appearance="primary"
                      onClick={() => { void handleAttach() }}
                      disabled={!selectedVersionId || busy}
                    >
                      Use selected plan
                    </Button>
                  </div>
                </div>
              )}

              {/* Bundled templates */}
              {templates && templates.length > 0 && (
                <div className={styles.section}>
                  <div>
                    <span className={styles.sectionLabel}>Create a new plan for this card</span>
                    <Caption1 className={styles.sectionHelp}>
                      Start from a template; Squadboard saves the new plan to this project and attaches it to this card.
                    </Caption1>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {templates.map((tpl) => (
                      <div key={tpl.slug} className={styles.templateCard}>
                        <div className={styles.templateInfo}>
                          <span style={{ fontSize: '13px', fontWeight: 500 }}>{tpl.name}</span>
                          {tpl.description && (
                            <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>{tpl.description}</Caption1>
                          )}
                        </div>
                        <Button
                          appearance="primary"
                          size="small"
                          onClick={() => { void handleUseTemplate(tpl.slug) }}
                          disabled={busy}
                        >
                          {templateActionLabel(tpl.name)}
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {error && (
                <p style={{ fontSize: '12px', color: tokens.colorPaletteRedForeground1, margin: 0 }}>{error}</p>
              )}
            </div>
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={onClose}>Cancel</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  )
}
