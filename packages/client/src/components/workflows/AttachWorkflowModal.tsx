import { useState } from 'react'
import { useWorkflows, useWorkflowTemplates, useAttachWorkflow, useCreateWorkflow } from '../../api/workflows.ts'

interface AttachWorkflowModalProps {
  projectId: string
  issueId: string
  onClose: () => void
}

/**
 * Modal that lets the user attach a workflow to an issue.
 * Shows:
 *  - A dropdown of existing project workflows to attach directly.
 *  - "Use template" buttons for each bundled template (creates + attaches).
 */
export function AttachWorkflowModal({ projectId, issueId, onClose }: AttachWorkflowModalProps) {
  const { data: workflows } = useWorkflows(projectId)
  const { data: templates } = useWorkflowTemplates()
  const attachWorkflow = useAttachWorkflow(projectId, issueId)
  const createWorkflow = useCreateWorkflow(projectId)

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
      // Create workflow from template, then attach it.
      const created = await createWorkflow.mutateAsync({
        name: tpl.name,
        description: tpl.description,
        templateSlug: tpl.slug,
        // yamlContent fetched server-side by templateSlug; send a placeholder so the
        // API knows to expand it. The real expansion happens in Hockney's route handler.
        yamlContent: `template:${tpl.slug}`,
      })
      await attachWorkflow.mutateAsync({ workflowId: created.id })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create workflow from template')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '400px',
          background: '#161b22',
          border: '1px solid #30363d',
          borderRadius: '10px',
          padding: '24px',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
        }}
      >
        <h3 style={{ fontSize: '15px', fontWeight: 600, color: '#e6edf3', margin: 0 }}>
          Attach Workflow
        </h3>

        {/* Existing project workflows */}
        {workflows && workflows.length > 0 && (
          <div>
            <p style={{ fontSize: '11px', color: '#8b949e', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Project Workflows
            </p>
            <div style={{ display: 'flex', gap: '8px' }}>
              <select
                value={selectedWorkflowId}
                onChange={(e) => setSelectedWorkflowId(e.target.value)}
                style={{
                  flex: 1,
                  background: '#0d1117',
                  border: '1px solid #30363d',
                  borderRadius: '6px',
                  color: '#e6edf3',
                  fontSize: '13px',
                  padding: '6px 10px',
                }}
              >
                <option value="">— select a workflow —</option>
                {workflows.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
              <button
                onClick={() => { void handleAttach() }}
                disabled={!selectedWorkflowId || busy}
                style={{
                  padding: '6px 14px',
                  background: selectedWorkflowId && !busy ? '#238636' : '#21262d',
                  color: '#e6edf3',
                  border: '1px solid #30363d',
                  borderRadius: '6px',
                  fontSize: '13px',
                  cursor: selectedWorkflowId && !busy ? 'pointer' : 'default',
                  opacity: selectedWorkflowId && !busy ? 1 : 0.5,
                }}
              >
                Attach
              </button>
            </div>
          </div>
        )}

        {/* Bundled templates */}
        {templates && templates.length > 0 && (
          <div>
            <p style={{ fontSize: '11px', color: '#8b949e', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Use a Template
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {templates.map((tpl) => (
                <div
                  key={tpl.slug}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    background: '#0d1117',
                    border: '1px solid #30363d',
                    borderRadius: '6px',
                    padding: '10px 12px',
                  }}
                >
                  <div>
                    <p style={{ fontSize: '13px', color: '#e6edf3', margin: 0, fontWeight: 500 }}>{tpl.name}</p>
                    <p style={{ fontSize: '11px', color: '#8b949e', margin: '2px 0 0' }}>{tpl.description}</p>
                  </div>
                  <button
                    onClick={() => { void handleUseTemplate(tpl.slug) }}
                    disabled={busy}
                    style={{
                      padding: '4px 10px',
                      background: busy ? '#21262d' : '#1f6feb',
                      color: '#e6edf3',
                      border: 'none',
                      borderRadius: '6px',
                      fontSize: '12px',
                      cursor: busy ? 'default' : 'pointer',
                      opacity: busy ? 0.5 : 1,
                      flexShrink: 0,
                      marginLeft: '12px',
                    }}
                  >
                    Use
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {error && (
          <p style={{ fontSize: '12px', color: '#f85149', margin: 0 }}>{error}</p>
        )}

        <button
          onClick={onClose}
          style={{
            alignSelf: 'flex-end',
            padding: '6px 14px',
            background: 'none',
            border: '1px solid #30363d',
            borderRadius: '6px',
            color: '#8b949e',
            fontSize: '13px',
            cursor: 'pointer',
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
