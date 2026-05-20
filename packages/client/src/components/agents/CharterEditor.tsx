import { useState, useEffect } from 'react'
import { Checkmark20Regular } from '@fluentui/react-icons'
import { useAgentCharter, useUpdateCharter } from '../../api/agents.ts'
import { useUnsavedChangesWarning } from '../../hooks/useUnsavedChangesWarning.ts'

interface CharterEditorProps {
  projectId: string
  agentId: string
}

export default function CharterEditor({ projectId, agentId }: CharterEditorProps) {
  const { data, isLoading, isError, error, refetch } = useAgentCharter(projectId, agentId)
  const updateCharter = useUpdateCharter(projectId, agentId)
  const [value, setValue] = useState('')
  const [dirty, setDirty] = useState(false)
  useUnsavedChangesWarning(dirty)

  useEffect(() => {
    if (data?.content !== undefined) {
      setValue(data.content)
      setDirty(false)
    }
  }, [data?.content])

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setValue(e.target.value)
    setDirty(true)
  }

  function handleSave() {
    updateCharter.mutate(value, {
      onSuccess: () => setDirty(false),
    })
  }

  if (isLoading) {
    return (
      <div style={{ color: 'var(--text-muted)', fontSize: '13px', padding: '12px 0' }}>
        Loading charter…
      </div>
    )
  }

  if (isError) {
    return (
      <div
        style={{
          border: '1px solid rgba(248,81,73,0.35)',
          background: 'rgba(248,81,73,0.10)',
          color: 'var(--text)',
          borderRadius: 'var(--radius)',
          padding: '12px',
          fontSize: '13px',
          lineHeight: 1.5,
        }}
      >
        <strong style={{ display: 'block', marginBottom: '4px', color: '#f85149' }}>
          Could not load this charter.
        </strong>
        <div style={{ color: 'var(--text-muted)', marginBottom: '10px' }}>
          {error instanceof Error ? error.message : 'The backend did not return charter content for this agent.'}
        </div>
        <button
          onClick={() => void refetch()}
          style={{
            background: 'transparent',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            color: 'var(--text)',
            padding: '6px 12px',
            cursor: 'pointer',
          }}
        >
          Retry
        </button>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', flex: 1 }}>
      <textarea
        value={value}
        onChange={handleChange}
        spellCheck={false}
        style={{
          flex: 1,
          minHeight: '320px',
          width: '100%',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          color: 'var(--text)',
          padding: '12px',
          fontSize: '12px',
          fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Consolas, monospace',
          lineHeight: '1.6',
          resize: 'vertical',
          outline: 'none',
        }}
        onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent)' }}
        onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border)' }}
      />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px' }}>
        {updateCharter.isSuccess && !dirty && (
          <span style={{ fontSize: '12px', color: '#3fb950' }}>
            <Checkmark20Regular style={{ verticalAlign: 'middle', marginRight: '4px' }} />Saved
          </span>
        )}
        {updateCharter.isError && (
          <span style={{ fontSize: '12px', color: 'var(--danger)' }}>Save failed</span>
        )}
        <button
          onClick={handleSave}
          disabled={!dirty || updateCharter.isPending}
          style={{
            background: dirty ? '#238636' : 'transparent',
            border: `1px solid ${dirty ? '#2ea043' : 'var(--border)'}`,
            borderRadius: 'var(--radius)',
            color: dirty ? 'white' : 'var(--text-muted)',
            padding: '6px 16px',
            fontSize: '13px',
            fontWeight: 500,
            cursor: dirty && !updateCharter.isPending ? 'pointer' : 'not-allowed',
            opacity: dirty && !updateCharter.isPending ? 1 : 0.5,
            transition: 'all 0.15s',
          }}
        >
          {updateCharter.isPending ? 'Saving…' : 'Save Charter'}
        </button>
      </div>
    </div>
  )
}
