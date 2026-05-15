import { useState } from 'react'
import { tokens } from '@fluentui/react-components'
import type { DeliverableFilePayload, DeliverablePayload } from '../../../api/deliverables.ts'

interface FilesDeliverableProps {
  payload: DeliverablePayload
}

function isFiles(p: DeliverablePayload): p is DeliverableFilePayload {
  const f = (p as DeliverableFilePayload).files
  return Array.isArray(f)
}

export default function FilesDeliverable({ payload }: FilesDeliverableProps) {
  if (!isFiles(payload) || payload.files.length === 0) {
    return (
      <p
        style={{
          fontSize: '12px',
          color: tokens.colorNeutralForeground3,
          margin: 0,
        }}
      >
        No files in payload.
      </p>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {payload.files.map((f, i) => (
        <FileBlock key={`${f.path}-${i}`} path={f.path} language={f.language} content={f.content} />
      ))}
    </div>
  )
}

function FileBlock({
  path,
  language,
  content,
}: {
  path: string
  language?: string
  content: string
}) {
  const [open, setOpen] = useState(false)
  const lineCount = content ? content.split('\n').length : 0

  return (
    <div
      style={{
        background: '#0d1117',
        border: '1px solid #30363d',
        borderRadius: '6px',
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
          padding: '8px 12px',
          background: '#161b22',
          border: 'none',
          borderBottom: open ? '1px solid #21262d' : 'none',
          cursor: 'pointer',
          color: '#e6edf3',
          fontSize: '12px',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          textAlign: 'left',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '10px', color: '#8b949e' }}>{open ? '▾' : '▸'}</span>
          <span style={{ fontWeight: 600 }}>{path}</span>
          {language && (
            <span
              style={{
                fontSize: '10px',
                background: '#21262d',
                color: '#8b949e',
                borderRadius: '4px',
                padding: '1px 6px',
                textTransform: 'lowercase',
              }}
            >
              {language}
            </span>
          )}
        </span>
        <span style={{ fontSize: '10px', color: '#8b949e' }}>
          {lineCount} line{lineCount === 1 ? '' : 's'}
        </span>
      </button>
      {open && (
        <pre
          style={{
            margin: 0,
            padding: '10px 12px',
            maxHeight: '320px',
            overflow: 'auto',
            color: '#e6edf3',
            fontSize: '12px',
            lineHeight: 1.5,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            whiteSpace: 'pre',
          }}
        >
          {content}
        </pre>
      )}
    </div>
  )
}
