/**
 * CaptureFab — Phase 14 per-project floating action button.
 *
 * Mounted from per-project pages (currently only the Board — see scope rule)
 * to give a one-click path into the CaptureModal with the active project
 * pre-selected.
 *
 * The modal it opens defaults `lockedColumn` to 'backlog' so quick captures
 * land in the project's intake column unless the user explicitly bypasses
 * the lock (the dropdown is disabled while locked).
 */

import { useState } from 'react'
import { tokens } from '@fluentui/react-components'
import { Add24Regular } from '@fluentui/react-icons'
import CaptureModal from './CaptureModal.tsx'
import type { ColumnId } from '../../api/issues.ts'

interface CaptureFabProps {
  projectId: string
  /** Optional: override the locked column. Defaults to 'backlog'. */
  defaultColumn?: ColumnId
}

export default function CaptureFab({ projectId, defaultColumn = 'backlog' }: CaptureFabProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        aria-label="Quick capture"
        title="Quick capture (c)"
        onClick={() => setOpen(true)}
        style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          width: '56px',
          height: '56px',
          borderRadius: '50%',
          background: tokens.colorBrandBackground,
          border: 'none',
          color: '#fff',
          fontSize: '24px',
          cursor: 'pointer',
          boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 200,
          transition: 'transform 0.1s ease',
        }}
        onMouseDown={(e) => {
          e.currentTarget.style.transform = 'scale(0.95)'
        }}
        onMouseUp={(e) => {
          e.currentTarget.style.transform = 'scale(1)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = 'scale(1)'
        }}
      >
        <Add24Regular />
      </button>
      <CaptureModal
        open={open}
        onClose={() => setOpen(false)}
        lockedProjectId={projectId}
        lockedColumn={defaultColumn}
      />
    </>
  )
}
