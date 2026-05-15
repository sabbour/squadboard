import { tokens } from '@fluentui/react-components'
import type { DeliverableLinksPayload, DeliverablePayload } from '../../../api/deliverables.ts'

interface LinksDeliverableProps {
  payload: DeliverablePayload
}

function isLinks(p: DeliverablePayload): p is DeliverableLinksPayload {
  const l = (p as DeliverableLinksPayload).links
  return Array.isArray(l)
}

export default function LinksDeliverable({ payload }: LinksDeliverableProps) {
  if (!isLinks(payload) || payload.links.length === 0) {
    return (
      <p style={{ fontSize: '12px', color: tokens.colorNeutralForeground3, margin: 0 }}>
        No links in payload.
      </p>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {payload.links.map((l, i) => (
        <a
          key={`${l.url}-${i}`}
          href={l.url}
          target="_blank"
          rel="noreferrer"
          style={{
            display: 'block',
            background: tokens.colorNeutralBackground2,
            border: `1px solid ${tokens.colorNeutralStroke1}`,
            borderRadius: '6px',
            padding: '10px 12px',
            color: tokens.colorNeutralForeground1,
            fontSize: '13px',
            textDecoration: 'none',
            transition: 'background 0.1s ease',
          }}
          onMouseEnter={(e) => {
            ;(e.currentTarget as HTMLAnchorElement).style.background =
              tokens.colorNeutralBackground1Hover
          }}
          onMouseLeave={(e) => {
            ;(e.currentTarget as HTMLAnchorElement).style.background =
              tokens.colorNeutralBackground2
          }}
        >
          {l.label && (
            <div style={{ fontWeight: 600, marginBottom: '2px' }}>{l.label}</div>
          )}
          <div
            style={{
              color: tokens.colorBrandForeground1,
              fontSize: '12px',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              wordBreak: 'break-all',
            }}
          >
            {l.url}
          </div>
        </a>
      ))}
    </div>
  )
}
