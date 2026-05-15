import { tokens } from '@fluentui/react-components'
import type {
  DeliverablePayload,
  DeliverableStructuredPayload,
} from '../../../api/deliverables.ts'

interface StructuredDeliverableProps {
  payload: DeliverablePayload
}

function isStructured(p: DeliverablePayload): p is DeliverableStructuredPayload {
  return (p as DeliverableStructuredPayload).structured !== undefined
}

export default function StructuredDeliverable({ payload }: StructuredDeliverableProps) {
  const value = isStructured(payload) ? payload.structured : payload
  const schemaName = isStructured(payload) ? payload.schemaName : undefined

  let serialized: string
  try {
    serialized = JSON.stringify(value, null, 2)
  } catch {
    serialized = String(value)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {schemaName && (
        <span
          style={{
            fontSize: '11px',
            color: tokens.colorNeutralForeground3,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          }}
        >
          schema: {schemaName}
        </span>
      )}
      <pre
        style={{
          background: '#0d1117',
          border: '1px solid #30363d',
          borderRadius: '6px',
          padding: '10px 12px',
          margin: 0,
          color: '#e6edf3',
          fontSize: '12px',
          lineHeight: 1.5,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          maxHeight: '320px',
          overflow: 'auto',
          whiteSpace: 'pre',
        }}
      >
        {serialized}
      </pre>
    </div>
  )
}
