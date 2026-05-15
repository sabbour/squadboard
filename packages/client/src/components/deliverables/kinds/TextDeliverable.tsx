import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { tokens } from '@fluentui/react-components'
import type { DeliverablePayload, DeliverableTextPayload } from '../../../api/deliverables.ts'

interface TextDeliverableProps {
  payload: DeliverablePayload
}

function isText(p: DeliverablePayload): p is DeliverableTextPayload {
  return typeof (p as DeliverableTextPayload).text === 'string'
}

export default function TextDeliverable({ payload }: TextDeliverableProps) {
  if (!isText(payload)) {
    return (
      <pre
        style={{
          background: tokens.colorNeutralBackground3,
          border: `1px solid ${tokens.colorNeutralStroke1}`,
          borderRadius: '6px',
          padding: '10px 12px',
          fontSize: '12px',
          color: tokens.colorNeutralForeground2,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          overflowX: 'auto',
          margin: 0,
        }}
      >
        {JSON.stringify(payload, null, 2)}
      </pre>
    )
  }

  const isMarkdown = (payload.format ?? 'markdown') !== 'plain'

  if (!isMarkdown) {
    return (
      <pre
        style={{
          background: tokens.colorNeutralBackground3,
          border: `1px solid ${tokens.colorNeutralStroke1}`,
          borderRadius: '6px',
          padding: '10px 12px',
          fontSize: '12px',
          color: tokens.colorNeutralForeground1,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          overflowX: 'auto',
          margin: 0,
          lineHeight: 1.5,
        }}
      >
        {payload.text}
      </pre>
    )
  }

  return (
    <div
      style={{
        background: tokens.colorNeutralBackground2,
        border: `1px solid ${tokens.colorNeutralStroke1}`,
        borderRadius: '6px',
        padding: '12px 14px',
        fontSize: '13px',
        color: tokens.colorNeutralForeground1,
        lineHeight: 1.6,
      }}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{payload.text}</ReactMarkdown>
    </div>
  )
}
