import { useState } from 'react'
import { useCreateAgent } from '../../api/agents.ts'

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

export default function HireAgentModal({ projectId, onClose }: HireAgentModalProps) {
  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [model, setModel] = useState('auto')
  const [expertiseInput, setExpertiseInput] = useState('')
  const [nameError, setNameError] = useState('')

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

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 300,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
      }}
    >
      <div
        style={{
          background: '#161b22',
          border: '1px solid #30363d',
          borderRadius: '8px',
          width: '100%',
          maxWidth: '480px',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '90vh',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 20px',
            borderBottom: '1px solid #30363d',
          }}
        >
          <h2 style={{ fontSize: '15px', fontWeight: 600, color: '#e6edf3' }}>Hire Agent</h2>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: '#8b949e', fontSize: '18px', cursor: 'pointer' }}
          >
            ✕
          </button>
        </div>

        {/* Form */}
        <form
          onSubmit={handleSubmit}
          style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px', overflowY: 'auto' }}
        >
          {/* Name */}
          <div>
            <label style={labelStyle}>
              Name <span style={{ color: '#f85149' }}>*</span>
              <span style={{ fontWeight: 400, color: '#8b949e', marginLeft: '6px' }}>(kebab-case)</span>
            </label>
            <input
              autoFocus
              type="text"
              value={name}
              onChange={handleNameChange}
              placeholder="e.g. design-lead"
              required
              style={{
                ...inputStyle,
                borderColor: nameError ? '#f85149' : '#30363d',
              }}
              onFocus={(e) => { e.currentTarget.style.borderColor = nameError ? '#f85149' : '#388bfd' }}
              onBlur={(e) => { e.currentTarget.style.borderColor = nameError ? '#f85149' : '#30363d'; validateName(name) }}
            />
            {nameError && (
              <p style={{ fontSize: '11px', color: '#f85149', marginTop: '4px' }}>{nameError}</p>
            )}
          </div>

          {/* Role */}
          <div>
            <label style={labelStyle}>
              Role <span style={{ color: '#f85149' }}>*</span>
            </label>
            <input
              type="text"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="e.g. Frontend Developer"
              required
              style={inputStyle}
              onFocus={(e) => { e.currentTarget.style.borderColor = '#388bfd' }}
              onBlur={(e) => { e.currentTarget.style.borderColor = '#30363d' }}
            />
          </div>

          {/* Model */}
          <div>
            <label style={labelStyle}>Model</label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              style={{
                background: '#0d1117',
                border: '1px solid #30363d',
                borderRadius: '6px',
                color: '#e6edf3',
                padding: '7px 10px',
                fontSize: '13px',
                cursor: 'pointer',
                outline: 'none',
                width: '100%',
              }}
            >
              {MODELS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          {/* Expertise */}
          <div>
            <label style={labelStyle}>
              Expertise <span style={{ fontWeight: 400, color: '#8b949e' }}>(comma-separated tags)</span>
            </label>
            <input
              type="text"
              value={expertiseInput}
              onChange={(e) => setExpertiseInput(e.target.value)}
              placeholder="e.g. React, TypeScript, CSS"
              style={inputStyle}
              onFocus={(e) => { e.currentTarget.style.borderColor = '#388bfd' }}
              onBlur={(e) => { e.currentTarget.style.borderColor = '#30363d' }}
            />
            {expertiseInput && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '8px' }}>
                {expertiseInput.split(',').map((tag) => tag.trim()).filter(Boolean).map((tag) => (
                  <span
                    key={tag}
                    style={{
                      fontSize: '11px',
                      padding: '2px 8px',
                      borderRadius: '12px',
                      background: 'rgba(56,139,253,0.12)',
                      color: '#79c0ff',
                      border: '1px solid rgba(56,139,253,0.25)',
                    }}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', paddingTop: '4px' }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                background: 'none',
                border: '1px solid #30363d',
                borderRadius: '6px',
                color: '#e6edf3',
                padding: '6px 16px',
                fontSize: '13px',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name || !role.trim() || Boolean(nameError) || createAgent.isPending}
              style={{
                background: '#238636',
                border: '1px solid #2ea043',
                borderRadius: '6px',
                color: '#e6edf3',
                padding: '6px 16px',
                fontSize: '13px',
                fontWeight: 500,
                cursor: !name || !role.trim() || Boolean(nameError) || createAgent.isPending ? 'not-allowed' : 'pointer',
                opacity: !name || !role.trim() || Boolean(nameError) || createAgent.isPending ? 0.6 : 1,
              }}
            >
              {createAgent.isPending ? 'Hiring…' : 'Hire Agent'}
            </button>
          </div>

          {createAgent.isError && (
            <p style={{ fontSize: '12px', color: '#f85149', textAlign: 'center' }}>
              Failed to hire agent. Please try again.
            </p>
          )}
        </form>
      </div>
    </div>
  )
}

const labelStyle: React.CSSProperties = {
  fontSize: '12px',
  color: '#8b949e',
  display: 'block',
  marginBottom: '6px',
  fontWeight: 600,
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: '#0d1117',
  border: '1px solid #30363d',
  borderRadius: '6px',
  color: '#e6edf3',
  padding: '8px 10px',
  fontSize: '13px',
  outline: 'none',
}
