import { useState } from 'react'
import { useWorkflows, useWorkflowTemplates, useAttachWorkflow, useCreateWorkflow } from '../../api/workflows.ts'
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
 * Modal that lets the user attach a workflow to an issue.
 */
export function AttachWorkflowModal({ projectId, issueId, onClose }: AttachWorkflowModalProps) {
  const { data: workflows } = useWorkflows(projectId)
  const { data: templates } = useWorkflowTemplates()
  const attachWorkflow = useAttachWorkflow(projectId, issueId)
  const createWorkflow = useCreateWorkflow(projectId)
  const styles = useStyles()

  const [selectedWorkflowId, setSelectedWorkflowId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleAttach() {
    if (!selectedWorkflowId) return
    setBusy(true)
    setError(null)
    try {
      await attachWorkflow.mutateAsync({ workflowId: selectedWorkflowId })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to attach workflow')
    } finally {
      setBusy(false)
    }
  }

  async function handleUseTemplate(slug: string) {
    const tpl = templates?.find((t) => t.slug === slug)
    if (!tpl) return
    setBusy(true)
    setError(null)
    try {
      const created = await createWorkflow.mutateAsync({
        yamlContent: `template:${tpl.slug}`,
      })
      await attachWorkflow.mutateAsync({ workflowId: created.ceremony.id })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create workflow from template')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(_, data) => { if (!data.open) onClose() }}>
      <DialogSurface style={{ maxWidth: '440px', width: '100%' }}>
        <DialogBody>
          <DialogTitle>Attach Workflow</DialogTitle>
          <DialogContent>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', paddingTop: '8px' }}>
              {/* Existing project workflows */}
              {workflows && workflows.length > 0 && (
                <div>
                  <span className={styles.sectionLabel}>Project Workflows</span>
                  <div className={styles.attachRow}>
                    <select
                      value={selectedWorkflowId}
                      onChange={(e) => setSelectedWorkflowId(e.target.value)}
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
                      <option value="">— select a workflow —</option>
                      {workflows.map((w) => (
                        <option key={w.id} value={w.id}>{w.name}</option>
                      ))}
                    </select>
                    <Button
                      appearance="primary"
                      onClick={() => { void handleAttach() }}
                      disabled={!selectedWorkflowId || busy}
                    >
                      Attach
                    </Button>
                  </div>
                </div>
              )}

              {/* Bundled templates */}
              {templates && templates.length > 0 && (
                <div>
                  <span className={styles.sectionLabel}>Use a Template</span>
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
                          Use
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
