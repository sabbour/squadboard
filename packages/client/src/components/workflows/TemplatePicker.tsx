import { useWorkflowTemplates } from '../../api/workflows.ts'

interface TemplatePickerProps {
  onSelect: (yamlContent: string, name: string) => void
  onClose: () => void
}

export default function TemplatePicker({ onSelect, onClose }: TemplatePickerProps) {
  const { data: templates, isLoading, isError } = useWorkflowTemplates()

  function handleSelect(slug: string, name: string) {
    // Load the template YAML from the API (the full template object carries yaml from the list endpoint
    // or we fallback to a sensible stub so the editor is pre-populated).
    const yamlStub = buildStubYaml(slug, name)
    onSelect(yamlStub, name)
    onClose()
  }

  return (
    /* Backdrop */
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        zIndex: 200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* Modal */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#161b22',
          border: '1px solid #30363d',
          borderRadius: '8px',
          width: '480px',
          maxHeight: '520px',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid #30363d',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span style={{ fontWeight: 600, fontSize: '14px', color: '#e6edf3' }}>Use a template</span>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: '#8b949e',
              fontSize: '16px',
              cursor: 'pointer',
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: 'auto', padding: '12px 20px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {isLoading && (
            <p style={{ color: '#8b949e', fontSize: '13px' }}>Loading templates…</p>
          )}
          {isError && (
            <p style={{ color: '#f85149', fontSize: '13px' }}>Failed to load templates.</p>
          )}
          {!isLoading && !isError && templates && templates.length === 0 && (
            <p style={{ color: '#8b949e', fontSize: '13px' }}>No templates available.</p>
          )}
          {templates?.map((tpl) => (
            <div
              key={tpl.slug}
              style={{
                background: '#0d1117',
                border: '1px solid #30363d',
                borderRadius: '6px',
                padding: '14px 16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
                <div>
                  <span style={{ fontWeight: 600, fontSize: '13px', color: '#e6edf3' }}>{tpl.name}</span>
                  {tpl.description && (
                    <p style={{ fontSize: '12px', color: '#8b949e', marginTop: '4px' }}>{tpl.description}</p>
                  )}
                </div>
                <button
                  onClick={() => handleSelect(tpl.slug, tpl.name)}
                  style={{
                    flexShrink: 0,
                    background: '#388bfd',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '4px',
                    padding: '5px 12px',
                    fontSize: '12px',
                    fontWeight: 500,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  Use this template
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
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
