// 409 optimistic-concurrency conflict toast.
// Portal-based, no third-party library — plain CSS fixed-position div.

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

interface ConflictToastProps {
  onReload: () => void
  onDismiss: () => void
  /** Auto-dismiss after this many ms (default: 10 000). Pass 0 to disable. */
  autoCloseMs?: number
}

export default function ConflictToast({ onReload, onDismiss, autoCloseMs = 10_000 }: ConflictToastProps) {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    if (!autoCloseMs) return
    const t = setTimeout(() => {
      setVisible(false)
      onDismiss()
    }, autoCloseMs)
    return () => clearTimeout(t)
  }, [autoCloseMs, onDismiss])

  if (!visible) return null

  const toast = (
    <div
      role="alert"
      aria-live="assertive"
      style={{
        position: 'fixed',
        bottom: '24px',
        right: '24px',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        background: '#1c2128',
        border: '1px solid #e36209',
        borderLeft: '4px solid #e36209',
        borderRadius: '8px',
        padding: '12px 16px',
        maxWidth: '380px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        animation: 'sq-toast-in 0.2s ease-out',
      }}
    >
      {/* Warning icon */}
      <span style={{ fontSize: '18px', flexShrink: 0 }} aria-hidden>⚠️</span>

      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: '13px', fontWeight: 600, color: '#e6edf3', margin: 0 }}>
          Conflict detected
        </p>
        <p style={{ fontSize: '12px', color: '#8b949e', margin: '2px 0 0' }}>
          Another user updated this issue. Refreshing…
        </p>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
        <button
          onClick={() => { onReload(); setVisible(false) }}
          style={{
            background: '#e36209',
            border: 'none',
            borderRadius: '4px',
            color: '#fff',
            fontSize: '12px',
            fontWeight: 600,
            padding: '4px 10px',
            cursor: 'pointer',
          }}
        >
          Reload
        </button>
        <button
          onClick={() => { setVisible(false); onDismiss() }}
          aria-label="Dismiss"
          style={{
            background: 'transparent',
            border: 'none',
            color: '#8b949e',
            fontSize: '16px',
            cursor: 'pointer',
            lineHeight: 1,
            padding: '0 4px',
          }}
        >
          ×
        </button>
      </div>

      {/* Inline keyframe — appended once */}
      <style>{`
        @keyframes sq-toast-in {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  )

  return createPortal(toast, document.body)
}
