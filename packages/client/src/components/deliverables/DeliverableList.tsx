import { tokens } from '@fluentui/react-components'
import { useDeliverables } from '../../api/deliverables.ts'
import DeliverableCard from './DeliverableCard.tsx'

interface DeliverableListProps {
  projectId: string
  issueId: string
}

export default function DeliverableList({ projectId, issueId }: DeliverableListProps) {
  const { data, isLoading, error } = useDeliverables(projectId, issueId)

  if (isLoading) {
    return (
      <p
        style={{
          fontSize: '12px',
          color: tokens.colorNeutralForeground3,
          textAlign: 'center',
          padding: '20px 0',
        }}
      >
        Loading outputs…
      </p>
    )
  }

  if (error) {
    return (
      <p
        style={{
          fontSize: '12px',
          color: tokens.colorPaletteRedForeground1,
          padding: '12px',
          background: tokens.colorPaletteRedBackground1,
          border: `1px solid ${tokens.colorPaletteRedBorder1}`,
          borderRadius: '6px',
        }}
      >
        Failed to load outputs: {(error as Error)?.message ?? 'Unknown error'}
      </p>
    )
  }

  const items = data ?? []

  if (items.length === 0) {
    return (
      <div
        style={{
          background: tokens.colorNeutralBackground2,
          border: `1px dashed ${tokens.colorNeutralStroke1}`,
          borderRadius: '6px',
          padding: '20px 16px',
          textAlign: 'center',
        }}
      >
        <p
          style={{
            margin: 0,
            fontSize: '13px',
            fontWeight: 600,
            color: tokens.colorNeutralForeground1,
            marginBottom: '4px',
          }}
        >
          No outputs yet
        </p>
        <p style={{ margin: 0, fontSize: '12px', color: tokens.colorNeutralForeground3 }}>
          Outputs are the files, links, notes, or structured results agents produce while working this card.
        </p>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {items.map((d) => (
        <DeliverableCard key={d.id} projectId={projectId} deliverable={d} />
      ))}
    </div>
  )
}
