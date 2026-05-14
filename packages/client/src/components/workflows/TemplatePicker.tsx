import { useWorkflowTemplates } from '../../api/workflows.ts'
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

interface TemplatePickerProps {
  onSelect: (yamlContent: string, name: string) => void
  onClose: () => void
}

const useStyles = makeStyles({
  templateCard: {
    background: tokens.colorNeutralBackground2,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalM}`,
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXS,
  },
  templateHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: tokens.spacingHorizontalM,
  },
})

export default function TemplatePicker({ onSelect, onClose }: TemplatePickerProps) {
  const { data: templates, isLoading, isError } = useWorkflowTemplates()
  const styles = useStyles()

  function handleSelect(slug: string, name: string) {
    const yamlStub = buildStubYaml(slug, name)
    onSelect(yamlStub, name)
    onClose()
  }

  return (
    <Dialog open onOpenChange={(_, data) => { if (!data.open) onClose() }}>
      <DialogSurface style={{ maxWidth: '520px', width: '100%' }}>
        <DialogBody>
          <DialogTitle>Use a template</DialogTitle>
          <DialogContent>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', paddingTop: '8px', maxHeight: '400px', overflowY: 'auto' }}>
              {isLoading && (
                <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>Loading templates…</Caption1>
              )}
              {isError && (
                <Caption1 style={{ color: tokens.colorPaletteRedForeground1 }}>Failed to load templates.</Caption1>
              )}
              {!isLoading && !isError && templates && templates.length === 0 && (
                <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>No templates available.</Caption1>
              )}
              {templates?.map((tpl) => (
                <div key={tpl.slug} className={styles.templateCard}>
                  <div className={styles.templateHeader}>
                    <div>
                      <span style={{ fontWeight: 600, fontSize: '13px' }}>{tpl.name}</span>
                      {tpl.description && (
                        <Caption1 style={{ display: 'block', color: tokens.colorNeutralForeground3, marginTop: '4px' }}>
                          {tpl.description}
                        </Caption1>
                      )}
                    </div>
                    <Button
                      appearance="primary"
                      size="small"
                      onClick={() => handleSelect(tpl.slug, tpl.name)}
                    >
                      Use this template
                    </Button>
                  </div>
                </div>
              ))}
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

// Produce a sensible YAML stub when the server doesn't return full yaml in the list response.
function buildStubYaml(slug: string, name: string): string {
  const stubs: Record<string, string> = {
    simple: `name: ${name}
steps:
  - type: route
    label: Route to agent
  - type: agent_run
    agent: ""
    label: Run agent
`,
    'fan-out-review': `name: ${name}
steps:
  - type: route
    label: Route to agent
  - type: agent_run
    agent: ""
    label: Primary agent run
  - type: approve
    label: Peer review
  - type: agent_run
    agent: ""
    label: Follow-up run
`,
    'auto-approve': `name: ${name}
steps:
  - type: route
    label: Route to agent
  - type: agent_run
    agent: ""
    label: Agent run
  - type: approve
    label: Auto-approve
`,
  }
  return stubs[slug] ?? `name: ${name}\nsteps:\n  - type: route\n    label: Start\n`
}
