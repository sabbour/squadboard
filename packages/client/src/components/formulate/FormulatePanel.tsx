/**
 * FormulatePanel — universal AI-formulate input row.
 *
 * Drop into any creation dialog: textarea + Beaker icon button. The parent
 * supplies an `onFormulate` callback that runs a mutation; this component
 * surfaces the spinner, error message, and resolved-model badge.
 *
 * Visual identity ("formulate" = lab beaker) is shared across skills, tools,
 * agents, teams, inbox, etc. Keep all formulate UI here so the affordance
 * looks the same everywhere.
 */
import { useState } from 'react'
import { Button, Textarea, Tooltip, tokens } from '@fluentui/react-components'
import { Beaker20Regular } from '@fluentui/react-icons'
import { ActionLoading } from '../loading/index.tsx'

interface FormulatePanelProps {
  /** Placeholder shown in the textarea when empty. */
  placeholder?: string
  /** Optional helper above the textarea. */
  hint?: string
  /** Disable the button regardless of pending state. */
  disabled?: boolean
  /** True while the formulate mutation is in flight. */
  isPending: boolean
  /** Optional error message to render below the textarea. */
  errorMessage?: string | null
  /** Optional resolved-model info to render as a small badge after success. */
  modelUsed?: { model: string; via: string } | null
  /** Called when the user clicks the Formulate button with a non-empty draft. */
  onFormulate: (draft: string) => void
  /** Optional initial draft (preserved across re-renders if parent passes it). */
  defaultDraft?: string
  /** Compact layout (smaller textarea + tighter padding). */
  compact?: boolean
}

export default function FormulatePanel({
  placeholder = 'Describe what you want and we\'ll formulate it…',
  hint,
  disabled = false,
  isPending,
  errorMessage,
  modelUsed,
  onFormulate,
  defaultDraft = '',
  compact = false,
}: FormulatePanelProps) {
  const [draft, setDraft] = useState(defaultDraft)

  function handleClick() {
    const trimmed = draft.trim()
    if (!trimmed) return
    onFormulate(trimmed)
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        padding: compact ? '10px 12px' : '12px 14px',
        border: `1px dashed ${tokens.colorBrandStroke2}`,
        borderRadius: '8px',
        background: tokens.colorBrandBackground2,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <Beaker20Regular style={{ color: tokens.colorBrandForeground1 }} />
        <span style={{ fontSize: '12px', fontWeight: 600, color: tokens.colorBrandForeground1 }}>
          Formulate with AI
        </span>
      </div>
      {hint && (
        <p style={{ margin: 0, fontSize: '11px', color: tokens.colorNeutralForeground3 }}>{hint}</p>
      )}
      <Textarea
        value={draft}
        onChange={(_, d) => setDraft(d.value)}
        rows={compact ? 2 : 3}
        placeholder={placeholder}
        disabled={isPending}
      />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
        <div style={{ fontSize: '11px', color: tokens.colorNeutralForeground3 }}>
          {modelUsed ? (
            <Tooltip content={`Resolved via ${modelUsed.via}`} relationship="label">
              <span>
                Drafted with <strong>{modelUsed.model}</strong>
              </span>
            </Tooltip>
          ) : (
            'Sketches a starting point — review before saving.'
          )}
        </div>
        <Button
          appearance="primary"
          size="small"
          icon={isPending ? <ActionLoading label="Formulating…" /> : <Beaker20Regular />}
          disabled={disabled || isPending || !draft.trim()}
          onClick={handleClick}
        >
          {isPending ? 'Formulating…' : 'Formulate'}
        </Button>
      </div>
      {errorMessage && (
        <p style={{ margin: 0, fontSize: '11px', color: tokens.colorPaletteRedForeground1 }}>
          {errorMessage}
        </p>
      )}
    </div>
  )
}
